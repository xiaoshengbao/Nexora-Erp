import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {validatePhysicalLotResult} from '../src/shared/physical-lot-validation.ts'
import {createAppState} from '../src/renderer/src/store/state.ts'
import {createPhysicalLotActions} from '../src/renderer/src/store/modules/physical-lot-actions.ts'

const input={movement_id:9,lot_id:null,quantity:'1.250',evidence:'交接单与实物标签逐箱核对',
  supplier_lot:'S-1',manufactured_on:null,expires_on:null}
const result={id:2,movement_id:9,lot_id:8,lot_code:'EVIDENCE-8',warehouse_id:1,material_id:3,
  quantity:'1.250',evidence:input.evidence,original_evidence_id:null,
  created_by_name:'admin',created_at:'2026-10-03 10:00:00'}
const listing={checkpoint_movement_id:8,checkpoint_basis:'v56_opening',warehouse_id:null,
  material_id:null,rows:[{movement_id:9,warehouse_id:1,material_id:3,quantity:'2.000',
    unallocated_quantity:'0.750',source_type:'other_inbound',source_id:1,
    source_line_id:1,created_at:'2026-10-03 09:00:00'}],has_more:false}

test('逐笔补证 IPC 固定路径和数据边界，响应须保留可核对来源',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous})
  const calls=[]
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json(new URL(url).pathname.endsWith('/login')
      ? {token:'token',user:{id:1}} : new URL(url).pathname.endsWith('unallocated-movements')
        ? listing : result)}
  await callBackend('login',{});calls.length=0
  assert.deepEqual(await callBackend('physicalLotMovementEvidence',input),result)
  assert.equal(calls[0].path,'/api/v1/inventory/physical-lots/movements/9/evidence')
  assert.deepEqual(JSON.parse(calls[0].body),Object.fromEntries(
    Object.entries(input).filter(([key])=>key!=='movement_id')))
  assert.deepEqual(await callBackend('physicalLotUnallocated',
    {warehouse_id:null,material_id:null}),listing)
  assert.equal(calls[1].path,'/api/v1/inventory/physical-lots/unallocated-movements')
  for(const invalid of [{...input,movement_id:'../users'},{...input,quantity:'1.1234'},
    {...input,quantity:1.25},{...input,lot_id:0},{...input,evidence:'无'}])
    await assert.rejects(callBackend('physicalLotMovementEvidence',invalid))
  assert.equal(calls.length,2)
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json({...result,id:3,quantity:'-1.250',original_evidence_id:2})}
  assert.equal((await callBackend('physicalLotMovementEvidenceReverse',
    {record_id:2,reason:'复核发现交接单贴错了实物标签'})).original_evidence_id,2)
  assert.equal(calls[2].path,'/api/v1/inventory/physical-lots/movement-evidence/2/reverse')
  assert.throws(()=>validatePhysicalLotResult('physicalLotUnallocated',
    {...listing,rows:[{...listing.rows[0],unallocated_quantity:null}]}),/响应格式/)
  assert.throws(()=>validatePhysicalLotResult('physicalLotMovementEvidence',
    {...result,lot_id:null}),/响应格式/)
})

test('逐笔补证的迟到响应、范围错配及撤权不会污染批次快照',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  const state=createAppState()
  state.user.value={id:1,permissions:['inventory.view','physical_lot.movement_evidence']}
  globalThis.window={nexora:{callApi:async()=>({...result,movement_id:10})}}
  const actions=createPhysicalLotActions(state)
  assert.equal(await actions.savePhysicalLotMovementEvidence(input),null)
  assert.match(state.lotError.value,/范围不一致/)
  globalThis.window.nexora.callApi=async()=>({...listing,warehouse_id:2})
  assert.equal(await actions.loadPhysicalLotUnallocated(),false)
  assert.match(state.lotError.value,/范围不匹配/)
  state.user.value={id:1,permissions:['inventory.view']}
  assert.equal(await actions.savePhysicalLotMovementEvidence(input),null)
  assert.equal(state.lotUnallocated.value,null)
})

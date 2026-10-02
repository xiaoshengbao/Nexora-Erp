import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {validatePhysicalLotResult} from '../src/shared/physical-lot-validation.ts'
import {createAppState} from '../src/renderer/src/store/state.ts'
import {createPhysicalLotActions} from '../src/renderer/src/store/modules/physical-lot-actions.ts'

const input={inbound_movement_id:9,outbound_movement_id:10,lot_id:null,
  quantity:'1.000',evidence:'入库箱码与出库交接记录逐件确认',supplier_lot:null,
  manufactured_on:null,expires_on:null}
const result={id:3,inbound_movement_id:9,outbound_movement_id:10,
  inbound_evidence_id:4,outbound_evidence_id:5,lot_id:8,lot_code:'EVIDENCE-8',
  warehouse_id:1,material_id:3,quantity:'1.000',evidence:input.evidence,
  original_pair_id:null,created_by_name:'admin',created_at:'2026-10-03 10:00:00'}

test('成对补证 IPC 固定路径、精确数量与整体冲销响应',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous})
  const calls=[]
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json(new URL(url).pathname.endsWith('/login')?{token:'token',user:{id:1}}:result)}
  await callBackend('login',{});calls.length=0
  assert.deepEqual(await callBackend('physicalLotEvidencePair',{...input,extra:'ignored'}),result)
  assert.equal(calls[0].path,'/api/v1/inventory/physical-lots/evidence-pairs')
  assert.deepEqual(JSON.parse(calls[0].body),input)
  for(const invalid of [{...input,inbound_movement_id:'../users'},
    {...input,outbound_movement_id:8},{...input,quantity:1},
    {...input,quantity:'1.1234'},{...input,lot_id:0}])
    await assert.rejects(callBackend('physicalLotEvidencePair',invalid))
  assert.equal(calls.length,1)
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json({...result,id:4,quantity:'-1.000',original_pair_id:3})}
  assert.equal((await callBackend('physicalLotEvidencePairReverse',
    {record_id:3,reason:'复核发现入库与出库箱码不一致'})).original_pair_id,3)
  assert.equal(calls[1].path,'/api/v1/inventory/physical-lots/evidence-pairs/3/reverse')
  assert.throws(()=>validatePhysicalLotResult('physicalLotEvidencePair',
    {...result,outbound_evidence_id:null}),/响应格式/)
})

test('成对补证拒绝范围错配及撤权后的写操作',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  const state=createAppState()
  state.user.value={id:1,permissions:['inventory.view','physical_lot.movement_evidence']}
  globalThis.window={nexora:{callApi:async()=>({...result,outbound_movement_id:11})}}
  const actions=createPhysicalLotActions(state)
  assert.equal(await actions.savePhysicalLotEvidencePair(input),null)
  assert.match(state.lotError.value,/范围不一致/)
  state.user.value={id:1,permissions:['inventory.view']}
  assert.equal(await actions.savePhysicalLotEvidencePair(input),null)
  assert.equal(await actions.reversePhysicalLotEvidencePair({record_id:3,reason:'已撤销权限'}),null)
})

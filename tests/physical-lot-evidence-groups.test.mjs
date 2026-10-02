import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {validatePhysicalLotResult} from '../src/shared/physical-lot-validation.ts'
import {createAppState} from '../src/renderer/src/store/state.ts'
import {createPhysicalLotActions} from '../src/renderer/src/store/modules/physical-lot-actions.ts'

const input={pairs:[
  {inbound_movement_id:9,outbound_movement_id:10,quantity:'1.000'},
  {inbound_movement_id:9,outbound_movement_id:11,quantity:'1.000'}],
  lot_id:null,evidence:'三笔流水对应同一箱码和两张出库交接记录',
  supplier_lot:null,manufactured_on:null,expires_on:null}
const pair=(id,outbound)=>({id,inbound_movement_id:9,outbound_movement_id:outbound,
  inbound_evidence_id:id+10,outbound_evidence_id:id+20,lot_id:8,lot_code:'EVIDENCE-8',
  warehouse_id:1,material_id:3,quantity:'1.000',evidence:input.evidence,
  original_pair_id:null,created_by_name:'admin',created_at:'2026-10-03 10:00:00'})
const result={id:5,lot_id:8,lot_code:'EVIDENCE-8',warehouse_id:1,material_id:3,
  evidence:input.evidence,original_group_id:null,created_by_name:'admin',
  created_at:'2026-10-03 10:00:00',pairs:[pair(6,10),pair(7,11)]}

test('成组补证 IPC 固定路径、配对边界和冲销响应',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous})
  const calls=[]
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json(new URL(url).pathname.endsWith('/login')?{token:'token',user:{id:1}}:result)}
  await callBackend('login',{});calls.length=0
  assert.deepEqual(await callBackend('physicalLotEvidenceGroup',{...input,extra:'ignored'}),result)
  assert.equal(calls[0].path,'/api/v1/inventory/physical-lots/evidence-groups')
  assert.deepEqual(JSON.parse(calls[0].body),input)
  for(const invalid of [{...input,pairs:input.pairs.slice(0,1)},
    {...input,pairs:[input.pairs[0],input.pairs[0]]},
    {...input,pairs:[{...input.pairs[0],quantity:1},input.pairs[1]]},
    {...input,pairs:[{...input.pairs[0],outbound_movement_id:8},input.pairs[1]]}])
    await assert.rejects(callBackend('physicalLotEvidenceGroup',invalid))
  assert.equal(calls.length,1)
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json({...result,id:8,original_group_id:5,
      pairs:result.pairs.map(row=>({...row,quantity:'-1.000',original_pair_id:row.id}))})}
  assert.equal((await callBackend('physicalLotEvidenceGroupReverse',
    {record_id:5,reason:'实物签收单复核不一致，整组冲销'})).original_group_id,5)
  assert.equal(calls[1].path,'/api/v1/inventory/physical-lots/evidence-groups/5/reverse')
  assert.throws(()=>validatePhysicalLotResult('physicalLotEvidenceGroup',
    {...result,pairs:[{...result.pairs[0],lot_id:null}]}),/响应格式/)
})

test('成组补证拒绝范围错配和撤权后的写入',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  const state=createAppState()
  state.user.value={id:1,permissions:['inventory.view','physical_lot.movement_evidence']}
  globalThis.window={nexora:{callApi:async()=>({...result,pairs:[pair(6,12),pair(7,11)]})}}
  const actions=createPhysicalLotActions(state)
  assert.equal(await actions.savePhysicalLotEvidenceGroup(input),null)
  assert.match(state.lotError.value,/范围不一致/)
  state.user.value={id:1,permissions:['inventory.view']}
  assert.equal(await actions.savePhysicalLotEvidenceGroup(input),null)
  assert.equal(await actions.reversePhysicalLotEvidenceGroup({record_id:5,reason:'权限已撤销'}),null)
})

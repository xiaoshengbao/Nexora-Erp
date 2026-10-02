import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {createAppState} from '../src/renderer/src/store/state.ts'
import {createPhysicalLotActions} from '../src/renderer/src/store/modules/physical-lot-actions.ts'

const input={legacy_lot_id:7,warehouse_id:1,quantity:'1.250',
  evidence:'2026-10-03 现场逐箱核对并签字确认',supplier_lot:'S-1',
  manufactured_on:null,expires_on:null}
const result={id:1,legacy_lot_id:7,verified_lot_id:8,warehouse_id:1,
  quantity:'1.250',evidence:input.evidence,created_by_name:'admin',
  created_at:'2026-10-03 10:00:00',verified_lot_code:'VERIFIED-1',
  original_reclassification_id:null}

test('历史批次补证 IPC 固定路径并在发送前拒绝越界数量和空证据',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous})
  const calls=[]
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json(new URL(url).pathname.endsWith('/login')
      ? {token:'token',user:{id:1}} : result)}
  await callBackend('login',{});calls.length=0
  assert.deepEqual(await callBackend('physicalLotEvidence',input),result)
  assert.equal(calls[0].path,'/api/v1/inventory/physical-lots/reclassifications')
  assert.deepEqual(JSON.parse(calls[0].body),input)
  for(const invalid of [{...input,quantity:'0.000'},{...input,quantity:'2.1234'},
    {...input,warehouse_id:'../users'},{...input,evidence:'无'},
    {...input,manufactured_on:'2026-02-30'}])
    await assert.rejects(callBackend('physicalLotEvidence',invalid))
  assert.equal(calls.length,1)
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options?.body})
    return Response.json({...result,id:2,quantity:'-1.250',original_reclassification_id:1})}
  assert.equal((await callBackend('physicalLotEvidenceReverse',{
    record_id:1,reason:'现场复核发现原批次标签错误'})).original_reclassification_id,1)
  assert.equal(calls[1].path,'/api/v1/inventory/physical-lots/reclassifications/1/reverse')
  for(const invalid of [{record_id:0,reason:'现场复核发现原批次标签错误'},
    {record_id:1,reason:'短'}])
    await assert.rejects(callBackend('physicalLotEvidenceReverse',invalid))
  assert.equal(calls.length,2)
})

test('补证返回范围不匹配或会话失效时不接受旧批次证据',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  const state=createAppState()
  state.user.value={id:1,permissions:['inventory.view','physical_lot.reclassify']}
  globalThis.window={nexora:{callApi:async()=>({...result,legacy_lot_id:9})}}
  const actions=createPhysicalLotActions(state)
  assert.equal(await actions.savePhysicalLotEvidence(input),null)
  assert.match(state.lotError.value,/范围不一致/)
  globalThis.window.nexora.callApi=async()=>({...result,quantity:'-1.250'})
  assert.equal(await actions.reversePhysicalLotEvidence({record_id:1,reason:'现场复核发现原批次标签错误'}),null)
  assert.match(state.lotError.value,/原记录不一致/)
  state.user.value={id:1,permissions:['inventory.view']}
  assert.equal(await actions.savePhysicalLotEvidence(input),null)
  assert.equal(await actions.reversePhysicalLotEvidence({record_id:1,reason:'现场复核发现原批次标签错误'}),null)
})

test('服务端规范化数量文本后仍刷新批次快照',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  const state=createAppState()
  state.user.value={id:1,permissions:['inventory.view','physical_lot.reclassify']}
  const calls=[]
  globalThis.window={nexora:{callApi:async(action)=>{calls.push(action)
    return action==='physicalLotEvidence' ? {...result,quantity:'2.125'}
      : {as_of:'2026-10-03 10:00:00',warehouse_id:null,material_id:null,
        rows:[],differences:[],fully_allocated:true}}}}
  const actions=createPhysicalLotActions(state)
  assert.equal((await actions.savePhysicalLotEvidence({...input,quantity:'02.125'}))?.id,1)
  assert.deepEqual(calls,['physicalLotEvidence','physicalLotOverview'])
})

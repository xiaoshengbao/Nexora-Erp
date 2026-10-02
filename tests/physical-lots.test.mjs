import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {validatePhysicalLotResult} from '../src/shared/physical-lot-validation.ts'
import {createAppState} from '../src/renderer/src/store/state.ts'
import {createPhysicalLotActions} from '../src/renderer/src/store/modules/physical-lot-actions.ts'

const row={warehouse_id:1,warehouse_name:'主仓库',material_id:3,sku:'LOT-3',material_name:'试件',unit:'件',
  lot_id:7,lot_code:'LEGACY-W1-M3',source_kind:'legacy',supplier_lot:null,manufactured_on:null,expires_on:null,quantity:'2.000'}
const difference={warehouse_id:1,warehouse_name:'主仓库',material_id:3,sku:'LOT-3',
  stock_quantity:'2.125',lot_quantity:'2.000',difference:'0.125'}
const overview={as_of:'2026-10-02 09:00:00',warehouse_id:null,material_id:null,
  rows:[row],differences:[difference],fully_allocated:false}
const history={as_of:overview.as_of,lot:{id:7,material_id:3,code:row.lot_code,source_kind:'legacy',
  supplier_lot:null,manufactured_on:null,expires_on:null,origin_movement_id:null,
  sku:row.sku,material_name:row.material_name,unit:row.unit},
  openings:[{id:1,warehouse_id:1,warehouse_name:'主仓库',quantity:'2.000',checkpoint_movement_id:8,
    evidence:'无实物批次证据',created_at:overview.as_of}],movements:[],reclassifications:[],
  balances:[{warehouse_id:1,warehouse_name:'主仓库',quantity:'2.000'}]}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}

test('受限 IPC 只接受固定仓库、物料和批次编号',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous})
  const calls=[]
  globalThis.fetch=async(url)=>{calls.push(new URL(url).pathname+new URL(url).search)
    return Response.json(new URL(url).pathname.endsWith('/login')?{token:'token',user:{id:1}}
      :new URL(url).pathname.endsWith('/history')?history:overview)}
  await callBackend('login',{});calls.length=0
  await callBackend('physicalLotOverview',{warehouse_id:1,material_id:3,other:'ignored'})
  await callBackend('physicalLotHistory',{lot_id:7,other:'ignored'})
  assert.deepEqual(calls,['/api/v1/inventory/physical-lots/overview?warehouse_id=1&material_id=3',
    '/api/v1/inventory/physical-lots/7/history'])
  for(const invalid of [undefined,null,[],{warehouse_id:0,material_id:null},
    {warehouse_id:'1',material_id:null},{warehouse_id:null,material_id:'../users'}])
    await assert.rejects(callBackend('physicalLotOverview',invalid))
  for(const invalid of [0,'../users',NaN,true])
    await assert.rejects(callBackend('physicalLotHistory',{lot_id:invalid}))
  assert.equal(calls.length,2)
})

test('响应不能把缺失差额、未知数量或伪造来源当成已核对',()=>{
  validatePhysicalLotResult('physicalLotOverview',overview)
  validatePhysicalLotResult('physicalLotHistory',history)
  const evidence={id:1,legacy_lot_id:7,verified_lot_id:8,warehouse_id:1,quantity:'1.250',
    evidence:'现场逐箱核对并签字确认',created_by_name:'admin',created_at:overview.as_of,
    verified_lot_code:'VERIFIED-1',original_reclassification_id:null}
  validatePhysicalLotResult('physicalLotEvidence',evidence)
  for(const invalid of [{...overview,fully_allocated:true},{...overview,differences:[{...difference,difference:null}]},
    {...overview,rows:[{...row,quantity:2}]},{...overview,warehouse_id:0}])
    assert.throws(()=>validatePhysicalLotResult('physicalLotOverview',invalid),/响应格式/)
  for(const invalid of [{...history,lot:{...history.lot,id:'7'}},
    {...history,openings:[{...history.openings[0],checkpoint_movement_id:-1}]},
    {...history,movements:[{id:1,movement_id:2,quantity:null}]},
    {...history,reclassifications:[{id:1,quantity:'1.000'}]}])
    assert.throws(()=>validatePhysicalLotResult('physicalLotHistory',invalid),/响应格式/)
  assert.throws(()=>validatePhysicalLotResult('physicalLotEvidence',{...evidence,verified_lot_id:null}),/响应格式/)
})

test('筛选变化、迟到历史、断线和撤权都会失效旧批次证据',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  const pending=deferred()
  globalThis.window={nexora:{callApi:()=>pending.promise}}
  const state=createAppState();state.user.value={id:1,permissions:['inventory.view']}
  const actions=createPhysicalLotActions(state)
  const old=actions.loadPhysicalLots();state.lotWarehouseId.value=2;pending.resolve(overview)
  assert.equal(await old,false);assert.equal(state.lotOverview.value,null)
  globalThis.window.nexora.callApi=()=>Promise.resolve(overview)
  assert.equal(await actions.loadPhysicalLots(),false)
  assert.match(state.lotError.value,/范围不匹配/)
  state.lotWarehouseId.value=0
  assert.equal(await actions.loadPhysicalLots(),true)
  const detail=deferred();globalThis.window.nexora.callApi=()=>detail.promise
  const reading=actions.loadPhysicalLotHistory(row)
  state.connectionLost.value=true;detail.resolve(history)
  assert.equal(await reading,false);assert.equal(state.lotHistory.value,null)
  assert.equal(state.lotOverview.value,null)
  state.connectionLost.value=false
  globalThis.window.nexora.callApi=()=>Promise.resolve({...history,lot:{...history.lot,id:8}})
  assert.equal(await actions.loadPhysicalLotHistory(row),false)
  assert.match(state.lotError.value,/来源不匹配/)
  state.user.value={id:1,permissions:[]}
  assert.equal(await actions.loadPhysicalLots(),false)
  assert.equal(state.lotError.value,'')
})

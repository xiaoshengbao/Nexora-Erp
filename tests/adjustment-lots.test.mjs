import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {adjustmentLotBody, signedAdjustmentMilli} from '../src/shared/adjustment-lot-api.ts'
import {physicalLotKindLabel} from '../src/shared/physical-lot-api.ts'

const lines=[{adjustment_line_id:7,lots:[
  {lot_id:11,quantity:'0.250',supplier_lot:null,manufactured_on:null,expires_on:null,
    injected:'ignored'},
  {lot_id:null,quantity:'0.750',supplier_lot:'调整新增',manufactured_on:'2026-09-01',
    expires_on:'2027-09-01'}]}]

test('调整批次 IPC 固定请求字段并核对服务端凭据',async t=>{
  const calls=[]
  let oldServer=false
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({path:url.pathname,body:options.body})
    if(url.pathname.endsWith('/login'))return Response.json({token:'test-token',user:{id:1}})
    if(url.pathname.endsWith('/available-lots'))return Response.json({
      adjustment_id:3,warehouse_id:1,lines:[{adjustment_line_id:7,material_id:5,
        quantity:'1.000',lots:[
          {lot_id:11,code:'LOT-11',source_kind:'receipt',quantity:'1.000',
            supplier_lot:null,manufactured_on:null,expires_on:null}]}]})
    if(options.body&&!oldServer)return Response.json({id:3,status:'posted',lines:[{id:7,
      physical_lots:[{id:11,quantity:'0.250'},
        {id:12,quantity:'0.750',source_kind:'adjustment'}]}]})
    return Response.json({id:3,status:'posted',lines:[{id:7,physical_lots:[]}]})
  })
  await callBackend('login',{})
  const options=await callBackend('availableAdjustmentLots',{adjustmentId:3})
  assert.equal(options.lines[0].quantity,'1.000')
  await callBackend('postStockAdjustment',{adjustmentId:3,lines,other:'ignored'})
  assert.equal(calls.at(-1).path,'/api/v1/stock-adjustments/3/post')
  assert.deepEqual(JSON.parse(calls.at(-1).body),{lines:[{adjustment_line_id:7,lots:[
    {lot_id:11,quantity:'0.250',supplier_lot:null,manufactured_on:null,expires_on:null},
    {lot_id:null,quantity:'0.750',supplier_lot:'调整新增',manufactured_on:'2026-09-01',
      expires_on:'2027-09-01'}]}]})
  await callBackend('postStockAdjustment',{adjustmentId:3})
  assert.equal(calls.at(-1).body,undefined)
  oldServer=true
  await assert.rejects(callBackend('postStockAdjustment',{adjustmentId:3,lines}),/服务端未固定/)
  const before=calls.length
  for(const invalid of [
    [{...lines[0],adjustment_line_id:0}],
    [lines[0],lines[0]],
    [{...lines[0],lots:[{...lines[0].lots[0],quantity:'0'}]}],
    [{...lines[0],lots:[{...lines[0].lots[0],supplier_lot:'伪造'}]}],
    [{...lines[0],lots:[lines[0].lots[0],lines[0].lots[0]]}],
  ]) await assert.rejects(callBackend('postStockAdjustment',{adjustmentId:3,lines:invalid}))
  await assert.rejects(callBackend('postStockAdjustment',{adjustmentId:'../users',lines}))
  assert.equal(calls.length,before)
  assert.deepEqual(adjustmentLotBody({lines}).lines[0].lots[0],{
    lot_id:11,quantity:'0.250',supplier_lot:null,manufactured_on:null,expires_on:null})
  assert.equal(signedAdjustmentMilli('-1.250'),-1250n)
  assert.equal(physicalLotKindLabel('adjustment'),'调整新增')
})

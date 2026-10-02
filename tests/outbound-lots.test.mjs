import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {outboundLotBody} from '../src/shared/outbound-lot-api.ts'

const lines=[{outbound_line_id:7,lots:[{lot_id:11,quantity:'1.125',injected:'ignored'},
  {lot_id:12,quantity:'1.000'}]}]

test('其他出库 IPC 固定批次字段并核对服务端分配',async t=>{
  const calls=[]
  let oldServer=false
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({path:url.pathname,body:options.body})
    if(url.pathname.endsWith('/login'))return Response.json({token:'test-token',user:{id:1}})
    if(url.pathname.endsWith('/available-lots'))return Response.json({
      outbound_id:3,warehouse_id:1,lines:[{outbound_line_id:7,material_id:5,quantity:'2.125',lots:[
        {lot_id:11,code:'LOT-11',source_kind:'receipt',quantity:'1.125',
          supplier_lot:null,manufactured_on:null,expires_on:null},
        {lot_id:12,code:'LOT-12',source_kind:'legacy',quantity:'2.000',
          supplier_lot:null,manufactured_on:null,expires_on:null}]}]})
    if(options.body&&!oldServer)return Response.json({id:3,status:'posted',lines:[{id:7,physical_lots:[
      {id:11,quantity:'1.125'},{id:12,quantity:'1.000'}]}]})
    return Response.json({id:3,status:'posted',lines:[{id:7,physical_lots:[]}]})
  })
  await callBackend('login',{})
  const available=await callBackend('availableOutboundLots',{outboundId:3})
  assert.equal(available.lines[0].lots[1].source_kind,'legacy')
  await callBackend('postWarehouseOutbound',{outboundId:3,lines,other:'ignored'})
  assert.equal(calls.at(-1).path,'/api/v1/warehouse-outbounds/3/post')
  assert.deepEqual(JSON.parse(calls.at(-1).body),{lines:[{outbound_line_id:7,lots:[
    {lot_id:11,quantity:'1.125'},{lot_id:12,quantity:'1.000'}]}]})
  await callBackend('postWarehouseOutbound',{outboundId:3})
  assert.equal(calls.at(-1).body,undefined)
  oldServer=true
  await assert.rejects(callBackend('postWarehouseOutbound',{outboundId:3,lines}),/服务端未固定/)
  const before=calls.length
  for(const invalid of [
    [{...lines[0],outbound_line_id:0}],
    [lines[0],lines[0]],
    [{...lines[0],lots:[{lot_id:11,quantity:'1'}, {lot_id:11,quantity:'1.125'}]}],
    [{...lines[0],lots:[{lot_id:11,quantity:'0'}]}],
  ]) await assert.rejects(callBackend('postWarehouseOutbound',{outboundId:3,lines:invalid}))
  await assert.rejects(callBackend('postWarehouseOutbound',{outboundId:'../users',lines}))
  assert.equal(calls.length,before)
  assert.deepEqual(outboundLotBody({lines}).lines[0].lots[0],{lot_id:11,quantity:'1.125'})
})

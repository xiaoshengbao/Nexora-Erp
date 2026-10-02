import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {inboundLotBody} from '../src/shared/receipt-lot-validation.ts'

const lines=[{inbound_line_id:7,lots:[{quantity:'1.125',supplier_lot:' GIFT-01 ',
  manufactured_on:'2026-10-01',expires_on:'2027-10-01',injected:'ignored'},
{quantity:'1.000',supplier_lot:null,manufactured_on:null,expires_on:null}]}]

test('其他入库 IPC 固定批次字段、校验服务端证据并保留旧客户端路径',async t=>{
  const calls=[]
  let oldServer=false
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({path:url.pathname,body:options.body})
    if(url.pathname.endsWith('/login'))return Response.json({token:'test-token',user:{id:1}})
    if(options.body&&!oldServer)return Response.json({id:3,status:'posted',lines:[{id:7,physical_lots:[
      {id:10,code:'O3-L7-P1',quantity:'1.125',supplier_lot:'GIFT-01',manufactured_on:'2026-10-01',expires_on:'2027-10-01'},
      {id:11,code:'O3-L7-P2',quantity:'1.000',supplier_lot:null,manufactured_on:null,expires_on:null}]}]})
    return Response.json({id:3,status:'posted',lines:[{id:7,physical_lots:[]}]})
  })
  await callBackend('login',{})
  await callBackend('postOtherInbound',{inboundId:3,lines,other:'ignored'})
  assert.equal(calls.at(-1).path,'/api/v1/warehouse-inbounds/3/post')
  assert.deepEqual(JSON.parse(calls.at(-1).body),{lines:[{inbound_line_id:7,lots:[
    {quantity:'1.125',supplier_lot:'GIFT-01',manufactured_on:'2026-10-01',expires_on:'2027-10-01'},
    {quantity:'1.000',supplier_lot:null,manufactured_on:null,expires_on:null}]}]})
  await callBackend('postOtherInbound',{inboundId:4})
  assert.equal(calls.at(-1).body,undefined)
  oldServer=true
  await assert.rejects(callBackend('postOtherInbound',{inboundId:3,lines}),/服务端未固定本次其他入库/)
  oldServer=false
  const before=calls.length
  for(const invalid of [
    [{...lines[0],inbound_line_id:0}],
    [lines[0],lines[0]],
    [{...lines[0],lots:[{...lines[0].lots[0],quantity:'0'}]}],
    [{...lines[0],lots:[{...lines[0].lots[0],expires_on:'2026-09-30'}]}],
    [{...lines[0],lots:[{...lines[0].lots[0],manufactured_on:'2026-02-30'}]}]
  ])await assert.rejects(callBackend('postOtherInbound',{inboundId:3,lines:invalid}))
  await assert.rejects(callBackend('postOtherInbound',{inboundId:'../users',lines}))
  assert.equal(calls.length,before)
  assert.equal(inboundLotBody({lines}).lines[0].lots[0].supplier_lot,'GIFT-01')
})

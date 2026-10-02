import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {receiptLotDate,receiptLotMilli} from '../src/shared/receipt-lot-api.ts'
import {receiptLotBody} from '../src/shared/receipt-lot-validation.ts'

const lines=[{receipt_line_id:7,lots:[{quantity:'1.125',supplier_lot:'  SUP-1  ',
  manufactured_on:'2026-10-01',expires_on:'2027-10-01',injected:'ignored'},
  {quantity:'1.000',supplier_lot:null,manufactured_on:null,expires_on:null}]}]

test('批次数量与日期按精确业务口径校验',()=>{
  assert.equal(receiptLotMilli('1.125'),1125n)
  assert.equal(receiptLotMilli('1000000.000'),1000000000n)
  for(const value of ['0','0.000','-1','1.1234','1000000.001','NaN','1e2'])
    assert.equal(receiptLotMilli(value),null,value)
  assert.equal(receiptLotDate('2026-10-02'),true)
  assert.equal(receiptLotDate('2026-02-30'),false)
  assert.equal(receiptLotDate('2026/10/02'),false)
})

test('受限 IPC 仅传固定采购批次字段并拒绝非法输入',async t=>{
  const calls=[]
  let oldServer=false
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({path:url.pathname,body:options.body})
    if(url.pathname.endsWith('/login'))return Response.json({token:'test-token',user:{id:1}})
    if(options.body && !oldServer)return Response.json({id:3,status:'posted',lines:[{id:7,physical_lots:[
      {id:10,code:'R3-L7-P1',quantity:'1.125',supplier_lot:'SUP-1',manufactured_on:'2026-10-01',expires_on:'2027-10-01'},
      {id:11,code:'R3-L7-P2',quantity:'1.000',supplier_lot:null,manufactured_on:null,expires_on:null}]}]})
    return Response.json({id:3,status:'posted',lines:[{id:7,physical_lots:[]}]})
  })
  await callBackend('login',{})
  await callBackend('postReceipt',{receiptId:3,lines,other:'ignored'})
  assert.equal(calls.at(-1).path,'/api/v1/receipts/3/post')
  assert.deepEqual(JSON.parse(calls.at(-1).body),{lines:[{receipt_line_id:7,lots:[
    {quantity:'1.125',supplier_lot:'SUP-1',manufactured_on:'2026-10-01',expires_on:'2027-10-01'},
    {quantity:'1.000',supplier_lot:null,manufactured_on:null,expires_on:null}]}]})
  await callBackend('postReceipt',{receiptId:4})
  assert.equal(calls.at(-1).body,undefined)
  oldServer=true
  await assert.rejects(callBackend('postReceipt',{receiptId:3,lines}),/服务端未固定/)
  oldServer=false
  const before=calls.length
  for(const invalid of [
    [{...lines[0],receipt_line_id:0}],
    [lines[0],lines[0]],
    [{...lines[0],lots:[{...lines[0].lots[0],quantity:'0'}]}],
    [{...lines[0],lots:[{...lines[0].lots[0],expires_on:'2026-09-30'}]}],
    [{...lines[0],lots:[{...lines[0].lots[0],manufactured_on:'2026-02-30'}]}]
  ]) await assert.rejects(callBackend('postReceipt',{receiptId:3,lines:invalid}))
  await assert.rejects(callBackend('postReceipt',{receiptId:'../users',lines}))
  assert.equal(calls.length,before)
  assert.equal(receiptLotBody({lines}).lines[0].lots[0].supplier_lot,'SUP-1')
})

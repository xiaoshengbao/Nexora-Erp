import assert from 'node:assert/strict'
import {test} from 'node:test'
import {callBackend} from '../src/main/backend.ts'
import {completionLotBody} from '../src/shared/completion-lot-validation.ts'

const lots=[{quantity:'0.375',manufactured_on:'2026-10-01',expires_on:'2027-10-01',
  injected:'ignored'},{quantity:'0.625',manufactured_on:null,expires_on:null}]

test('完工确认 IPC 仅转发批次数量与日期，拒绝旧服务端伪成功',async t=>{
  const calls=[]
  let oldServer=false
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({path:url.pathname,body:options.body})
    if(url.pathname.endsWith('/login'))return Response.json({token:'test-token',user:{id:1}})
    if(options.body&&!oldServer)return Response.json({id:3,status:'posted',physical_lots:[
      {id:10,code:'P3-P1',quantity:'0.375',manufactured_on:'2026-10-01',expires_on:'2027-10-01'},
      {id:11,code:'P3-P2',quantity:'0.625',manufactured_on:null,expires_on:null}]})
    return Response.json({id:3,status:'posted',physical_lots:[]})
  })
  await callBackend('login',{})
  await callBackend('postProductionCompletion',{completionId:3,lots,other:'ignored'})
  assert.equal(calls.at(-1).path,'/api/v1/production-completions/3/post')
  assert.deepEqual(JSON.parse(calls.at(-1).body),{lots:[
    {quantity:'0.375',manufactured_on:'2026-10-01',expires_on:'2027-10-01'},
    {quantity:'0.625',manufactured_on:null,expires_on:null}]})
  await callBackend('postProductionCompletion',{completionId:4})
  assert.equal(calls.at(-1).body,undefined)
  oldServer=true
  await assert.rejects(callBackend('postProductionCompletion',{completionId:3,lots}),
    /服务端未固定本次合格完工/)
  oldServer=false
  const wrongCode=lots.map(part=>({...part}))
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({path:url.pathname,body:options.body})
    return Response.json({id:3,status:'posted',physical_lots:[
      {id:10,code:'P3-P99',quantity:'0.375',manufactured_on:'2026-10-01',expires_on:'2027-10-01'},
      {id:11,code:'P3-P2',quantity:'0.625',manufactured_on:null,expires_on:null}]})
  })
  await assert.rejects(callBackend('postProductionCompletion',{completionId:3,lots:wrongCode}),
    /服务端未固定本次合格完工/)
  const before=calls.length
  for(const invalid of [
    [],[{...lots[0],quantity:'0'}],
    [{...lots[0],expires_on:'2026-09-30'}],
    [{...lots[0],manufactured_on:'2026-02-30'}]
  ])await assert.rejects(callBackend('postProductionCompletion',{completionId:3,lots:invalid}))
  await assert.rejects(callBackend('postProductionCompletion',{completionId:'../users',lots}))
  assert.equal(calls.length,before)
  assert.deepEqual(completionLotBody({lots}).lots[0],{
    quantity:'0.375',manufactured_on:'2026-10-01',expires_on:'2027-10-01'})
})

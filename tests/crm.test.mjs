import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAppState } from '../src/renderer/src/store/state.ts'
import { createCrmActions,emptyCrmForms } from '../src/renderer/src/store/modules/crm-actions.ts'
import { crmFormError,quoteActions,crmSnapshotRows } from '../src/renderer/src/views/workspace/sales/crm-display.ts'
import { callBackend } from '../src/main/backend.ts'
import { canVisitRoute,routeByKey } from '../src/renderer/src/router/workspace-routes.ts'

const permissions=['crm.view','crm_contact.manage','crm_activity.manage','crm_opportunity.manage','crm_quote.create','crm_quote.submit','crm_quote.convert','sales_order.create']
const quote={id:1,version:3,status:'approved',opportunity_version:2,opportunity_stage:'qualified',review_blocked:[1],expired:false,contact_active:true}
const quoteInput={opportunity_id:1,contact_id:null,reference:'Q-1',valid_until:'2030-01-31',terms:'确认后交货',lines:[{material_id:1,quantity:'1.005',unit_price:'0.9999'}]}
const overview={contacts:[],activities:[],opportunities:[],quotes:[]}
const options={customers:[],owners:[],materials:[]}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
function fixture(t,callApi,perform=run=>run()){
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  globalThis.window={nexora:{callApi}}
  const state=createAppState();state.user.value={id:1,permissions}
  return {state,actions:createCrmActions(state,perform)}
}

test('CRM 入口不被普通销售查看权限放开，审核和转单按实际阶段授权',()=>{
  assert.equal(canVisitRoute(routeByKey('customerRelations'),['sales.view']),false)
  assert.equal(canVisitRoute(routeByKey('customerRelations'),['crm.view']),true)
  assert.deepEqual(quoteActions({...quote,status:'submitted'},['crm_quote.review'],1),[])
  assert.deepEqual(quoteActions({...quote,status:'submitted'},['crm_quote.review'],2),['approve','reject'])
  assert.deepEqual(quoteActions(quote,['crm_quote.convert'],2),[])
  assert.deepEqual(quoteActions(quote,permissions,2),['convert'])
  assert.deepEqual(quoteActions({...quote,opportunity_stage:'won'},permissions,2),[])
  assert.deepEqual(quoteActions({...quote,expired:true},permissions,2),[])
  assert.deepEqual(quoteActions({...quote,contact_active:false},permissions,2),[])
  assert.deepEqual(quoteActions({...quote,status:'submitted',contact_active:false},['crm_quote.review'],2),['reject'])
})

test('表单约束拒绝非法日期、精度、重复行和不完整归属',()=>{
  const forms=emptyCrmForms();forms.quote=structuredClone(quoteInput)
  assert.equal(crmFormError('quote',forms),'')
  for(const patch of [{valid_until:'2030-02-30'},{reference:' '},{opportunity_id:0},
    {lines:[{...quoteInput.lines[0],quantity:'0'}]},{lines:[{...quoteInput.lines[0],unit_price:'1e3'}]},
    {lines:[{...quoteInput.lines[0],unit_price:'0.00001'}]},{lines:[quoteInput.lines[0],quoteInput.lines[0]]}]){
    assert.ok(crmFormError('quote',{...forms,quote:{...quoteInput,...patch}}))
  }
  assert.ok(crmFormError('contact',forms));assert.ok(crmFormError('activity',forms));assert.ok(crmFormError('opportunity',forms))
  forms.opportunity={customer_id:1,contact_id:null,title:'设备',owner_id:1,stage:'qualified',estimated_amount:'1.001',expected_close_date:'2030-01-31',note:''}
  assert.ok(crmFormError('opportunity',forms));forms.opportunity.estimated_amount='100.01';assert.equal(crmFormError('opportunity',forms),'')
  assert.ok(crmSnapshotRows('quote',{...quote,party:{customer_name:'固定客户',contact_name:'王女士'}}).some(row=>row.label==='报价客户' && row.value==='固定客户'))
})

test('IPC 白名单阻止路径注入、状态和金额伪造，清除表格内部行标记',async t=>{
  const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old});const requests=[]
  globalThis.fetch=async(url,config)=>{requests.push({path:new URL(url).pathname,method:config.method,body:config.body?JSON.parse(config.body):null});
    return new Response(JSON.stringify(new URL(url).pathname.endsWith('/login')?{token:'test',user:{id:1}}:{}),{status:200})}
  await callBackend('login',{});requests.length=0
  await callBackend('saveCrmQuote',{...quoteInput,status:'approved',customer_id:22,total_amount:'0',lines:quoteInput.lines.map(row=>({...row,_X_ROW_KEY:'ui',line_total:'0'}))})
  assert.deepEqual(requests[0],{path:'/api/v1/crm/quotes',method:'POST',body:quoteInput})
  await callBackend('convertCrmQuote',{id:1,version:3,opportunity_version:2,reason:'转单',acceptance_reference:'客户邮件',lines:[],total_amount:'0'})
  assert.deepEqual(requests[1].body,{version:3,opportunity_version:2,reason:'转单',acceptance_reference:'客户邮件'})
  for(const id of [true,0,1.2,'1/../../users'])await assert.rejects(callBackend('crmDetail',{kind:'quote',id}),/编号无效/)
  await assert.rejects(callBackend('crmDetail',{kind:'quote/../../roles',id:1}),/类型无效/)
  await assert.rejects(callBackend('changeCrmQuote',{id:1,version:3,action:'post'}),/不允许/)
  await assert.rejects(callBackend('closeCrmActivity',{id:1,version:1,action:'convert'}),/不允许/)
  await assert.rejects(callBackend('saveCrmQuote',{...quoteInput,lines:null}),/明细无效/)
  assert.equal(requests.length,2)
})

test('较旧详情、迟到错误和关闭后的结果不能覆盖当前记录',async t=>{
  const pending=deferred();const {state,actions}=fixture(t,(action,data)=>data.id===1?pending.promise:Promise.resolve(action==='crmDetail'?{id:2}:[]))
  const first=actions.loadCrmDetail('quote',1);assert.equal(await actions.loadCrmDetail('contact',2),true)
  pending.resolve({id:1});assert.equal(await first,false);assert.equal(state.crmDetail.value.kind,'contact');assert.equal(state.crmDetail.value.record.id,2)
  const late=deferred();globalThis.window.nexora.callApi=()=>late.promise
  const read=actions.loadCrmDetail('quote',3);actions.clearCrmDetail();late.resolve(quote)
  assert.equal(await read,false);assert.equal(state.crmDetail.value,null)
})

test('断线作废敏感资料但保留全部输入，换号撤权后清除表单',async t=>{
  const pending=deferred();const {state,actions}=fixture(t,()=>pending.promise)
  state.crmForms.value.quote=structuredClone(quoteInput);state.crmEdit.value={quote:{kind:'quote',id:1,version:3,reason:'更正'}}
  const read=actions.loadCrm();state.connectionLost.value=true;pending.resolve(options)
  assert.equal(await read,false);assert.equal(state.crmOverview.value,null);assert.equal(state.crmForms.value.quote.reference,'Q-1')
  state.user.value={id:2,permissions:['crm.view']}
  assert.equal(state.crmForms.value.quote.reference,'');assert.deepEqual(state.crmEdit.value,{})
})

test('保存冲突保留输入、修订原因和行标记，成功后清空且读取证据',async t=>{
  const calls=[];let fail=true
  const {state,actions}=fixture(t,async(action,data)=>{calls.push([action,data]);if(action==='saveCrmQuote'){if(fail)throw Error('版本冲突');return {...quote,id:9}}
    return action==='crmOptions'?options:action==='crmOverview'?overview:action==='crmChanges'?[]:{...quote,id:9}},async run=>{try{await run()}catch{}})
  state.crmForms.value.quote={...structuredClone(quoteInput),lines:quoteInput.lines.map(row=>({...row,_X_ROW_KEY:'ui'}))}
  state.crmEdit.value={quote:{kind:'quote',id:1,version:3,reason:'价格修订'}}
  assert.equal(await actions.saveCrm('quote'),false);assert.equal(state.crmForms.value.quote.reference,'Q-1');assert.equal(state.crmEdit.value.quote.reason,'价格修订')
  assert.deepEqual(calls[0][1],{...quoteInput,id:1,version:3,reason:'价格修订'})
  fail=false;assert.equal(await actions.saveCrm('quote'),true);assert.equal(state.crmForms.value.quote.reference,'');assert.equal(state.crmDetail.value.record.id,9)
})

test('旧会话保存结束不能清除新账号草稿；未发出的旧保存不能使用新会话',async t=>{
  const pending=deferred();const {state,actions}=fixture(t,()=>pending.promise)
  state.crmForms.value.quote=structuredClone(quoteInput);const write=actions.saveCrm('quote')
  state.user.value={id:2,permissions};state.crmForms.value.quote.reference='新账号草稿';pending.resolve(quote)
  assert.equal(await write,false);assert.equal(state.crmForms.value.quote.reference,'新账号草稿')
  const gate=deferred();let called=false
  const delayed=fixture(t,()=>{called=true;return Promise.resolve(quote)},async run=>{await gate.promise;await run()})
  const oldWrite=delayed.actions.saveCrm('quote');delayed.state.user.value={id:3,permissions};gate.resolve()
  assert.equal(await oldWrite,false);assert.equal(called,false)
})

test('只读 CRM 可读资料证据，缺少原单权限不能转单',async t=>{
  const calls=[];const {state,actions}=fixture(t,async action=>{calls.push(action);return action==='crmOptions'?options:overview})
  state.user.value={id:2,permissions:['crm.view']}
  assert.equal(await actions.loadCrm(),true);assert.equal(await actions.saveCrm('contact'),false)
  assert.equal(await actions.changeCrmQuote(quote,'approve','核对'),false)
  assert.equal(await actions.closeCrmActivity({id:1,version:1},'complete','完成'),false)
  state.user.value={id:2,permissions:['crm.view','crm_quote.convert']}
  assert.equal(await actions.convertCrmQuote(quote,'接受依据','转单'),false)
  assert.deepEqual(calls,['crmOptions','crmOverview'])
})

test('详情读取失败保留编辑表单并提供错误，不打开过期记录编辑',async t=>{
  const {state,actions}=fixture(t,()=>Promise.reject(Error('读取失败')))
  state.crmForms.value.contact.name='未保存联系人'
  assert.equal(await actions.editCrm('contact',1),false);assert.deepEqual(state.crmEdit.value,{})
  assert.equal(state.crmForms.value.contact.name,'未保存联系人');assert.match(state.crmError.value,/读取失败/)
})

test('跨类型新建及保存保留其他修订的原版本，显式同类新建清空旧编辑',async t=>{
  const calls=[];const {state,actions}=fixture(t,async(action,data)=>{calls.push([action,data]);
    return action==='crmOptions'?options:action==='crmOverview'?overview:action==='crmChanges'?[]:{...quote,id:9}})
  state.crmForms.value.quote=structuredClone(quoteInput)
  state.crmEdit.value.quote={kind:'quote',id:1,version:3,reason:'价格修订'}
  state.crmForms.value.contact.name='另一个联系人草稿'
  actions.startNewCrm('contact')
  assert.equal(state.crmForms.value.contact.name,'另一个联系人草稿')
  assert.equal(state.crmEdit.value.quote.version,3)
  await actions.saveCrm('contact')
  assert.equal(state.crmEdit.value.quote.reason,'价格修订')
  await actions.saveCrm('quote')
  assert.deepEqual(calls.find(([action])=>action==='saveCrmQuote')[1],{...quoteInput,id:1,version:3,reason:'价格修订'})
  assert.deepEqual(state.crmEdit.value,{})
  state.crmForms.value.quote=structuredClone(quoteInput)
  state.crmEdit.value.quote={kind:'quote',id:1,version:3,reason:'旧修订'}
  actions.startNewCrm('quote')
  assert.equal(state.crmForms.value.quote.reference,'');assert.deepEqual(state.crmEdit.value,{})
})

test('已关闭商机的旧草稿不可进入修订，原未保存输入保留',async t=>{
  const {state,actions}=fixture(t,action=>Promise.resolve(action==='crmChanges'?[]:{...quote,status:'draft',opportunity_stage:'won'}))
  state.crmForms.value.quote.reference='未保存报价'
  assert.equal(await actions.editCrm('quote',1),false)
  assert.equal(state.crmForms.value.quote.reference,'未保存报价');assert.deepEqual(state.crmEdit.value,{})
})

import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createAppState} from '../src/renderer/src/store/state.ts'
import {createDashboardActions} from '../src/renderer/src/store/modules/dashboard-actions.ts'
import {callBackend} from '../src/main/backend.ts'
import {validateDashboardResult} from '../src/shared/dashboard-api.ts'
const emptyResult={period:'7d',currency:'CNY',time_basis:'UTC',generated_at:'2026-10-01T12:00:00+00:00',
  from_date:'2026-09-25',to_date:'2026-10-01',previous_from_date:'2026-09-18',previous_to_date:'2026-09-24',
  finance:null,sales:null,purchase:null,production:null,inventory:null,composition:[]}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
function fixture(t,callApi){
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  globalThis.window={nexora:{callApi}}
  const state=createAppState();state.user.value={id:1,permissions:['finance.view']}
  return {state,actions:createDashboardActions(state)}
}
test('首页 IPC 只接受固定统计范围，不转发客户端权限或日期',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous})
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push([new URL(url).pathname,options.body?JSON.parse(options.body):null]);return new Response(JSON.stringify(new URL(url).pathname.endsWith('/login')?{token:'test',user:{id:1}}:emptyResult),{status:200})}
  await callBackend('login',{});calls.length=0
  await callBackend('dashboard',{period:'7d',permissions:['admin'],from_date:'2000-01-01'})
  assert.deepEqual(calls,[['/api/v1/dashboard/query',{period:'7d'}]])
  for(const period of [true,7,'../finance','365d',null])await assert.rejects(callBackend('dashboard',{period}),/范围无效/)
  assert.equal(calls.length,1)
})
test('首页拒绝旧版响应、跨期间快照和异常金额或单量',()=>{
  validateDashboardResult(emptyResult,'7d')
  for(const row of [{},null,{...emptyResult,period:'30d'},{...emptyResult,sales:{draft:-1,waiting:0}},
    {...emptyResult,finance:{sales:{current:{amount:'NaN'},previous:{amount:'0.00'}}}}]){
    assert.throws(()=>validateDashboardResult(row,'7d'),/响应格式不匹配/)
  }
})
test('切换期间、身份、权限、实例和断线都清除快照并拒绝迟到响应',async t=>{
  for(const mutate of [state=>state.dashboardPeriod.value='30d',state=>state.user.value={id:2,permissions:['finance.view']},
    state=>state.user.value={id:1,permissions:[]},state=>state.server.value={id:'other',fingerprint:'new'},state=>state.connectionLost.value=true]){
    const pending=deferred(),{state,actions}=fixture(t,()=>pending.promise)
    state.dashboardResult.value={finance:{secret:100}}
    const load=actions.loadDashboard();assert.equal(state.dashboardResult.value,null)
    mutate(state);pending.resolve({period:'7d',finance:{secret:200}})
    assert.equal(await load,false);assert.equal(state.dashboardResult.value,null);assert.equal(state.dashboardLoading.value,false)
  }
})
test('失败清除旧结果，重试成功；旧失败不能清除新查询结果',async t=>{
  const first=deferred();let calls=0
  const {state,actions}=fixture(t,()=>++calls===1?first.promise:Promise.resolve({period:'7d',finance:null}))
  const old=actions.loadDashboard();assert.equal(await actions.loadDashboard(),true);first.resolve({period:'30d'})
  assert.equal(await old,false);assert.equal(state.dashboardResult.value.period,'7d')
  globalThis.window.nexora.callApi=()=>Promise.reject(Error('服务端拒绝'))
  assert.equal(await actions.loadDashboard(),false);assert.equal(state.dashboardResult.value,null);assert.match(state.dashboardError.value,/服务端拒绝/)
  state.connectionLost.value=true;assert.equal(state.dashboardError.value,'');assert.equal(await actions.loadDashboard(),false)
  state.connectionLost.value=false;globalThis.window.nexora.callApi=()=>Promise.resolve({period:'7d'})
  assert.equal(await actions.loadDashboard(),true);assert.equal(state.dashboardError.value,'')
})

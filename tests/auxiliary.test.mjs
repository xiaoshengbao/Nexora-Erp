import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reactive } from 'vue'
import { createAppState } from '../src/renderer/src/store/state.ts'
import { createAuxiliaryActions } from '../src/renderer/src/store/modules/auxiliary-actions.ts'
import { createJournalActions } from '../src/renderer/src/store/modules/journal-actions.ts'
import { createOpeningBalanceActions } from '../src/renderer/src/store/modules/opening-balance-actions.ts'
import { callBackend } from '../src/main/backend.ts'
import { auxiliaryText, replaceAuxiliary } from '../src/renderer/src/views/workspace/finance/auxiliary-display.ts'
import { localTime } from '../src/renderer/src/utils/formatters.ts'
import { openingTotals } from '../src/renderer/src/views/workspace/finance/opening-display.ts'
import { routeByKey, canVisitRoute } from '../src/renderer/src/router/workspace-routes.ts'

const permissions = ['auxiliary.view', 'auxiliary.manage', 'auxiliary.configure', 'journal.create', 'opening_balance.create']
const filters = { account_id: 1, kind: 'customer', from_date: '2026-01-01', to_date: '2026-01-31', entity_id: null }
const options = { accounts: [], periods: [], auxiliary_items: [], auxiliary_policies: [], kinds: {} }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('辅助报告时间与 SQLite 审计时间按同一时刻显示，不重复添加时区', () => {
  assert.equal(localTime('2026-01-01T00:00:00+00:00'), localTime('2026-01-01 00:00:00'))
  assert.equal(localTime('2026-01-01T08:00:00+08:00'), localTime('2026-01-01T00:00:00Z'))
  assert.equal(localTime('非法时间'), '非法时间')
})

test('凭证迟到辅助选项不覆盖新编辑请求，账号切换清空旧草稿', async t => {
  const old = globalThis.window; t.after(() => { globalThis.window = old })
  const state = createAppState(); state.user.value = { id: 1, permissions }
  const first = deferred(), second = deferred(); let count = 0
  globalThis.window = { nexora: { callApi: () => ++count === 1 ? first.promise : second.promise } }
  const actions = createJournalActions(state, action => action())
  const initial = actions.editJournal(); const rejected = assert.rejects(initial, /会话或权限已变化/)
  const latest = actions.editJournal()
  second.resolve({ accounts: [{ id: 2 }], periods: [] }); await latest
  first.resolve({ accounts: [{ id: 1 }], periods: [] }); await rejected
  assert.equal(state.journalOptions.value.accounts[0].id, 2)
  state.user.value = { id: 2, permissions: ['journal.view'] }
  assert.deepEqual(state.journalOptions.value, { accounts: [], periods: [] })
  assert.deepEqual(state.journalForm.value.lines, [])
})

test('同账号断线与恢复保留未保存凭证和辅助选择，同时失效迟到读取', async t => {
  const old = globalThis.window; t.after(() => { globalThis.window = old })
  const state = createAppState(); state.user.value = { id: 1, permissions }
  const reply = deferred()
  globalThis.window = { nexora: { callApi: () => reply.promise } }
  const actions = createJournalActions(state, action => action())
  const draft = { id: null, version: 1, reference: '保留草稿', journal_date: '2026-01-20', note: '未提交', reason: '核对',
    lines: [{ account_id: 1, summary: '项目款', debit: '15000.23', credit: '0', auxiliary: [{ kind: 'project', id: 3 }] }] }
  state.journalForm.value = draft
  state.journalOptions.value = { accounts: [{ id: 1 }], periods: [] }
  const pending = actions.editJournal(); const rejected = assert.rejects(pending, /会话或权限已变化/)
  state.connectionLost.value = true
  assert.deepEqual(state.journalForm.value, draft)
  state.connectionLost.value = false
  assert.deepEqual(state.journalForm.value, draft)
  reply.resolve({ accounts: [{ id: 2 }], periods: [] }); await rejected
  assert.equal(state.journalOptions.value.accounts[0].id, 1)
  assert.deepEqual(state.journalForm.value, draft)
})
function fixture(t, callApi, perform = action => action()) {
  const old = globalThis.window; t.after(() => { globalThis.window = old })
  globalThis.window = { nexora: { callApi } }
  const state = createAppState(); state.user.value = { id: 1, permissions }; state.auxiliaryQuery.value = { ...filters }
  return { state, actions: createAuxiliaryActions(state, perform) }
}

test('辅助核算入口有独立权限，科目与凭证查看权限不能替代', () => {
  const route = routeByKey('auxiliaryAccounting')
  assert.equal(route.path, '/workspace/auxiliary-accounting')
  assert.equal(canVisitRoute(route, ['auxiliary.view']), true)
  assert.equal(canVisitRoute(route, ['finance.view', 'journal.view']), false)
})

test('辅助选择每类最多一个，不改写原选择；历史快照和未分配都有明确文案', () => {
  const original = [{ kind: 'customer', id: 3 }, { kind: 'project', id: 5 }]
  assert.deepEqual(replaceAuxiliary(original, 'customer', 4), [{ kind: 'customer', id: 4 }, { kind: 'project', id: 5 }])
  assert.deepEqual(replaceAuxiliary(original, 'customer', 0), [{ kind: 'project', id: 5 }])
  assert.equal(original[0].id, 3)
  assert.equal(auxiliaryText(), '未分配')
  assert.match(auxiliaryText([{ kind: 'project', id: 1, code: 'P1', name: '原名称' }]), /项目：P1 · 原名称/)
})

test('同科目不同辅助组合的期初可精确平衡，同组合顺序不同仍拒绝', () => {
  const lines = [
    { account_id: 1, debit: '0.10', credit: '0', summary: '甲', auxiliary: [{ kind: 'project', id: 1 }] },
    { account_id: 1, debit: '0.20', credit: '0', summary: '乙', auxiliary: [{ kind: 'project', id: 2 }] },
    { account_id: 2, debit: '0', credit: '0.30', summary: '权益' }
  ]
  assert.deepEqual(openingTotals(lines), { debit: '0.30', credit: '0.30', balanced: true })
  lines[1].auxiliary = [{ kind: 'project', id: 1 }]
  assert.equal(openingTotals(lines).balanced, false)
  const a = [{ kind: 'project', id: 1 }, { kind: 'department', id: 2 }]
  lines[0].auxiliary = a; lines[1].auxiliary = [...a].reverse()
  assert.equal(openingTotals(lines).balanced, false)
})

test('查询条件改变后迟到金额和错误都不会覆盖，后续可重试', async t => {
  const pending = deferred()
  const { state, actions } = fixture(t, () => pending.promise)
  const run = actions.queryAuxiliary()
  state.auxiliaryQuery.value.kind = 'project'
  pending.resolve({ csv: '旧客户金额' })
  assert.equal(await run, false)
  assert.equal(state.auxiliaryReport.value, null)
  assert.equal(state.auxiliaryLoading.value, false)
  globalThis.window.nexora.callApi = async () => ({ csv: '项目金额' })
  assert.equal(await actions.queryAuxiliary(), true)
  assert.equal(state.auxiliaryReport.value.csv, '项目金额')
})

test('重新读取选项时旧查询完成不会提前清除加载状态', async t => {
  const query = deferred(), load = deferred()
  const { state, actions } = fixture(t, name => name === 'queryAuxiliary' ? query.promise : name === 'auxiliaryOptions' ? load.promise : Promise.resolve([]))
  const first = actions.queryAuxiliary(); const second = actions.loadAuxiliaryOptions()
  query.resolve({ csv: '旧查询' }); await first
  assert.equal(state.auxiliaryLoading.value, true)
  load.resolve(options); assert.equal(await second, true)
  assert.equal(state.auxiliaryLoading.value, false)
  assert.equal(state.auxiliaryReport.value, null)
})

test('会话切换和撤权立即清除辅助证据，迟到选项不回写', async t => {
  const pending = deferred()
  const { state, actions } = fixture(t, name => name === 'auxiliaryOptions' ? pending.promise : Promise.resolve([]))
  state.auxiliaryReport.value = { csv: '旧账号' }; state.auxiliaryChanges.value = [{ id: 1 }]
  const run = actions.loadAuxiliaryOptions()
  state.user.value = { id: 2, permissions: [] }
  pending.resolve(options)
  assert.equal(await run, false)
  assert.equal(state.auxiliaryOptions.value, null)
  assert.equal(state.auxiliaryReport.value, null)
  assert.deepEqual(state.auxiliaryChanges.value, [])
  assert.equal(state.auxiliaryLoading.value, false)
})

test('辅助写入拒绝只读和离线，保存失败保留输入并允许重试', async t => {
  let calls = 0
  const { state, actions } = fixture(t, async name => { calls++; if (name === 'createAuxiliaryItem') throw Error('版本冲突'); return name === 'auxiliaryOptions' ? options : [] }, async action => { try { await action() } catch (error) { state.error.value = error.message } })
  const input = reactive({ kind: 'department', code: 'RD', name: '研发', reason: '核对' })
  assert.equal(await actions.createAuxiliaryItem(input), false)
  assert.equal(input.name, '研发'); assert.equal(state.error.value, '版本冲突')
  state.connectionLost.value = true
  assert.equal(await actions.createAuxiliaryItem(input), false); assert.equal(calls, 1)
  state.connectionLost.value = false; state.user.value = { id: 1, permissions: ['auxiliary.view'] }
  assert.equal(await actions.saveAuxiliaryPolicy({ ...input, account_id: 1, version: 0, start_date: filters.from_date, required_kinds: [] }), false)
  assert.equal(calls, 1)
})

test('凭证和期初序列化只发送辅助类型编号，保留编辑输入并避免 Vue Proxy', async t => {
  const seen = []
  const { state } = fixture(t, async (name, input) => { seen.push({ name, input: structuredClone(input) }); return {} })
  const line = { account_id: 1, summary: '余额', debit: '1', credit: '0', auxiliary: [{ kind: 'project', id: 2, code: 'OLD', name: '原名称' }] }
  state.journalForm.value = { id: null, version: 1, reference: 'J', journal_date: filters.from_date, note: '', reason: '核对', lines: [line] }
  await createJournalActions(state, action => action()).saveJournal()
  assert.deepEqual(seen[0].input.lines[0].auxiliary, [{ kind: 'project', id: 2 }])
  state.openingBalanceForm.value = { id: null, version: 1, reference: 'O', effective_date: filters.from_date, note: '', reason: '核对', lines: [line] }
  await createOpeningBalanceActions(state, action => action()).saveOpeningBalance()
  assert.deepEqual(seen[1].input.lines[0].auxiliary, [{ kind: 'project', id: 2 }])
})

test('CSV 导出只使用当前服务端快照，撤权后不写成功消息', async t => {
  const pending = deferred()
  const { state, actions } = fixture(t, async () => ({}))
  const seen = []; globalThis.window.nexora.saveReportCsv = async (...args) => { seen.push(args); return pending.promise }
  state.auxiliaryReport.value = { account: { code: '1001' }, filters, csv: '\ufeff服务端精确金额' }
  const run = actions.exportAuxiliary(); state.user.value = null; pending.resolve(true); await run
  assert.deepEqual(seen[0], ['auxiliary-1001-customer-2026-01-01-2026-01-31.csv', '\ufeff服务端精确金额'])
  assert.equal(state.notice.value, '')
  await actions.exportAuxiliary(); assert.equal(seen.length, 1)
})

test('辅助 IPC 固定路径，拒绝路径注入，剔除快照金额及嵌套字段', async t => {
  const old = process.env.NEXORA_API_URL
  t.after(() => { if (old === undefined) delete process.env.NEXORA_API_URL; else process.env.NEXORA_API_URL = old })
  process.env.NEXORA_API_URL = 'http://127.0.0.1:8123'
  const seen = []
  t.mock.method(globalThis, 'fetch', async (url, request) => { seen.push({ path: url.pathname, method: request.method, body: request.body }); return Response.json(url.pathname.endsWith('/login') ? { token: 'test-token', user: { id: 1 } } : {}) })
  await callBackend('login', {})
  await callBackend('auxiliaryOptions', undefined); assert.equal(seen.at(-1).path, URL('/options'))
  await callBackend('auxiliaryChanges', undefined); assert.equal(seen.at(-1).path, URL('/changes'))
  await assert.rejects(callBackend('updateAuxiliaryItem', { id: '../users' }))
  await assert.rejects(callBackend('saveAuxiliaryPolicy', { account_id: true }))
  const item = { kind: 'department', code: 'RD', name: '研发', reason: '核对' }
  await callBackend('createAuxiliaryItem', { ...item, version: 99, changed_by: 9 })
  assert.deepEqual(JSON.parse(seen.at(-1).body), item)
  await callBackend('queryAuxiliary', { ...filters, rows: ['伪造'] })
  assert.deepEqual(JSON.parse(seen.at(-1).body), filters)
  await callBackend('generateBusinessJournal', { source_key: 'receipt:1', fingerprint: 'a'.repeat(64), policy_version: 1, reference: 'B', journal_date: filters.from_date, reason: '核对',
    auxiliary_by_role: { payable: [{ kind: 'supplier', id: 2, name: '伪造', amount: '99' }] } })
  assert.deepEqual(JSON.parse(seen.at(-1).body).auxiliary_by_role, { payable: [{ kind: 'supplier', id: 2 }] })
})
const URL = suffix => '/api/v1/finance/auxiliary' + suffix

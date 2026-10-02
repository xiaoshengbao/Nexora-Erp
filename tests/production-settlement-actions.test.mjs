import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref } from 'vue'
import { createProductionActions } from '../src/renderer/src/store/modules/production-actions.ts'

test('结算请求失败保留草稿和冲销原因，成功后清理并等待统一刷新', async t => {
  const original = globalThis.window
  t.after(() => { globalThis.window = original })
  const calls = []
  let fail = true
  globalThis.window = { nexora: { async callApi(operation, payload) {
    calls.push([operation, structuredClone(payload)])
    if (fail) throw new Error('来源成本已用于后续结算')
    return { id: 1 }
  } } }
  const state = {
    productionSettlementForm: ref({ work_order_id: 7, reference: 'COST-7', note: '成本复核' }),
    settlementReversalReasons: ref({ 1: '  单价更正  ' })
  }
  const feedback = []
  const actions = createProductionActions(state, async (action, success) => {
    try { await action(); feedback.push(success) } catch { /* 错误由共享消息层展示。 */ }
  }, () => {})
  await actions.settleProductionCost()
  assert.deepEqual(calls[0], ['settleProductionCost', { work_order_id: 7, reference: 'COST-7', note: '成本复核' }])
  assert.equal(state.productionSettlementForm.value.reference, 'COST-7')
  await actions.reverseProductionSettlement(1)
  assert.deepEqual(calls[1], ['reverseProductionSettlement', { settlementId: 1, reason: '单价更正' }])
  assert.equal(state.settlementReversalReasons.value[1], '  单价更正  ')
  assert.deepEqual(feedback, [])
  fail = false
  await actions.settleProductionCost()
  assert.deepEqual(state.productionSettlementForm.value, { work_order_id: 0, reference: '', note: '' })
  await actions.reverseProductionSettlement(1)
  assert.equal(state.settlementReversalReasons.value[1], undefined)
  await actions.reverseProductionSettlement(1)
  assert.equal(calls.length, 4)
  assert.equal(feedback.length, 2)
})

test('整批不合格完工确认不提示成品已入库', async t => {
  const original = globalThis.window
  t.after(() => { globalThis.window = original })
  const calls = []
  globalThis.window = { nexora: { async callApi(operation, payload) {
    calls.push([operation, payload])
    return {id: 9}
  } } }
  const feedback = []
  const actions = createProductionActions({}, async (action, success) => {
    await action()
    feedback.push(success)
  }, () => {})
  await actions.postProductionCompletion(9)
  assert.deepEqual(calls, [['postProductionCompletion', {completionId: 9}]])
  assert.deepEqual(feedback, ['完工单 #9 已确认。'])
})

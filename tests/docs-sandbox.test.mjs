import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialState, transition, movements, balances, sources, decimal, lineTotal, restoreState } from '../docs/site/sandbox.mjs'
import { sceneAt, focusLayout, mountScene, intersectsStage } from '../docs/site/motion.mjs'
import { windowGeometry, projectWindowPoint } from '../docs/site/scene-geometry.mjs'
import { sandboxMarkup, money } from '../docs/site/sandbox-ui.mjs'

test('草稿、跨仓库多物料与确认只生成一次库存和应付，失败不污染原状态', () => {
  const original = initialState()
  let state = transition(original, { type: 'copy' })
  state = transition(state, { type: 'edit', field: 'warehouse', value: 'WH-B' })
  state = transition(state, { type: 'edit', field: 'supplier', value: 'SUP-B' })
  state = transition(state, { type: 'edit', field: 'quantity', index: 0, value: '2.125' })
  state = transition(state, { type: 'addLine' })
  assert.equal(movements(state).length, 1)
  assert.equal(sources(state).length, 1)
  const posted = transition(state, { type: 'post' })
  assert.equal(movements(posted).length, 3)
  assert.equal(sources(posted)[1].amount, 3125)
  assert.deepEqual(balances(posted).map(b => [b.warehouse, b.material, b.quantity]), [['WH-A', 'MAT-A', 12000], ['WH-B', 'MAT-A', 2125], ['WH-B', 'MAT-B', 1000]])
  assert.throws(() => transition(posted, { type: 'post' }), /locked/)
  assert.throws(() => transition(posted, { type: 'edit', field: 'quantity', index: 0, value: '100' }), /locked/)
  assert.equal(movements(posted).length, 3)
  assert.deepEqual(original, initialState())
})

test('多张单据按仓库与物料累积结存，复制与删除草稿行不影响已确认数据', () => {
  let state = transition(initialState(), { type: 'copy' })
  state = transition(state, { type: 'addLine' })
  state = transition(state, { type: 'removeLine', index: 1 })
  assert.throws(() => transition(state, { type: 'removeLine', index: 0 }), /lines/)
  state = transition(state, { type: 'post' })
  assert.equal(movements(state)[1].balance, 24000)
  assert.equal(sources(state).length, 2)
  assert.deepEqual(transition(state, { type: 'reset' }), initialState())
})

test('部分付款、结清与超额失败独立于库存，金额精确到分', () => {
  const initial = initialState()
  let state = transition(initial, { type: 'pay', amount: '19.99' })
  assert.equal(sources(state)[0].remaining, 10001)
  assert.equal(sources(state)[0].paymentStatus, 'partial')
  assert.throws(() => transition(state, { type: 'pay', amount: '100.02' }), /overpayment/)
  assert.throws(() => transition(state, { type: 'pay', amount: '0' }), /positive/)
  state = transition(state, { type: 'pay', amount: '100.01' })
  assert.equal(sources(state)[0].paymentStatus, 'paid')
  assert.equal(sources(state)[0].remaining, 0)
  assert.deepEqual(movements(state), movements(initial))
  const draft = transition(state, { type: 'new' })
  assert.throws(() => transition(draft, { type: 'pay', amount: '1' }), /draftPayment/)
})

test('数量三位小数、逐行四舍五入以及无效与溢出输入校验', () => {
  assert.equal(money(Number.MAX_SAFE_INTEGER), '¥90071992547409.91')
  assert.equal(lineTotal({ quantity: '0.005', price: '1.00' }), 1)
  assert.equal(lineTotal({ quantity: '0.004', price: '1.00' }), 0)
  assert.equal(lineTotal({ quantity: '1.005', price: '10.00' }), 1005)
  assert.equal(decimal('001.010', 3), 1010)
  for (const value of ['', '-1', 'NaN', 'Infinity', '1e3', '1.0001', '<script>']) assert.throws(() => decimal(value, 3))
  assert.throws(() => decimal('90071992547409910', 2), /tooLarge/)
  let state = transition(initialState(), { type: 'new' })
  state = transition(state, { type: 'edit', field: 'quantity', index: 0, value: '' })
  assert.throws(() => transition(state, { type: 'post' }), /number/)
  assert.equal(sources(state).length, 1)
  assert.equal(state.receipts[1].status, 'draft')
  state = transition(state, { type: 'edit', field: 'quantity', index: 0, value: '1' })
  state = transition(state, { type: 'edit', field: 'date', value: '2026-02-30' })
  assert.throws(() => transition(state, { type: 'post' }), /date/)
})

test('仍在画面外的入场窗口不能进入键盘顺序', () => {
  const stage = { left: 0, right: 1000, top: 0, bottom: 600 }
  assert.equal(intersectsStage({ left: 1025, right: 1295, top: 0, bottom: 600 }, stage), false)
  assert.equal(intersectsStage({ left: -300, right: 0, top: 0, bottom: 600 }, stage), false)
  assert.equal(intersectsStage({ left: 900, right: 1170, top: 0, bottom: 600 }, stage), true)
})

test('语言切换恢复草稿和付款，损坏或篡改的临时数据回到示例', () => {
  let state = transition(initialState(), { type: 'pay', amount: '10.00' })
  state = transition(state, { type: 'copy' })
  state = transition(state, { type: 'edit', field: 'quantity', index: 0, value: '' })
  assert.deepEqual(restoreState(JSON.parse(JSON.stringify(state))), state)
  for (const broken of [null, {}, { ...state, nextId: 1 }, { ...state, selectedId: 'missing' }, { ...state, payments: [{ id: 'PAY-1', receiptId: 'DEMO-001', amount: 999999 }] }, { ...state, receipts: [...state.receipts, state.receipts[0]] }]) assert.deepEqual(restoreState(broken), initialState())
})

test('顺序只出现一屏、两屏、三屏，跳滚与倒滚无业务副作用', () => {
  const original = initialState()
  const frames = [0, .19, .38, .51, .7, .94, 1, .45, 0].map(sceneAt)
  assert.deepEqual(frames[0].windows.map(w => w.opacity), [1, 0, 0])
  assert.deepEqual(frames[2].windows.map(w => w.opacity), [1, 1, 0])
  assert.deepEqual(frames[4].windows.map(w => w.opacity), [1, 1, 1])
  assert.deepEqual(frames[0], frames.at(-1))
  assert.equal(sceneAt(NaN).progress, 0)
  assert.equal(sceneAt(2).progress, 1)
  assert.deepEqual(initialState(), original)
  assert.ok(sceneAt(.43).lines[0] === 1 && sceneAt(.43).lines[1] === 0)
  assert.deepEqual(sceneAt(.8).lines, [1, 1])
  for (const [index, key] of ['receipt', 'stock', 'finance'].entries()) {
    const layout = focusLayout(key)
    assert.equal(layout[index].width, .85)
    assert.equal(layout[index].rotation, 0)
    assert.equal(layout.filter(w => w.opacity === 1).length, 1)
  }
  assert.doesNotThrow(() => mountScene({ querySelector: () => null }, {})())
})

test('两种语言输出可操作单据与独立窗口，无脚本也保留真实业务示例', () => {
  for (const lang of ['zh-CN', 'en']) {
    const html = sandboxMarkup(lang)
    assert.equal((html.match(/data-window=/g) || []).length, 3)
    assert.match(html, /data-form="receipt"/)
    assert.match(html, /data-form="payment"/)
    assert.match(html, /DEMO-001/)
    assert.match(html, /¥120.00/)
    assert.match(html, /data-anchor="stock"/)
    assert.match(html, /data-action="trace"/)
  }
})

test('总览保留方窗—横窗—方窗与相反顶边斜率，窗底落在同一地面', () => {
  for (const width of [951, 1216, 1440, 1856]) {
    const height = Math.max(360, Math.min(540, width * .34 + 30))
    const windows = sceneAt(.92).windows.map(w => windowGeometry(w, width, height))
    const [receipt, stock, finance] = windows
    assert.equal(receipt.logicalWidth, 600)
    assert.equal(stock.logicalWidth, 1000)
    assert.equal(finance.logicalWidth, 600)
    const corners = windows.map(w => [projectWindowPoint(w, 0, 0), projectWindowPoint(w, w.pixelWidth, 0), projectWindowPoint(w, 0, w.pixelHeight), projectWindowPoint(w, w.pixelWidth, w.pixelHeight)])
    const slopes = corners.map(([a, b]) => (b[1] - a[1]) / (b[0] - a[0]))
    assert.ok(slopes[0] > .1 && slopes[2] < -.1, '左右透视必须在屏上可辨，不能仅改变角度变量')
    assert.ok(Math.abs(slopes[1]) < .06)
    for (const [a, b, c, d] of corners) {
      assert.ok(Math.abs(c[1] - d[1]) < .01)
      assert.ok(Math.abs(c[1] - (height - 35)) < .01)
      assert.ok(a[0] > -2 && b[0] < width + 2)
    }
    const aspects = corners.map(([a, b, c]) => (b[0] - a[0]) / (c[1] - Math.min(a[1], b[1])))
    assert.ok(aspects[0] > .8 && aspects[0] < 1.1)
    assert.ok(aspects[1] > 1.5 && aspects[1] < 1.8)
    assert.ok(aspects[2] > .8 && aspects[2] < 1.1)
  }
})

test('聚焦画布可读、投影平展，快速跳滚不会改变逻辑表格宽度', () => {
  for (const key of ['receipt', 'stock', 'finance']) {
    const focused = windowGeometry(focusLayout(key)[['receipt', 'stock', 'finance'].indexOf(key)], 951, 650)
    assert.equal(focused.rotation, 0)
    assert.ok(focused.scale > .75)
    assert.ok(focused.pixelHeight <= 615)
    const [x, y] = projectWindowPoint(focused, 0, 0)
    assert.ok(Math.abs(x - focused.left) < 1e-9 && Math.abs(y - focused.top) < 1e-9)
  }
  for (const p of [.45, .92, .3, 1, .38]) {
    const stock = windowGeometry(sceneAt(p).windows[1], 951, 400)
    assert.equal(stock.logicalWidth, 1000)
    assert.equal(stock.logicalHeight, 585)
    assert.equal(stock.pixelWidth / stock.logicalWidth, stock.scale)
  }
})

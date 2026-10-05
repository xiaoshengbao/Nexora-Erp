import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { createThemeTransition, themeCircleFrames, themeToggleOrigin } from '../src/renderer/src/utils/theme-transition.ts'

// 可控制的浏览器快照模拟隐藏窗口、失败和连续点击，不依赖真实动画计时。
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
function setup({ supported = true, reducedMotion = false, manual = false, fail, timeoutMs = 30 } = {}) {
  let dark = false, animation
  const writes = [], calls = [], snapshots = []
  const root = { dataset: {}, animate(frames, options) {
    calls.push({ frames, options })
    if (fail === 'animate') throw new Error('animation unavailable')
    const end = deferred()
    if (!manual) end.resolve()
    animation = { finished: end.promise, cancel() { end.reject(new Error('cancelled')) }, end }
    return animation
  } }
  const env = { width: 800, height: 600, reducedMotion, root, start: supported ? update => {
    if (fail === 'start') throw new Error('capture unavailable')
    const ready = deferred(), finished = deferred()
    const snapshot = { ready: ready.promise, finished: finished.promise, skipTransition() { finished.resolve() }, update, readyControl: ready }
    snapshots.push(snapshot)
    if (!manual) void update().then(() => fail === 'ready' ? ready.reject(new Error('hidden')) : ready.resolve())
    return snapshot
  } : undefined }
  const motion = createThemeTransition({ isDark: () => dark, setDark: value => { dark = value; writes.push(value) }, flush: async () => {}, environment: () => env, timeoutMs })
  return { motion, root, calls, snapshots, writes, animation: () => animation, dark: () => dark }
}

test('百分比圆形在横竖窗口与不同像素密度下都从按钮展开、覆盖全部角落', () => {
  // 按 CSS 百分比规则还原物理裁剪区域，避免暂停截图掩盖合成阶段的 px 缩放问题。
  for (const [width, height] of [[800, 600], [1120, 720], [600, 1000], [3580, 2332]]) {
    for (const origin of [{ x: width - 29, y: 24 }, { x: 20, y: 24 }, { x: width / 2, y: height / 2 }]) {
      const frames = themeCircleFrames(origin, width, height)
      for (const density of [1, 1.25, 2, 3]) {
        const physicalWidth = width * density, physicalHeight = height * density
        const circles = frames.map(frame => {
          const match = /^circle\(([\d.]+)% at ([\d.]+)% ([\d.]+)%\)$/.exec(frame)
          assert.ok(match, '圆心和半径必须全部使用百分比，不能混入 px')
          return {
            radius: Number(match[1]) / 100 * Math.hypot(physicalWidth, physicalHeight) / Math.SQRT2,
            x: Number(match[2]) / 100 * physicalWidth, y: Number(match[3]) / 100 * physicalHeight
          }
        })
        assert.equal(circles[0].radius, 0)
        for (const circle of circles) {
          assert.ok(Math.abs(circle.x - origin.x * density) < 1e-6)
          assert.ok(Math.abs(circle.y - origin.y * density) < 1e-6)
        }
        for (const x of [0, physicalWidth]) for (const y of [0, physicalHeight]) {
          assert.ok(circles[1].radius > Math.hypot(x - circles[1].x, y - circles[1].y))
        }
      }
    }
  }
})
test('鼠标以点击坐标为圆心，键盘以按钮中心为圆心', () => {
  const rect = { left: 100, top: 20, width: 32, height: 32 }
  assert.deepEqual(themeToggleOrigin({ detail: 1, clientX: 105, clientY: 25 }, rect), { x: 105, y: 25 })
  assert.deepEqual(themeToggleOrigin({ detail: 0, clientX: 0, clientY: 0 }, rect), { x: 116, y: 36 })
  // 包装层转发的合成坐标或越界坐标也必须回到按钮，而不是窗口中心。
  assert.deepEqual(themeToggleOrigin({ detail: 1, clientX: 0, clientY: 0 }, rect), { x: 116, y: 36 })
  assert.deepEqual(themeToggleOrigin({ detail: 1, clientX: NaN, clientY: 25 }, rect), { x: 116, y: 36 })
})
test('明暗切换使用正确快照、450ms节奏，结束释放样式', async () => {
  const s = setup()
  await s.motion.toggle({ x: 30, y: 40 })
  assert.equal(s.dark(), true)
  assert.equal(s.calls[0].options.pseudoElement, '::view-transition-new(root)')
  assert.equal(s.calls[0].options.duration, 450)
  assert.equal(s.calls[0].options.easing, 'ease-in')
  await s.motion.toggle()
  assert.equal(s.dark(), false)
  assert.equal(s.calls[1].options.pseudoElement, '::view-transition-new(root)')
  assert.equal(s.calls[1].frames.clipPath[0], 'circle(0% at 50% 50%)')
  assert.deepEqual(s.root.dataset, {})
})
for (const options of [{ supported: false }, { reducedMotion: true }]) {
  test(`不支持快照或减少动态效果时直接提交主题 ${JSON.stringify(options)}`, async () => {
    const s = setup(options)
    await s.motion.toggle()
    assert.equal(s.dark(), true)
    assert.equal(s.snapshots.length, 0)
    assert.equal(s.calls.length, 0)
    assert.deepEqual(s.root.dataset, {})
  })
}
for (const fail of ['start', 'ready', 'animate']) {
  test(`快照${fail}失败仍提交主题并释放遮罩`, async () => {
    const s = setup({ fail })
    await s.motion.toggle()
    assert.deepEqual(s.writes, [true])
    assert.deepEqual(s.root.dataset, {})
  })
}
test('快照超时后迟到的ready和更新回调不能复活动画', async () => {
  const s = setup({ manual: true, timeoutMs: 5 })
  await s.motion.toggle()
  assert.equal(s.dark(), true)
  s.snapshots[0].readyControl.resolve()
  await s.snapshots[0].update()
  await tick()
  assert.equal(s.calls.length, 0)
  assert.deepEqual(s.writes, [true])
  assert.deepEqual(s.root.dataset, {})
})
test('未开始的连续点击保留奇偶结果和最后点击圆心', async () => {
  const s = setup()
  await Promise.all([s.motion.toggle(), s.motion.toggle()])
  assert.equal(s.dark(), false)
  assert.equal(s.calls.length, 0)
  await Promise.all([s.motion.toggle(), s.motion.toggle(), s.motion.toggle({ x: 7, y: 8 })])
  assert.equal(s.dark(), true)
  assert.equal(s.calls[0].frames.clipPath[0], themeCircleFrames({ x: 7, y: 8 }, 800, 600)[0])
})
test('设置卡片明确选择主题，与顶部切换共用最后一次意图', async () => {
  const s = setup()
  // 重复选中同一主题不反转；混合点击和快速切换按最后的明确选择提交。
  await Promise.all([s.motion.select(true), s.motion.select(true)])
  assert.equal(s.dark(), true)
  assert.deepEqual(s.writes, [true])
  await Promise.all([s.motion.toggle(), s.motion.select(true), s.motion.select(false)])
  assert.equal(s.dark(), false)
  const count = s.calls.length
  await s.motion.select(false)
  assert.equal(s.calls.length, count)
})
test('设置选择覆盖在途快照，迟到更新不能覆盖最终主题', async () => {
  const s = setup({ manual: true, timeoutMs: 1000 })
  const first = s.motion.select(true)
  await tick()
  const second = s.motion.select(false)
  await Promise.all([first, second])
  await s.snapshots[0].update()
  s.snapshots[0].readyControl.resolve()
  await tick()
  assert.equal(s.dark(), false)
  assert.deepEqual(s.root.dataset, {})
})
test('快照等待期间的连续点击取消旧请求，迟到回调不能覆盖最后主题', async () => {
  const s = setup({ manual: true, timeoutMs: 1000 })
  const first = s.motion.toggle()
  await tick()
  const second = s.motion.toggle()
  await Promise.all([first, second])
  await s.snapshots[0].update()
  s.snapshots[0].readyControl.resolve()
  await tick()
  assert.equal(s.dark(), false)
  assert.deepEqual(s.writes, [])
  assert.deepEqual(s.root.dataset, {})
})
test('已提交主题后的后续选择等到圆形完成，并只接续最后的选择', async () => {
  const s = setup({ manual: true, timeoutMs: 1000 })
  const first = s.motion.toggle()
  await tick()
  await s.snapshots[0].update()
  s.snapshots[0].readyControl.resolve()
  await tick()
  const firstAnimation = s.animation()
  const requests = [s.motion.select(false), s.motion.select(true), s.motion.select(false, { x: 7, y: 8 })]
  await tick()
  // 不取消正在展开的画面，也不能提前写回浅色；旧实现会在此处骤然露出深色整页。
  assert.equal(firstAnimation.finished, s.animation().finished)
  assert.equal(s.snapshots.length, 1)
  assert.deepEqual(s.writes, [true])
  assert.equal(s.root.dataset.themeTransition, 'circle')
  firstAnimation.end.resolve()
  await first
  await tick()
  assert.equal(s.snapshots.length, 2)
  await s.snapshots[1].update()
  s.snapshots[1].readyControl.resolve()
  await tick()
  assert.equal(s.calls[1].frames.clipPath[0], themeCircleFrames({ x: 7, y: 8 }, 800, 600)[0])
  s.animation().end.resolve()
  await Promise.all(requests)
  assert.deepEqual(s.writes, [true, false])
  assert.equal(s.dark(), false)
  assert.deepEqual(s.root.dataset, {})
})

// 在中途仍保留遮罩和终态配色，动画完成后才能清理，防止半途露出真实页面。
test('圆形未完全展开时不能释放快照或恢复颜色过渡', async () => {
  const s = setup({ manual: true, timeoutMs: 1000 })
  const request = s.motion.toggle({ x: 780, y: 20 })
  await tick()
  await s.snapshots[0].update()
  s.snapshots[0].readyControl.resolve()
  await tick()
  assert.equal(s.root.dataset.themeTransition, 'circle')
  assert.equal(s.calls.length, 1)
  assert.equal(s.calls[0].frames.clipPath[0], themeCircleFrames({ x: 780, y: 20 }, 800, 600)[0])
  // 等待的动画句柄由模拟浏览器返回，完成前不允许快照结束。
  s.animation().end.resolve()
  await request
  assert.deepEqual(s.root.dataset, {})
})


// ready 之前主题也可能已经提交，此时取消同样会暴露整页新配色。
test('提交后 ready 之前再次切换仍完整展开，偶数次后续点击不增加动画', async () => {
  const s = setup({ manual: true, timeoutMs: 1000 })
  const first = s.motion.toggle()
  await tick()
  await s.snapshots[0].update()
  const requests = [s.motion.toggle(), s.motion.toggle()]
  s.snapshots[0].readyControl.resolve()
  await tick()
  assert.equal(s.calls.length, 1)
  assert.deepEqual(s.writes, [true])
  s.animation().end.resolve()
  await Promise.all([first, ...requests])
  assert.equal(s.snapshots.length, 1)
  assert.equal(s.dark(), true)
  assert.deepEqual(s.root.dataset, {})
})

// 捕获前取消与 store 销毁仍需立即结束，不让隐藏窗口拖住后续请求。
test('捕获前取消不依赖超时或迟到的 ready', async () => {
  const s = setup({ manual: true, timeoutMs: 1000 })
  const first = s.motion.select(true)
  await tick()
  const second = s.motion.select(false)
  let finished = false
  void Promise.all([first, second]).then(() => { finished = true })
  await tick()
  assert.equal(finished, true)
  assert.deepEqual(s.writes, [])
  await s.snapshots[0].update()
  s.snapshots[0].readyControl.resolve()
  await tick()
  assert.equal(s.calls.length, 0)
  assert.deepEqual(s.root.dataset, {})
})

test('销毁取消在途圆形，迟到回调与排队选择不能复活主题', async () => {
  const s = setup({ manual: true, timeoutMs: 1000 })
  const first = s.motion.select(true)
  await tick()
  await s.snapshots[0].update()
  s.snapshots[0].readyControl.resolve()
  await tick()
  const second = s.motion.select(false)
  s.motion.dispose()
  await Promise.all([first, second])
  await s.snapshots[0].update()
  await s.motion.toggle()
  assert.deepEqual(s.writes, [true])
  assert.deepEqual(s.root.dataset, {})
})

// 检查真实样式的启动保护，防止动画 ready 前新快照未经裁剪就铺满窗口。
test('新快照在动画创建前已裁剪，旧快照保持完整且没有默认淡入淡出', () => {
  const css = postcss.parse(readFileSync(new URL('../src/renderer/src/theme-transitions.css', import.meta.url), 'utf8'))
  const values = selector => {
    const result = {}
    css.walkRules(rule => {
      if (rule.selectors.includes(selector)) rule.walkDecls(decl => { result[decl.prop] = decl.value })
    })
    return result
  }
  const prefix = ":root[data-theme-transition='circle']"
  const next = values(`${prefix}::view-transition-new(root)`)
  const old = values(`${prefix}::view-transition-old(root)`)
  assert.equal(next['clip-path'], 'circle(0%)')
  assert.equal(next.animation, 'none')
  assert.equal(old.animation, 'none')
  assert.equal(old['clip-path'], undefined)
  assert.ok(Number(next['z-index']) > Number(old['z-index']))
})

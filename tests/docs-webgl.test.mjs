import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cubicPoints, trimPath, pointOnPath, ribbonMesh, createWebGLStage, createWebGLGuide } from '../docs/site/webgl-stage.mjs'
import { sceneAt, cloneReflection, mountScene } from '../docs/site/motion.mjs'
import { focusLayout, windowGeometry, interpolateWindowPose, connectionEndpoints, projectWindowPoint, sceneBoardHeight, advanceMotionClock } from '../docs/site/scene-geometry.mjs'

test('GPU 路径按实际弧长裁切，端点、倒滚和零长度输入保持稳定', () => {
  const path = cubicPoints([0, 0], [20, 50], [80, 50], [100, 0])
  assert.deepEqual(path[0], [0, 0]); assert.deepEqual(path.at(-1), [100, 0])
  assert.deepEqual(pointOnPath(path, 0), [0, 0]); assert.deepEqual(pointOnPath(path, 1), [100, 0])
  assert.deepEqual(pointOnPath([[0, 0], [10, 0], [10, 90]], .5), [10, 40])
  assert.deepEqual(trimPath(path, -1), trimPath(path, 0))
  assert.deepEqual(trimPath(path, 2), trimPath(path, 1))
  const mesh = ribbonMesh(path, 2)
  assert.ok(mesh.length > 0); assert.ok([...mesh].every(Number.isFinite))
  assert.equal(ribbonMesh([[0, 0], [0, 0]], 2).length, 0)
})

// 生命周期测试模拟 GPU 边界，真实着色器编译与图像对齐另由浏览器验收。
function fixture({ unavailable = false, compileFailure = false } = {}) {
  const counters = { contexts: 0, draws: 0, shaders: 0, programs: 0, buffers: 0, frames: 0, materials: [], colors: [] }
  const classes = new Set(), canvases = []
  const scene = { dataset: {}, classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } }
  const makeGL = () => {
    const gl = {
      lost: false, createShader: () => { counters.shaders++; return {} }, deleteShader: () => counters.shaders--,
      createProgram: () => { counters.programs++; return {} }, deleteProgram: () => counters.programs--,
      createBuffer: () => { counters.buffers++; return {} }, deleteBuffer: () => counters.buffers--,
      getShaderParameter: () => !compileFailure, getShaderInfoLog: () => 'Unsupported shader', getProgramParameter: () => true,
      getAttribLocation: () => 0, getUniformLocation: (_, name) => name, getParameter: () => 4096,
      isContextLost: () => gl.lost, drawArrays: () => counters.draws++
    }
    for (const method of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'enable', 'blendFuncSeparate', 'useProgram', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'viewport', 'clearColor', 'clear']) gl[method] = () => {}
    gl.uniform1f = (uniform, value) => { if (uniform === 'u_kind') counters.materials.push(value) }
    gl.uniform4f = (uniform, ...value) => { if (uniform === 'u_color') counters.colors.push(value) }
    return gl
  }
  const doc = { createElement() {
    const listeners = new Map(), gl = makeGL()
    const canvas = { style: {}, gl, hidden: false, width: 300, height: 150, setAttribute() {},
      getContext() { counters.contexts++; return unavailable ? null : gl },
      addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name),
      fire: name => listeners.get(name)?.({ preventDefault() {} }), remove() { canvas.removed = true }
    }
    return canvas
  } }
  const board = { ownerDocument: doc, closest: () => scene, append: canvas => canvases.push(canvas) }
  const guideHost = { ...board, classList: scene.classList }
  return { counters, canvases, scene, create: () => createWebGLStage(board, () => counters.frames++), createGuide: () => createWebGLGuide(guideHost, () => counters.frames++) }
}
const frame = () => ({ width: 1200, height: 600, layout: sceneAt(.8).windows, progress: .8, ratio: 3, staticMode: false,
  connections: [{ visible: true, points: [[0, 0], [100, 100]], amount: .5, node: .3 }] })

test('静态场景不创建 GPU；桌面按需渲染并限制像素密度，销毁释放资源', () => {
  const f = fixture(), stage = f.create()
  assert.equal(stage.draw({ ...frame(), staticMode: true }), false)
  assert.equal(f.counters.contexts, 0)
  assert.equal(stage.draw(frame()), true)
  assert.equal(f.scene.dataset.renderer, 'webgl')
  assert.equal(f.canvases[0].width, 2560)
  assert.ok(f.counters.draws > 0)
  const draws = f.counters.draws
  stage.draw({ ...frame(), staticMode: true })
  assert.equal(f.counters.draws, draws)
  assert.equal(f.scene.dataset.renderer, 'fallback')
  stage.destroy()
  assert.equal(f.counters.shaders, 0); assert.equal(f.counters.programs, 0); assert.equal(f.counters.buffers, 0)
  assert.ok(f.canvases.every(c => c.removed))
  assert.equal(stage.draw(frame()), false)
})

test('WebGL 不可用或着色器失败时保留 HTML/SVG，不泄漏半初始化资源', () => {
  for (const option of [{ unavailable: true }, { compileFailure: true }]) {
    const f = fixture(option), stage = f.create()
    assert.equal(stage.draw(frame()), false)
    assert.equal(f.scene.dataset.renderer, 'fallback')
    assert.ok(f.canvases.every(c => c.hidden))
    stage.destroy()
    assert.equal(f.counters.shaders, 0); assert.equal(f.counters.programs, 0); assert.equal(f.counters.buffers, 0)
  }
})

test('GPU 上下文丢失即回退，恢复时重建资源并重绘最后业务画面', () => {
  const f = fixture(), stage = f.create()
  stage.draw(frame())
  f.canvases[0].gl.lost = true; f.canvases[0].fire('webglcontextlost')
  assert.equal(f.scene.dataset.renderer, 'fallback'); assert.equal(stage.draw(frame()), false)
  f.canvases[0].gl.lost = false; f.canvases[0].fire('webglcontextrestored')
  // 恢复只请求帧，由场景控制器检查页面可见性后才绘制。
  assert.equal(f.scene.dataset.renderer, 'fallback')
  stage.draw(frame())
  assert.equal(f.scene.dataset.renderer, 'webgl'); assert.equal(f.counters.frames, 2)
  stage.destroy()
  assert.equal(f.counters.programs, 0); assert.equal(f.counters.buffers, 0)
})

test('GPU 保留地面光影与来源路径，不再叠加静态镀层窗框', () => {
  const f = fixture(), stage = f.create()
  assert.equal(stage.draw(frame()), true)
  assert.ok(f.counters.materials.includes(1), '保留地面反光')
  assert.ok(f.counters.materials.includes(2), '保留接触阴影')
  assert.ok(!f.counters.materials.includes(0), '不绘制金属镀层')
  assert.ok(f.counters.draws > f.counters.materials.length, '来源线仍由 GPU 绘制')
  stage.destroy()
})

test('窗口切换从当前实体姿态接续，改变画布与舞台高度也不跳起点或底线', () => {
  const width = 1440, fromHeight = 540, toHeight = 650
  const source = sceneAt(.92).windows.map(item => windowGeometry(item, width, fromHeight))
  const targets = focusLayout('stock').map(item => windowGeometry(item, width, toHeight))
  let last = source
  for (let n = 0; n <= 60; n++) {
    const q = n / 60, height = fromHeight + (toHeight - fromHeight) * q
    const poses = targets.map((item, i) => interpolateWindowPose(source[i], item, q, height))
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(poses[i].top + poses[i].pixelHeight - (height - 35)) < 1e-9)
      assert.ok(Math.abs(poses[i].pixelWidth - last[i].pixelWidth) < 20)
      assert.ok(Math.abs(poses[i].left - last[i].left) < 20)
      if (n === 0) for (const key of ['left', 'top', 'pixelWidth', 'pixelHeight', 'rotation', 'opacity']) assert.equal(poses[i][key], source[i][key])
    }
    last = poses
  }
  const interrupted = interpolateWindowPose(source[1], targets[1], .31, 574.1)
  const next = windowGeometry(focusLayout('finance')[1], width, toHeight)
  const restart = interpolateWindowPose(interrupted, next, 0, 574.1)
  for (const key of ['left', 'top', 'pixelWidth', 'pixelHeight', 'rotation', 'opacity']) assert.equal(restart[key], interrupted[key])
})

test('来源线拒绝退场、反向交叉与屏外端点，正常线路不形成回环', () => {
  const a = { right: [300, 200], left: [200, 200], opacity: 1 }
  const b = { left: [500, 300], right: [800, 300], opacity: 1 }
  assert.deepEqual(connectionEndpoints(a, b, 1440, 650), { start: [300, 200], end: [500, 300], bend: 90 })
  for (const pair of [[a, { ...b, opacity: .25 }], [{ ...a, right: [-10, 200] }, b], [b, a], [a, null], [a, { ...b, left: [310, 300] }]]) assert.equal(connectionEndpoints(...pair, 1440, 650), null)
  assert.ok(connectionEndpoints(b, { ...a, right: [300, 550] }, 1440, 650, true))
  const pose = windowGeometry(sceneAt(.92).windows[0], 1440, 540)
  const point = projectWindowPoint(pose, 550 * pose.scale, 230 * pose.scale)
  assert.ok(point.every(Number.isFinite))
})

test('GPU 来源淡出独立于路径行程，旧线清空后不遗留下一帧', () => {
  const f = fixture(), stage = f.create(), input = frame()
  stage.draw({ ...input, connections: [{ ...input.connections[0], alpha: .25 }] })
  assert.ok(Math.abs(f.counters.colors.at(-1)[3] - .95 * .5 * .25) < 1e-9)
  f.counters.colors = []
  stage.draw({ ...input, connections: [] })
  assert.equal(f.counters.colors.length, 0)
  stage.destroy()
})

test('倒影复制当前字段属性并去除交互标识，不沿用初始 HTML value', () => {
  const node = (value, attrs = []) => ({ value, checked: true, attributes: attrs.map(name => ({ name })), removeAttribute(name) { this.attributes = this.attributes.filter(attr => attr.name !== name) } })
  const original = [node('27.125'), node('supplier-b'), node('new note')]
  const copies = [node('12', ['data-edit', 'name', 'aria-label']), node('supplier-a', ['id', 'tabindex']), node('old note')]
  const clone = { ...node(undefined, ['data-content']), querySelectorAll: selector => selector === '*' ? copies : copies }
  const viewport = { cloneNode: deep => { assert.equal(deep, true); return clone }, querySelectorAll: () => original }
  assert.equal(cloneReflection(viewport), clone)
  assert.deepEqual(copies.map(item => item.value), original.map(item => item.value))
  assert.deepEqual(copies[0].attributes.map(attr => attr.name), ['aria-label'])
  assert.deepEqual(copies[1].attributes, [])
  assert.deepEqual(clone.attributes, [])
  assert.equal(original[0].value, '27.125')
})

test('舞台离屏时切换低高度或减少动态偏好，也立即释放旧尺寸与键盘锁定', () => {
  for (const preference of ['(max-height: 619px)', '(prefers-reduced-motion: reduce)']) {
    const classes = () => {
      const values = new Set()
      return { add: (...names) => names.forEach(name => values.add(name)), remove: (...names) => names.forEach(name => values.delete(name)), toggle: (name, on) => on ? values.add(name) : values.delete(name), contains: name => values.has(name) }
    }
    const element = () => Object.assign(new EventTarget(), { style: { cssText: '' }, dataset: {}, classList: classes(), setAttribute(name, value) { this[name] = value }, removeAttribute(name) { delete this[name] }, querySelectorAll: () => [] })
    const doc = element(), win = element(), scene = element(), board = element(), pause = element(), status = element(), canvases = [], media = new Map()
    const windows = ['receipt', 'stock', 'finance'].map(() => {
      const el = element(), viewport = element(), reflection = element()
      viewport.cloneNode = () => ({ attributes: [], querySelectorAll: () => [] })
      reflection.replaceChildren = () => {}
      el.querySelector = selector => selector === '.window-reflection' ? reflection : viewport
      return el
    })
    doc.defaultView = win; doc.documentElement = { lang: 'zh-CN' }; doc.querySelector = () => scene
    scene.ownerDocument = doc; board.ownerDocument = doc; board.closest = () => scene
    board.append = canvas => canvases.push(canvas)
    board.querySelectorAll = () => []
    scene.getBoundingClientRect = () => ({ top: 2000, bottom: 4000 })
    scene.querySelector = selector => selector === '.scene-board' ? board : selector === '[data-pause]' ? pause : selector === '[data-demo-status]' ? status : windows[['receipt', 'stock', 'finance'].findIndex(key => selector.includes(`"${key}"`))]
    pause.dataset = { pause: '暂停', resume: '继续' }
    doc.createElement = () => { const canvas = element(); canvas.remove = () => { canvas.removed = true }; return canvas }
    win.innerHeight = 1045; win.CustomEvent = CustomEvent
    win.sessionStorage = { getItem: () => null, removeItem() {} }
    win.matchMedia = query => { const m = element(); m.matches = false; media.set(query, m); return m }
    win.IntersectionObserver = class { observe() {} disconnect() {} }
    win.requestAnimationFrame = () => { throw new Error('离屏舞台不应请求动画帧') }
    const destroy = mountScene(doc, win)
    windows.forEach(el => { el.style.cssText = 'width:800px;transform:rotateY(30deg)'; el.inert = true; el.setAttribute('aria-hidden', 'true'); el.classList.add('is-focused', 'is-compact') })
    board.style.height = '650px'
    const m = media.get(preference); m.matches = true; m.dispatchEvent(new Event('change'))
    assert.equal(scene.classList.contains('motion-enabled'), false)
    assert.equal(board.style.height, '')
    for (const el of windows) {
      assert.equal(el.style.cssText, ''); assert.equal(el.inert, false)
      assert.equal(el['aria-hidden'], undefined); assert.equal(el.classList.contains('is-compact'), false)
    }
    assert.ok(canvases.every(canvas => canvas.hidden))
    destroy()
    assert.ok(canvases.every(canvas => canvas.removed))
  }
})

test('最低动态视口按实际说明和按钮高度留空间，所有过渡阶段都容纳舞台', () => {
  for (const [width, height] of [[1280, 620], [1366, 768], [1015, 1039], [2560, 1440]]) {
    for (const chrome of [231, 260, 310]) for (const compact of [0, .25, .5, .75, 1]) {
      const board = sceneBoardHeight(width, height, chrome, compact)
      assert.ok(board + chrome + 8 <= height)
      assert.ok(board <= 650)
      const pose = windowGeometry(sceneAt(.92).windows[1], width, board)
      assert.ok(pose.top >= 0 && pose.pixelHeight <= board - 35)
    }
  }
})

test('慢帧和后台恢复不会跳过大段切换行程，正常帧保持实际时间', () => {
  let clock = advanceMotionClock({ elapsed: 0, lastTime: null }, 100)
  clock = advanceMotionClock(clock, 116)
  assert.equal(clock.elapsed, 16)
  clock = advanceMotionClock(clock, 370)
  assert.equal(clock.elapsed, 50)
  clock = advanceMotionClock({ ...clock, lastTime: null }, 90000)
  assert.equal(clock.elapsed, 50)
  clock = advanceMotionClock(clock, 90016)
  assert.equal(clock.elapsed, 66)
})

test('封面轻细引导线按需创建 GPU，空场景停绘，丢失/恢复与销毁不泄漏资源', () => {
  const f = fixture(), guide = f.createGuide()
  assert.equal(guide.draw({ ...frame(), connections: [] }), false)
  assert.equal(guide.draw({ ...frame(), staticMode: true }), false)
  assert.equal(f.counters.contexts, 0)
  assert.equal(guide.draw(frame()), true)
  assert.equal(f.canvases.length, 1)
  assert.equal(f.counters.contexts, 1)
  assert.ok(f.counters.colors.at(-1)[3] > .5, '初始短线仍然清晰，不再按长度降低透明度')
  const before = f.counters.draws
  guide.draw({ ...frame(), connections: [] })
  assert.equal(f.counters.draws, before)
  assert.equal(f.canvases[0].hidden, true)
  f.canvases[0].gl.lost = true; f.canvases[0].fire('webglcontextlost')
  assert.equal(guide.draw(frame()), false)
  f.canvases[0].gl.lost = false; f.canvases[0].fire('webglcontextrestored')
  assert.equal(guide.draw(frame()), true)
  guide.destroy()
  assert.equal(f.counters.programs, 0); assert.equal(f.counters.buffers, 0); assert.equal(f.counters.shaders, 0)
  assert.equal(f.canvases[0].removed, true)
})

test('封面 WebGL 初始化失败只保留 SVG，不影响业务舞台或泄漏半初始化资源', () => {
  for (const option of [{ unavailable: true }, { compileFailure: true }]) {
    const f = fixture(option), guide = f.createGuide()
    assert.equal(guide.draw(frame()), false)
    assert.ok(f.canvases[0].hidden)
    guide.destroy()
    assert.equal(f.counters.programs, 0); assert.equal(f.counters.buffers, 0); assert.equal(f.counters.shaders, 0)
  }
})

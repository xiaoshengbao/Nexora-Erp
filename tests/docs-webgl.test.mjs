import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cubicPoints, trimPath, pointOnPath, ribbonMesh, createWebGLStage } from '../docs/site/webgl-stage.mjs'
import { sceneAt } from '../docs/site/motion.mjs'

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
  const counters = { contexts: 0, draws: 0, shaders: 0, programs: 0, buffers: 0, frames: 0, materials: [] }
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
  return { counters, canvases, scene, create: () => createWebGLStage(board, () => counters.frames++) }
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

// GPU 只负责视觉层；表单、焦点与业务数据始终由原生 HTML 管理。
import { perspective, windowGeometry } from './scene-geometry.mjs'
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
export function cubicPoints(a, b, c, d, count = 48) {
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count, s = 1 - t
    return [0, 1].map(k => s ** 3 * a[k] + 3 * s * s * t * b[k] + 3 * s * t * t * c[k] + t ** 3 * d[k])
  })
}
export function trimPath(points, progress) {
  if (points.length < 2) return points.map(p => [...p])
  if (progress >= 1) return points.map(p => [...p])
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]))
  const target = lengths.reduce((a, b) => a + b, 0) * clamp(progress)
  const result = [[...points[0]]]
  let walked = 0
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]
    if (walked + length >= target) {
      const t = length ? (target - walked) / length : 0
      result.push(points[i].map((v, k) => v + (points[i + 1][k] - v) * t))
      break
    }
    result.push([...points[i + 1]])
    walked += length
  }
  return result
}
export const pointOnPath = (points, progress) => trimPath(points, progress).at(-1)
export function ribbonMesh(points, halfWidth) {
  const vertices = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    if (length < .001) continue
    const nx = -dy / length * halfWidth, ny = dx / length * halfWidth
    const corners = [[a[0] + nx, a[1] + ny, 1], [a[0] - nx, a[1] - ny, -1], [b[0] + nx, b[1] + ny, 1], [b[0] - nx, b[1] - ny, -1]]
    for (const index of [0, 1, 2, 2, 1, 3]) vertices.push(...corners[index])
  }
  return new Float32Array(vertices)
}

const materialVertex = `
attribute vec3 a_position;
uniform vec2 u_canvas, u_stage;
uniform vec4 u_rect;
uniform float u_rotation, u_perspective;
varying vec2 v_uv;
void main(){
  v_uv = a_position.xy;
  vec3 p = vec3((a_position.xy - vec2(.5,1.)) * u_rect.zw, a_position.z);
  float c = cos(u_rotation), s = sin(u_rotation);
  p = vec3(p.x*c + p.z*s, p.y, -p.x*s + p.z*c);
  float w = 1. - p.z / u_perspective;
  vec2 pixel = u_rect.xy + p.xy/w + vec2(40.);
  vec2 clip = pixel / u_canvas * 2. - 1.;
  gl_Position = vec4(clip.x*w, -clip.y*w, 0., w);
}`
const materialFragment = `
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_opacity, u_kind, u_light;
float roundedBox(vec2 p, vec2 b, float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
void main(){
  float d = roundedBox((v_uv-.5)*u_size,u_size*.5-vec2(1.),15.);
  float edge = 1.-smoothstep(-.8,.8,d);
  if(u_kind<.5){
    float rim = 1.-smoothstep(0.,5.,-d);
    float light = .66+.2*sin((v_uv.x+v_uv.y*.18)*18.+u_light)+.12*cos(v_uv.y*26.);
    vec3 silver = mix(vec3(.56,.65,.70),vec3(.98,1.,1.),light);
    gl_FragColor=vec4(silver,edge*u_opacity*(.45+.55*rim));
  }else if(u_kind<1.5){
    float fade=pow(1.-v_uv.y,2.4);
    float sidebar=1.-smoothstep(.14,.16,v_uv.x);
    float rows=.5+.5*cos(v_uv.y*46.);
    vec3 tint=mix(vec3(.69,.78,.82),vec3(.89,.94,.96),sidebar*.5+rows*.16);
    gl_FragColor=vec4(tint,edge*fade*u_opacity*.17);
  }else{
    vec2 q=abs((v_uv-.5)*2.);
    float spread=exp(-pow(q.x,6.)*3.-q.y*q.y*5.);
    gl_FragColor=vec4(.22,.36,.42,spread*u_opacity*.15);
  }
}`
const lineVertex = `
attribute vec3 a_position;
uniform vec2 u_canvas;
varying float v_edge;
void main(){v_edge=a_position.z;vec2 p=(a_position.xy+vec2(40.))/u_canvas*2.-1.;gl_Position=vec4(p.x,-p.y,0.,1.);}`
const lineFragment = `
precision mediump float;
varying float v_edge;
uniform vec4 u_color;
void main(){float alpha=1.-smoothstep(.35,1.,abs(v_edge));gl_FragColor=vec4(u_color.rgb,u_color.a*alpha);}`
const discVertex = `
attribute vec3 a_position;
uniform vec2 u_canvas, u_center;
uniform float u_radius;
varying vec2 v_uv;
void main(){v_uv=a_position.xy;vec2 p=(u_center+(v_uv-.5)*u_radius*2.+vec2(40.))/u_canvas*2.-1.;gl_Position=vec4(p.x,-p.y,0.,1.);}`
const discFragment = `
precision mediump float;
varying vec2 v_uv;
uniform float u_opacity;
void main(){float r=length(v_uv-.5)*2.;float ring=1.-smoothstep(.55,.8,r);float core=1.-smoothstep(.25,.45,r);vec3 c=mix(vec3(.01,.67,.58),vec3(.93,1.,.98),core);gl_FragColor=vec4(c,ring*u_opacity);}`
const quad = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,1,0, 1,0,0, 1,1,0])

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source); gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(message || 'WebGL shader compilation failed')
  }
  return shader
}
function program(gl, vertex, fragment) {
  const shaders = [], p = gl.createProgram()
  try {
    shaders.push(compile(gl, gl.VERTEX_SHADER, vertex))
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, fragment))
    shaders.forEach(shader => gl.attachShader(p, shader)); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'WebGL link failed')
    return { value: p, attribute: gl.getAttribLocation(p, 'a_position'), uniforms: new Map() }
  } catch (error) { gl.deleteProgram(p); throw error }
  finally { shaders.forEach(shader => gl.deleteShader(shader)) }
}
function renderer(canvas, material) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' })
  if (!gl) throw new Error('WebGL unavailable')
  let programs = [], buffer
  try {
    programs.push(program(gl, material ? materialVertex : lineVertex, material ? materialFragment : lineFragment))
    if (!material) programs.push(program(gl, discVertex, discFragment))
    buffer = gl.createBuffer()
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  } catch (error) { programs.forEach(p => gl.deleteProgram(p.value)); throw error }
  const use = (index, vertices) => {
    const p = programs[index]
    gl.useProgram(p.value); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(p.attribute); gl.vertexAttribPointer(p.attribute, 3, gl.FLOAT, false, 0, 0)
    return {
      uniform(name, values) {
        if (!p.uniforms.has(name)) p.uniforms.set(name, gl.getUniformLocation(p.value, name))
        gl[`uniform${values.length}f`](p.uniforms.get(name), ...values)
      },
      draw() { gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 3) }
    }
  }
  return {
    gl, use,
    clear(width, height, ratio) {
      const scale = Math.min(2, Math.max(1, ratio), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) / Math.max(width, height))
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    },
    destroy() { if (buffer) gl.deleteBuffer(buffer); programs.forEach(p => gl.deleteProgram(p.value)); programs = [] }
  }
}

// 上下两层画布让窗口边框/反射在 HTML 后方、来源线在前方；聚焦时线层后移。
export function createWebGLStage(board, requestFrame = () => {}) {
  const scene = board.closest('.scroll-scene'), doc = board.ownerDocument
  const canvases = ['webgl-materials', 'webgl-connections'].map(className => {
    const canvas = doc.createElement('canvas')
    canvas.className = className; canvas.setAttribute('aria-hidden', 'true'); board.append(canvas)
    return canvas
  })
  let renderers = [], disposed = false, failed = false
  const setReady = ready => {
    scene.classList.toggle('webgl-ready', ready)
    scene.dataset.renderer = ready ? 'webgl' : 'fallback'
    canvases.forEach(c => { c.hidden = !ready })
  }
  const disposeResources = () => { renderers.forEach(r => r.destroy()); renderers = [] }
  const initialize = () => {
    try {
      disposeResources()
      renderers.push(renderer(canvases[0], true)); renderers.push(renderer(canvases[1], false))
      failed = false; return true
    } catch { disposeResources(); failed = true; setReady(false); return false }
  }
  const onLost = event => { event.preventDefault(); failed = true; setReady(false); requestFrame() }
  const onRestored = () => { if (!disposed && initialize()) requestFrame() }
  canvases.forEach(c => { c.addEventListener('webglcontextlost', onLost); c.addEventListener('webglcontextrestored', onRestored) })
  function draw(frame) {
    if (disposed || failed) return false
    const { width, height, layout, connections, progress, staticMode, ratio = 1 } = frame
    if (staticMode) { setReady(false); return false }
    if (!renderers.length && !initialize()) return false
    if (renderers.some(r => r.gl.isContextLost())) { failed = true; setReady(false); return false }
    setReady(true)
    const canvasSize = [width + 80, height + 140], [surface, lines] = renderers
    renderers.forEach(r => r.clear(...canvasSize, ratio))
    const material = (rect, rotation, opacity, kind, depth = 0) => {
      const mesh = depth ? new Float32Array(quad.map((v, i) => i % 3 === 2 ? depth : v)) : quad
      const p = surface.use(0, mesh)
      p.uniform('u_canvas', canvasSize); p.uniform('u_stage', [width, height]); p.uniform('u_rect', rect)
      p.uniform('u_size', rect.slice(2)); p.uniform('u_rotation', [rotation * Math.PI / 180]); p.uniform('u_perspective', [perspective])
      p.uniform('u_opacity', [opacity]); p.uniform('u_kind', [kind]); p.uniform('u_light', [progress * 1.5]); p.draw()
    }
    for (const item of layout) {
      if (item.opacity < .01) continue
      const g = item.pixelWidth ? item : windowGeometry(item, width, height)
      const w = g.pixelWidth, h = g.pixelHeight, center = g.left + w / 2, bottom = g.top + h
      material([center, bottom + 31, w + 80, 48], 0, item.opacity, 2)
      material([center, bottom + 60, w, 58], item.rotation, item.opacity * .5, 1)
      // 逐层挤出银框的侧面，近侧保留暗面与高光，不用白色边线替代厚度。
      for (const depth of [-14, -10, -6, -2]) material([center, bottom + 3, w + 8, h + 6], item.rotation, item.opacity, 0, depth)
    }
    for (const connection of connections) {
      if (!connection.visible) continue
      const points = trimPath(connection.points, connection.amount)
      // 三角带代替硬件宽线，保证不同 GPU 的线宽与柔边一致。
      for (const [halfWidth, alpha] of [[8, .075], [4, .18], [1.7, .95]]) {
        const p = lines.use(0, ribbonMesh(points, halfWidth))
        p.uniform('u_canvas', canvasSize); p.uniform('u_color', [.015, .71, .61, alpha * connection.amount]); p.draw()
      }
      const node = pointOnPath(connection.points, Math.min(connection.node, connection.amount))
      if (node) {
        const p = lines.use(1, quad)
        p.uniform('u_canvas', canvasSize); p.uniform('u_center', node); p.uniform('u_radius', [7]); p.uniform('u_opacity', [connection.amount]); p.draw()
      }
    }
    return true
  }
  setReady(false)
  return {
    draw,
    destroy() {
      disposed = true; disposeResources(); setReady(false)
      canvases.forEach(c => { c.removeEventListener('webglcontextlost', onLost); c.removeEventListener('webglcontextrestored', onRestored); c.remove() })
    }
  }
}

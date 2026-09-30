import { sceneAt, focusLayout, windowGeometry, perspective } from './scene-geometry.mjs'
export { sceneAt, focusLayout } from './scene-geometry.mjs'
import { mountSandbox } from './sandbox-ui.mjs'
import { createWebGLStage, cubicPoints, pointOnPath } from './webgl-stage.mjs'

const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const lerp = (a, b, p) => a + (b - a) * p
const ease = p => 1 - (1 - clamp(p)) ** 3
const segment = (p, start, end) => ease((p - start) / (end - start))
const keys = ['receipt', 'stock', 'finance']
export const intersectsStage = (rect, stage) => rect.right > stage.left && rect.left < stage.right && rect.bottom > stage.top && rect.top < stage.bottom
export function mountScene(doc = document, win = window) {
  const scene = doc.querySelector('.scroll-scene')
  if (!scene) return () => {}
  const board = scene.querySelector('.scene-board'), windows = keys.map(key => scene.querySelector(`[data-window="${key}"]`))
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)'), mobile = win.matchMedia('(max-width: 760px)')
  const buttons = [...scene.querySelectorAll('[data-stage]')], pause = scene.querySelector('[data-pause]')
  const captions = [...scene.querySelectorAll('[data-caption]')]
  let progress = 0, focused = null, manual = false, frame = 0, onScreen = true, tween = null, disposed = false
  let renderedWindows = sceneAt(0).windows, lastStage = -1, sandbox
  let pendingFocus = null
  let graphics
  let resolvedWindows = []
  const refreshReflections = () => windows.forEach(el => {
    const reflection = el.querySelector('.window-reflection'), viewport = el.querySelector('.window-viewport')
    reflection.innerHTML = viewport.outerHTML
    reflection.querySelectorAll('*').forEach(node => {
      for (const attr of [...node.attributes]) if (attr.name.startsWith('data-') || ['id', 'name', 'tabindex'].includes(attr.name)) node.removeAttribute(attr.name)
    })
  })
  const staticMode = () => reduced.matches || mobile.matches
  const targetProgress = () => {
    const rect = scene.getBoundingClientRect()
    return clamp(-rect.top / Math.max(1, rect.height - win.innerHeight))
  }
  const syncControls = () => {
    pause.setAttribute('aria-pressed', String(manual))
    pause.textContent = manual ? pause.dataset.resume : pause.dataset.pause
    scene.dataset.mode = focused ? 'focus' : manual ? 'manual' : 'scroll'
  }
  const anchors = () => {
    const root = board.getBoundingClientRect()
    const point = key => {
      const element = board.querySelector(`[data-anchor="${key}"]`)
      if (!element) return null
      const rect = element.getBoundingClientRect(), pane = element.closest('.sandbox-content').getBoundingClientRect()
      // 超出内部滚动区域的行不绘线，避免将线连到被裁掉的内容。
      if (rect.bottom < pane.top || rect.top > pane.bottom) return null
      const edge = key === 'stock' ? element.closest('tr').getBoundingClientRect() : rect
      return { x: Math.min(edge.right, pane.right) - root.left, y: rect.top + rect.height / 2 - root.top, left: Math.max(edge.left, pane.left) - root.left }
    }
    return { root, points: keys.map(point) }
  }
  const drawLines = () => {
    const { root, points } = anchors(), state = sceneAt(progress)
    const svg = board.querySelector('.connection-layer')
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, root.width)} ${Math.max(1, root.height)}`)
    svg.style.height = `${root.height}px`
    const connections = []
    for (let i = 0; i < 2; i++) {
      const group = svg.querySelector(`[data-connection="${i}"]`), a = points[i], b = points[i + 1]
      const financeSource = board.querySelector('[data-anchor="finance"]')?.textContent.trim()
      const receiptSource = board.querySelector('[data-anchor="receipt"]')?.textContent.trim()
      const sameSource = i === 0 || financeSource === receiptSource
      const amount = staticMode() || focused ? 1 : state.lines[i]
      group.style.opacity = a && b && amount > 0 && sameSource ? String(amount) : '0'
      if (!a || !b) continue
      const vertical = staticMode()
      const x1 = a.x + 4, y1 = a.y, x2 = vertical ? b.x + 4 : b.left - 5, y2 = b.y
      const bend = vertical ? 30 : Math.max(36, Math.abs(x2 - x1) * .45)
      const rail = root.width + 8
      const d = vertical ? `M ${x1} ${y1} C ${rail} ${y1}, ${rail} ${y1}, ${rail} ${y1 + 24} L ${rail} ${y2 - 24} C ${rail} ${y2}, ${rail} ${y2}, ${x2} ${y2}` : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
      const curve = vertical
        ? [...cubicPoints([x1, y1], [rail, y1], [rail, y1], [rail, y1 + 24]), ...cubicPoints([rail, y2 - 24], [rail, y2], [rail, y2], [x2, y2])]
        : cubicPoints([x1, y1], [x1 + bend, y1], [x2 - bend, y2], [x2, y2])
      const paths = group.querySelectorAll('path')
      paths.forEach(path => { path.setAttribute('d', d); path.setAttribute('pathLength', '1'); path.style.strokeDasharray = '1'; path.style.strokeDashoffset = String(1 - amount) })
      const node = group.querySelector('circle'), nodeProgress = staticMode() || focused ? 1 : state.nodes[i]
      const pos = pointOnPath(curve, nodeProgress)
      node.setAttribute('cx', String(pos[0])); node.setAttribute('cy', String(pos[1]))
      connections.push({ points: curve, amount, node: nodeProgress, visible: amount > 0 && sameSource })
    }
    graphics?.draw({ width: root.width, height: root.height, layout: resolvedWindows, connections, progress, staticMode: staticMode(), ratio: win.devicePixelRatio })
  }
  const apply = layout => {
    renderedWindows = layout
    const width = board.clientWidth
    const compact = focused ? 0 : layout[0].compact
    if (!staticMode()) board.style.height = `${lerp(Math.min(win.innerHeight - 220, 650), Math.max(360, Math.min(540, width * .34 + 30)), compact)}px`
    else board.style.height = ''
    resolvedWindows = layout.map(item => windowGeometry(item, width, board.clientHeight))
    windows.forEach((el, index) => {
      const item = resolvedWindows[index]
      if (staticMode()) { el.style.cssText = ''; el.inert = false; el.removeAttribute('aria-hidden') }
      else {
        el.style.width = `${item.pixelWidth}px`
        el.style.height = `${item.pixelHeight}px`
        el.style.setProperty('--logical-width', `${item.logicalWidth}px`)
        el.style.setProperty('--logical-height', `${item.logicalHeight}px`)
        el.style.setProperty('--ui-scale', String(item.scale))
        el.style.transform = `translate3d(${item.left}px,${item.top}px,0) perspective(${perspective}px) rotateY(${item.rotation}deg)`
        el.style.opacity = String(item.opacity)
        el.style.zIndex = focused === keys[index] ? '3' : '2'
        const hidden = item.opacity < .1 || !intersectsStage(el.getBoundingClientRect(), board.getBoundingClientRect()) || (focused && focused !== keys[index])
        el.inert = Boolean(hidden)
        if (hidden) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden')
      }
      el.classList.toggle('is-focused', !staticMode() && focused === keys[index])
      el.classList.toggle('is-compact', !staticMode() && item.compact > .5)
    })
    const stage = focused ? keys.indexOf(focused) : sceneAt(progress).stage
    if (lastStage !== stage) {
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === stage)))
      captions.forEach((caption, index) => { caption.hidden = index !== stage })
      lastStage = stage
    }
    drawLines()
  }
  const finishFocus = () => {
    if (!pendingFocus) return
    const heading = windows[keys.indexOf(pendingFocus)].querySelector('h2')
    heading?.focus({ preventScroll: true })
    pendingFocus = null
  }
  const update = time => {
    frame = 0
    if (disposed || doc.hidden || !onScreen) return
    if (tween) {
      if (tween.start === null) tween.start = time
      const q = ease((time - tween.start) / tween.duration)
      progress = lerp(tween.fromProgress, tween.toProgress, q)
      const target = focused ? focusLayout(focused) : sceneAt(progress).windows
      apply(target.map((item, index) => Object.fromEntries(Object.keys(item).map(k => [k, lerp(tween.from[index][k], item[k], q)]))))
      if (q < 1) schedule()
      else { tween = null; finishFocus(); if (!manual) schedule() }
    } else {
      if (!manual && !staticMode()) progress = targetProgress()
      apply(focused ? focusLayout(focused) : sceneAt(progress).windows)
      finishFocus()
    }
  }
  const schedule = () => {
    // 偏好切换会改变舞台高度，旧的交叉观察结果不能阻止下一帧重新布置。
    const rect = scene.getBoundingClientRect()
    onScreen = rect.bottom > 0 && rect.top < win.innerHeight
    if (!frame && !disposed && !doc.hidden && onScreen) frame = win.requestAnimationFrame(update)
  }
  graphics = createWebGLStage(board, schedule)
  const move = (p, key = null, duration = 450) => {
    manual = true; focused = key
    pendingFocus = key
    tween = staticMode() ? null : { from: renderedWindows.map(w => ({ ...w })), fromProgress: progress, toProgress: p, start: null, duration }
    if (staticMode()) {
      progress = p
      if (key) windows[keys.indexOf(key)].scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' })
    }
    syncControls(); schedule()
  }
  const onClick = event => {
    const focus = event.target.closest('[data-focus]')
    if (focus) { move(.9, focus.dataset.focus); return }
    const stage = event.target.closest('[data-stage]')
    if (stage) { move([.1, .45, .8, .92][Number(stage.dataset.stage)]); return }
    if (event.target.closest('[data-overview]')) { move(.92); return }
    if (event.target.closest('[data-pause]')) {
      if (manual) {
        focused = null; manual = false
        pendingFocus = null
        tween = staticMode() ? null : { from: renderedWindows.map(w => ({ ...w })), fromProgress: progress, toProgress: targetProgress(), start: null, duration: 300 }
      } else { manual = true; tween = null }
      syncControls(); schedule()
    }
  }
  const onFocus = event => { if (keys.includes(event.detail.key)) move(.9, event.detail.key) }
  const onInputFocus = event => {
    if (event.target.closest('.sandbox-content') && event.target.matches('input,select,textarea')) {
      manual = true; tween = null; pendingFocus = null; syncControls()
    }
  }
  const onPreference = () => {
    tween = null; focused = null; manual = false
    pendingFocus = null
    scene.classList.toggle('motion-enabled', !staticMode())
    scene.classList.toggle('mobile-motion', mobile.matches && !reduced.matches)
    if (staticMode()) progress = 1
    syncControls(); schedule()
  }
  const onVisibility = () => { if (doc.hidden && frame) { win.cancelAnimationFrame(frame); frame = 0 } else schedule() }
  const onScroll = () => { if (!manual || staticMode()) schedule() }
  scene.addEventListener('click', onClick)
  scene.addEventListener('sandbox:focus', onFocus)
  const onRender = () => { refreshReflections(); schedule() }
  scene.addEventListener('sandbox:render', onRender)
  scene.addEventListener('focusin', onInputFocus)
  scene.addEventListener('scroll', schedule, true)
  win.addEventListener('scroll', onScroll, { passive: true })
  win.addEventListener('resize', schedule)
  doc.addEventListener('visibilitychange', onVisibility)
  reduced.addEventListener('change', onPreference); mobile.addEventListener('change', onPreference)
  const observer = new win.IntersectionObserver(entries => {
    onScreen = entries[0].isIntersecting
    if (!onScreen && frame) { win.cancelAnimationFrame(frame); frame = 0 }
    schedule()
  })
  observer.observe(scene)
  const reveals = new win.IntersectionObserver(entries => entries.forEach(entry => {
    entry.target.classList.toggle('in-view', entry.isIntersecting)
  }), { threshold: .1 })
  windows.forEach(el => reveals.observe(el))
  scene.classList.add('scene-ready')
  refreshReflections()
  onPreference()
  sandbox = mountSandbox(scene, doc.documentElement.lang)
  return () => {
    disposed = true
    if (frame) win.cancelAnimationFrame(frame)
    observer.disconnect(); reveals.disconnect(); sandbox.destroy(); graphics.destroy()
    scene.removeEventListener('click', onClick); scene.removeEventListener('sandbox:focus', onFocus); scene.removeEventListener('sandbox:render', onRender)
    scene.removeEventListener('focusin', onInputFocus); scene.removeEventListener('scroll', schedule, true)
    win.removeEventListener('scroll', onScroll); win.removeEventListener('resize', schedule); doc.removeEventListener('visibilitychange', onVisibility)
    reduced.removeEventListener('change', onPreference); mobile.removeEventListener('change', onPreference)
  }
}
if (typeof document !== 'undefined') mountScene()

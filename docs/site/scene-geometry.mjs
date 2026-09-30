// HTML 与 GPU 共用窗口几何；缩小应用画布，不把桌面界面重新排成窄表单。
export const perspective = 1400
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const lerp = (a, b, p) => a + (b - a) * p
const segment = (p, start, end) => 1 - (1 - clamp((p - start) / (end - start))) ** 3
const keys = ['receipt', 'stock', 'finance']

export function sceneAt(progress) {
  const p = clamp(progress), stock = segment(p, .2, .38), finance = segment(p, .52, .7)
  return {
    progress: p, stage: p < .32 ? 0 : p < .63 ? 1 : p < .85 ? 2 : 3,
    windows: [
      { x: lerp(lerp(.075, -.005, stock), -.008, finance), width: lerp(lerp(.85, .4, stock), .29, finance), rotation: 30 * stock, opacity: 1, compact: stock, logicalWidth: lerp(1100, 600, stock), logicalHeight: lerp(590, 570, stock) },
      { x: lerp(lerp(1.08, .4, stock), .27, finance), width: lerp(.59, .46, finance), rotation: 4 * stock, opacity: stock, compact: 1, logicalWidth: 1000, logicalHeight: 585 },
      { x: lerp(1.08, .716, finance), width: .29, rotation: -30 * finance, opacity: finance, compact: 1, logicalWidth: 600, logicalHeight: 550 }
    ],
    lines: [segment(p, .34, .43), segment(p, .66, .76)],
    nodes: p >= .85 ? [1 - clamp((p - .9) / .05), 1 - clamp((p - .85) / .05)] : [clamp((p - .38) / .1), clamp((p - .7) / .1)]
  }
}
export function focusLayout(key) {
  let side = 0
  return keys.map(k => k === key
    ? { x: .075, width: .85, rotation: 0, opacity: 1, compact: 0, logicalWidth: 1000, logicalHeight: k === 'receipt' ? 720 : k === 'finance' ? 680 : 650 }
    : { x: side++ === 0 ? -.31 : 1.01, width: .29, rotation: k === 'finance' ? -30 : 30, opacity: .25, compact: 1, logicalWidth: k === 'stock' ? 1000 : 600, logicalHeight: 570 })
}
export function windowGeometry(item, stageWidth, stageHeight) {
  const available = stageHeight - 35
  const nearSide = Math.abs(Math.sin(item.rotation * Math.PI / 180)) / (2 * perspective)
  const width = Math.min(stageWidth * item.width, available / (item.logicalHeight / item.logicalWidth + available * nearSide))
  const height = width * item.logicalHeight / item.logicalWidth
  // 以窗底为投影原点，顶边形成透视、下沿始终落在同一地面。
  const left = stageWidth * item.x + (stageWidth * item.width - width) / 2
  return { ...item, left, top: stageHeight - 35 - height, pixelWidth: width, pixelHeight: height, scale: width / item.logicalWidth }
}
// 长记录由分页限制；展开明细或字段错误增加高度时，把完整内容纳入投影。
export function fitWindowContent(item, contentHeight) {
  const required = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) + 43 : 0
  return { ...item, logicalHeight: Math.max(item.logicalHeight, Math.ceil(required)) }
}
export function projectWindowPoint(item, x, y, depth = 0) {
  const angle = item.rotation * Math.PI / 180, localX = x - item.pixelWidth / 2, localY = y - item.pixelHeight
  const z = -localX * Math.sin(angle) + depth * Math.cos(angle), w = 1 - z / perspective
  return [item.left + item.pixelWidth / 2 + (localX * Math.cos(angle) + depth * Math.sin(angle)) / w, item.top + item.pixelHeight + localY / w]
}

// 手动切换只插值已测量的实体姿态，避免中途重排再次改变起止尺寸。
export function interpolateWindowPose(from, to, progress, stageHeight) {
  const q = clamp(progress), pose = { ...to }
  for (const key of ['left', 'pixelWidth', 'pixelHeight', 'rotation', 'opacity']) pose[key] = lerp(from[key], to[key], q)
  pose.top = stageHeight - 35 - pose.pixelHeight
  pose.scale = pose.pixelWidth / pose.logicalWidth
  pose.scaleY = pose.pixelHeight / pose.logicalHeight
  return pose
}

// 只有同屏且从左至右的来源才绘制横向线，杜绝退场窗口形成反向回环。
export function connectionEndpoints(a, b, width, height, vertical = false) {
  if (!a || !b || a.opacity < .55 || b.opacity < .55) return null
  const start = [a.right[0], a.right[1]], end = vertical ? b.right : b.left
  if (![...start, ...end].every(Number.isFinite)) return null
  if ([start, end].some(([x, y]) => x < 0 || x > width || y < 0 || y > height)) return null
  if (!vertical && end[0] - start[0] < 16) return null
  const bend = vertical ? 30 : Math.min(160, (end[0] - start[0]) * .45)
  return { start, end, bend }
}

export function sceneBoardHeight(width, height, chrome, compact = 0) {
  const available = Math.max(120, Math.min(height - chrome - 8, 650))
  return lerp(available, Math.min(available, Math.max(360, Math.min(540, width * .34 + 30))), clamp(compact))
}

// GPU/布局偶发慢帧不应让实体瞬间越过大段行程；后台恢复从暂停姿态接续。
export function advanceMotionClock(clock, time) {
  const step = clock.lastTime == null ? 0 : Math.max(0, Math.min(34, time - clock.lastTime))
  return { elapsed: clock.elapsed + step, lastTime: time }
}

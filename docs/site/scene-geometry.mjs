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
export function projectWindowPoint(item, x, y, depth = 0) {
  const angle = item.rotation * Math.PI / 180, localX = x - item.pixelWidth / 2, localY = y - item.pixelHeight
  const z = -localX * Math.sin(angle) + depth * Math.cos(angle), w = 1 - z / perspective
  return [item.left + item.pixelWidth / 2 + (localX * Math.cos(angle) + depth * Math.sin(angle)) / w, item.top + item.pixelHeight + localY / w]
}

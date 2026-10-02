import {receiptLotMilli} from './receipt-lot-api.ts'

export interface OutboundLotLineInput {
  outbound_line_id: number
  lots: {lot_id: number; quantity: string}[]
}

export interface OutboundLotOptions {
  outbound_id: number
  warehouse_id: number
  lines: {outbound_line_id: number; material_id: number; quantity: string; lots: {
    lot_id: number; code: string; source_kind: string; quantity: string
    supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
  }[]}[]
}

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function outboundAvailableMilli(value: string): bigint | null {
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const quantity = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
  return quantity > 0n ? quantity : null
}

// IPC 固定明细字段，并避免旧服务端忽略请求体时误报确认成功。
export function outboundLotBody(value: unknown): {lines: OutboundLotLineInput[]} {
  if (!value || typeof value !== 'object' || !Array.isArray((value as {lines?: unknown}).lines))
    throw Error('其他出库批次明细无效')
  const source = (value as {lines: unknown[]}).lines
  if (source.length < 1 || source.length > 100) throw Error('其他出库批次行数无效')
  const lineIds = new Set<number>()
  return {lines: source.map(item => {
    if (!item || typeof item !== 'object') throw Error('其他出库批次行无效')
    const line = item as Record<string, unknown>
    if (!positiveId(line.outbound_line_id) || lineIds.has(line.outbound_line_id))
      throw Error('其他出库明细编号无效')
    lineIds.add(line.outbound_line_id)
    if (!Array.isArray(line.lots) || line.lots.length < 1 || line.lots.length > 20)
      throw Error('其他出库批次数量无效')
    const lotIds = new Set<number>()
    return {outbound_line_id: line.outbound_line_id, lots: line.lots.map(item => {
      if (!item || typeof item !== 'object') throw Error('其他出库批次无效')
      const part = item as Record<string, unknown>
      if (!positiveId(part.lot_id) || lotIds.has(part.lot_id)
          || typeof part.quantity !== 'string' || receiptLotMilli(part.quantity) === null)
        throw Error('其他出库批次编号或数量无效')
      lotIds.add(part.lot_id)
      return {lot_id: part.lot_id, quantity: part.quantity}
    })}
  })}
}

export function validateOutboundLotOptions(value: unknown, outboundId: number): asserts value is OutboundLotOptions {
  const invalid = () => { throw Error('可用批次响应不匹配，请重新读取。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.outbound_id !== outboundId || !positiveId(result.warehouse_id)
      || !Array.isArray(result.lines) || result.lines.length < 1 || result.lines.length > 100) return invalid()
  const lines = new Set<number>()
  for (const item of result.lines) {
    if (!item || typeof item !== 'object') return invalid()
    const line = item as Record<string, unknown>
    if (!positiveId(line.outbound_line_id) || lines.has(line.outbound_line_id)
        || !positiveId(line.material_id) || typeof line.quantity !== 'string'
        || receiptLotMilli(line.quantity) === null || !Array.isArray(line.lots)) return invalid()
    lines.add(line.outbound_line_id)
    const lots = new Set<number>()
    for (const entry of line.lots) {
      if (!entry || typeof entry !== 'object') return invalid()
      const lot = entry as Record<string, unknown>
      if (!positiveId(lot.lot_id) || lots.has(lot.lot_id)
          || typeof lot.code !== 'string' || !lot.code
          || typeof lot.source_kind !== 'string' || typeof lot.quantity !== 'string'
          || outboundAvailableMilli(lot.quantity) === null
          || ![lot.supplier_lot, lot.manufactured_on, lot.expires_on].every(value =>
            value === null || typeof value === 'string')) return invalid()
      lots.add(lot.lot_id)
    }
  }
}

export function validatePostedOutboundLots(value: unknown, outboundId: number,
                                           requested: OutboundLotLineInput[]): void {
  const invalid = () => { throw Error('服务端未固定本次其他出库的实物批次，请核对服务端版本和批次差额。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.id !== outboundId || result.status !== 'posted' || !Array.isArray(result.lines)) return invalid()
  for (const line of requested) {
    const returned = result.lines.find(item => item && typeof item === 'object'
      && (item as Record<string, unknown>).id === line.outbound_line_id) as Record<string, unknown> | undefined
    if (!returned || !Array.isArray(returned.physical_lots)
        || returned.physical_lots.length !== line.lots.length) return invalid()
    for (let index = 0; index < line.lots.length; index++) {
      const part = returned.physical_lots[index] as Record<string, unknown> | undefined
      if (!part || part.id !== line.lots[index].lot_id || typeof part.quantity !== 'string'
          || receiptLotMilli(part.quantity) !== receiptLotMilli(line.lots[index].quantity)) return invalid()
    }
  }
}

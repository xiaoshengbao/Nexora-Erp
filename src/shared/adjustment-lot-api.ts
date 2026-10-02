import {receiptLotDate, receiptLotMilli} from './receipt-lot-api.ts'

export interface AdjustmentLotPartInput {
  lot_id: number | null
  quantity: string
  supplier_lot: string | null
  manufactured_on: string | null
  expires_on: string | null
}

export interface AdjustmentLotLineInput {
  adjustment_line_id: number
  lots: AdjustmentLotPartInput[]
}

export interface AdjustmentLotOptions {
  adjustment_id: number
  warehouse_id: number
  lines: {adjustment_line_id: number; material_id: number; quantity: string; lots: {
      lot_id: number; code: string; source_kind: string; quantity: string
      supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
    }[]}[]
}

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function signedAdjustmentMilli(value: string): bigint | null {
  if (!/^-?\d{1,15}(?:\.\d{1,3})?$/.test(value)) return null
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
  return negative ? -milli : milli
}

// IPC 只接收批次归属；已审批调整量始终由服务端单据确定。
export function adjustmentLotBody(value: unknown): {lines: AdjustmentLotLineInput[]} {
  if (!value || typeof value !== 'object' || !Array.isArray((value as {lines?: unknown}).lines))
    throw Error('调整批次明细无效')
  const source = (value as {lines: unknown[]}).lines
  if (source.length < 1 || source.length > 100) throw Error('调整批次行数无效')
  const lineIds = new Set<number>()
  return {lines: source.map(item => {
    if (!item || typeof item !== 'object') throw Error('调整批次行无效')
    const line = item as Record<string, unknown>
    if (!positiveId(line.adjustment_line_id) || lineIds.has(line.adjustment_line_id))
      throw Error('调整明细编号无效')
    lineIds.add(line.adjustment_line_id)
    if (!Array.isArray(line.lots) || line.lots.length < 1 || line.lots.length > 20)
      throw Error('调整批次数量无效')
    const lotIds = new Set<number>()
    return {adjustment_line_id: line.adjustment_line_id, lots: line.lots.map(item => {
      if (!item || typeof item !== 'object') throw Error('调整批次无效')
      const part = item as Record<string, unknown>
      if ((part.lot_id !== null && !positiveId(part.lot_id))
          || typeof part.quantity !== 'string' || receiptLotMilli(part.quantity) === null)
        throw Error('调整批次编号或数量无效')
      if (part.lot_id !== null) {
        if (lotIds.has(part.lot_id)) throw Error('调整不能重复选择同一已有批次')
        lotIds.add(part.lot_id)
      }
      const supplier = part.supplier_lot
      const manufactured = part.manufactured_on
      const expires = part.expires_on
      if ((supplier !== null && (typeof supplier !== 'string' || supplier.length > 100))
          || (manufactured !== null && (typeof manufactured !== 'string' || !receiptLotDate(manufactured)))
          || (expires !== null && (typeof expires !== 'string' || !receiptLotDate(expires)))
          || (manufactured && expires && expires < manufactured))
        throw Error('调整新批次来源或日期无效')
      if (part.lot_id !== null && (supplier || manufactured || expires))
        throw Error('已有批次不能填写新批次来源')
      return {lot_id: part.lot_id, quantity: part.quantity,
        supplier_lot: typeof supplier === 'string' ? supplier.trim() || null : null,
        manufactured_on: manufactured as string | null,
        expires_on: expires as string | null}
    })}
  })}
}

export function validateAdjustmentLotOptions(value: unknown, adjustmentId: number): asserts value is AdjustmentLotOptions {
  const invalid = () => { throw Error('调整可用批次响应不匹配，请重新读取。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.adjustment_id !== adjustmentId || !positiveId(result.warehouse_id)
      || !Array.isArray(result.lines) || result.lines.length < 1 || result.lines.length > 100) return invalid()
  const lineIds = new Set<number>()
  for (const item of result.lines) {
    if (!item || typeof item !== 'object') return invalid()
    const line = item as Record<string, unknown>
    if (!positiveId(line.adjustment_line_id) || lineIds.has(line.adjustment_line_id)
        || !positiveId(line.material_id) || !Array.isArray(line.lots)
        || typeof line.quantity !== 'string') return invalid()
    const quantity = signedAdjustmentMilli(line.quantity)
    if (quantity === null || quantity === 0n || quantity > 1000000000n
        || quantity < -1000000000n) return invalid()
    lineIds.add(line.adjustment_line_id)
    const lotIds = new Set<number>()
    for (const entry of line.lots) {
      if (!entry || typeof entry !== 'object') return invalid()
      const lot = entry as Record<string, unknown>
      if (!positiveId(lot.lot_id) || lotIds.has(lot.lot_id)
          || typeof lot.code !== 'string' || !lot.code
          || typeof lot.source_kind !== 'string' || typeof lot.quantity !== 'string'
          || signedAdjustmentMilli(lot.quantity) === null
          || (signedAdjustmentMilli(lot.quantity) ?? -1n) < 0n
          || ![lot.supplier_lot, lot.manufactured_on, lot.expires_on].every(value =>
            value === null || typeof value === 'string')) return invalid()
      lotIds.add(lot.lot_id)
    }
  }
}

export function validatePostedAdjustmentLots(value: unknown, adjustmentId: number,
                                            requested: AdjustmentLotLineInput[]): void {
  const invalid = () => { throw Error('服务端未固定本次调整的实物批次，请核对服务端版本和批次差额。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.id !== adjustmentId || result.status !== 'posted' || !Array.isArray(result.lines)) return invalid()
  for (const line of requested) {
    const returned = result.lines.find(item => item && typeof item === 'object'
      && (item as Record<string, unknown>).id === line.adjustment_line_id) as Record<string, unknown> | undefined
    if (!returned || !Array.isArray(returned.physical_lots)
        || returned.physical_lots.length !== line.lots.length) return invalid()
    for (let index = 0; index < line.lots.length; index++) {
      const requestedPart = line.lots[index]
      const part = returned.physical_lots[index] as Record<string, unknown> | undefined
      if (!part || !positiveId(part.id) || typeof part.quantity !== 'string'
          || receiptLotMilli(part.quantity) !== receiptLotMilli(requestedPart.quantity)
          || (requestedPart.lot_id !== null && part.id !== requestedPart.lot_id)
          || (requestedPart.lot_id === null && part.source_kind !== 'adjustment')) return invalid()
    }
  }
}

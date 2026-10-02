import {receiptLotDate, receiptLotMilli} from './receipt-lot-api.ts'

export interface MaterialReturnLotPartInput {
  lot_id: number | null
  quantity: string
  supplier_lot: string | null
  manufactured_on: string | null
  expires_on: string | null
}

export interface MaterialReturnLotLineInput {
  return_line_id: number
  lots: MaterialReturnLotPartInput[]
}

export interface MaterialReturnLotOptions {
  return_id: number
  material_issue_id: number
  warehouse_id: number
  lines: {return_line_id: number; material_issue_line_id: number; material_id: number;
    quantity: string; lots: {lot_id: number; code: string; source_kind: string;
      quantity: string; supplier_lot: string | null;
      manufactured_on: string | null; expires_on: string | null}[]}[]
}

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

// IPC 只传回仓批次；原领料、物料、退料数量始终以服务端草稿为准。
export function materialReturnLotBody(value: unknown): {lines: MaterialReturnLotLineInput[]} {
  if (!value || typeof value !== 'object' || !Array.isArray((value as {lines?: unknown}).lines))
    throw Error('生产退料批次明细无效')
  const source = (value as {lines: unknown[]}).lines
  if (source.length < 1 || source.length > 100) throw Error('生产退料批次行数无效')
  const lineIds = new Set<number>()
  return {lines: source.map(item => {
    if (!item || typeof item !== 'object') throw Error('生产退料批次行无效')
    const line = item as Record<string, unknown>
    if (!positiveId(line.return_line_id) || lineIds.has(line.return_line_id))
      throw Error('生产退料明细编号无效')
    lineIds.add(line.return_line_id)
    if (!Array.isArray(line.lots) || line.lots.length < 1 || line.lots.length > 20)
      throw Error('生产退料批次数量无效')
    const lotIds = new Set<number>()
    return {return_line_id: line.return_line_id, lots: line.lots.map(item => {
      if (!item || typeof item !== 'object') throw Error('生产退料批次无效')
      const part = item as Record<string, unknown>
      if ((part.lot_id !== null && !positiveId(part.lot_id))
          || typeof part.quantity !== 'string' || receiptLotMilli(part.quantity) === null)
        throw Error('生产退料批次编号或数量无效')
      if (part.lot_id !== null) {
        if (lotIds.has(part.lot_id)) throw Error('退料不能重复选择同一原领料批次')
        lotIds.add(part.lot_id)
      }
      const supplier = part.supplier_lot
      const manufactured = part.manufactured_on
      const expires = part.expires_on
      if ((supplier !== null && (typeof supplier !== 'string' || supplier.length > 100))
          || (manufactured !== null && (typeof manufactured !== 'string' || !receiptLotDate(manufactured)))
          || (expires !== null && (typeof expires !== 'string' || !receiptLotDate(expires)))
          || (manufactured && expires && expires < manufactured)
          || (part.lot_id !== null && (supplier || manufactured || expires)))
        throw Error('退料新批次来源或日期无效')
      return {lot_id: part.lot_id, quantity: part.quantity,
        supplier_lot: typeof supplier === 'string' ? supplier.trim() || null : null,
        manufactured_on: manufactured as string | null, expires_on: expires as string | null}
    })}
  })}
}

export function validateMaterialReturnLotOptions(value: unknown, returnId: number):
  asserts value is MaterialReturnLotOptions {
  const invalid = () => { throw Error('生产退料原领料批次响应不匹配，请重新读取。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.return_id !== returnId || !positiveId(result.material_issue_id)
      || !positiveId(result.warehouse_id) || !Array.isArray(result.lines)
      || result.lines.length < 1 || result.lines.length > 100) return invalid()
  const lineIds = new Set<number>()
  for (const item of result.lines) {
    if (!item || typeof item !== 'object') return invalid()
    const line = item as Record<string, unknown>
    if (!positiveId(line.return_line_id) || lineIds.has(line.return_line_id)
        || !positiveId(line.material_issue_line_id) || !positiveId(line.material_id)
        || typeof line.quantity !== 'string' || receiptLotMilli(line.quantity) === null
        || !Array.isArray(line.lots)) return invalid()
    lineIds.add(line.return_line_id)
    const lotIds = new Set<number>()
    for (const item of line.lots) {
      if (!item || typeof item !== 'object') return invalid()
      const lot = item as Record<string, unknown>
      if (!positiveId(lot.lot_id) || lotIds.has(lot.lot_id)
          || typeof lot.code !== 'string' || !lot.code
          || typeof lot.source_kind !== 'string' || typeof lot.quantity !== 'string'
          || receiptLotMilli(lot.quantity) === null
          || ![lot.supplier_lot, lot.manufactured_on, lot.expires_on].every(value =>
            value === null || typeof value === 'string')) return invalid()
      lotIds.add(lot.lot_id)
    }
  }
}

export function validatePostedMaterialReturnLots(value: unknown, returnId: number,
                                               requested: MaterialReturnLotLineInput[]): void {
  const invalid = () => { throw Error('服务端未固定本次退料的实物批次，请核对服务端版本和批次差额。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.id !== returnId || result.status !== 'posted' || !Array.isArray(result.lines)) return invalid()
  for (const line of requested) {
    const returned = result.lines.find(item => item && typeof item === 'object'
      && (item as Record<string, unknown>).id === line.return_line_id) as Record<string, unknown> | undefined
    if (!returned || !Array.isArray(returned.physical_lots)
        || returned.physical_lots.length !== line.lots.length) return invalid()
    for (let index = 0; index < line.lots.length; index++) {
      const requestedPart = line.lots[index]
      const part = returned.physical_lots[index] as Record<string, unknown> | undefined
      if (!part || !positiveId(part.id) || typeof part.quantity !== 'string'
          || receiptLotMilli(part.quantity) !== receiptLotMilli(requestedPart.quantity)
          || (requestedPart.lot_id !== null && part.id !== requestedPart.lot_id)
          || (requestedPart.lot_id === null && part.source_kind !== 'material_return')) return invalid()
    }
  }
}

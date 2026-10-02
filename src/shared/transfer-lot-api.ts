import {receiptLotMilli} from './receipt-lot-api.ts'
import {outboundAvailableMilli} from './outbound-lot-api.ts'

export interface TransferLotLineInput {
  transfer_line_id: number
  lots: {lot_id: number; quantity: string}[]
}

export interface TransferLotOptions {
  transfer_id: number
  from_warehouse_id: number
  to_warehouse_id: number
  lines: {transfer_line_id: number; material_id: number; quantity: string; lots: {
    lot_id: number; code: string; source_kind: string; quantity: string
    supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
  }[]}[]
}

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

// IPC 只转发仓库调拨批次字段，旧服务端忽略请求体时由响应证据校验拦截。
export function transferLotBody(value: unknown): {lines: TransferLotLineInput[]} {
  if (!value || typeof value !== 'object' || !Array.isArray((value as {lines?: unknown}).lines))
    throw Error('仓库调拨批次明细无效')
  const source = (value as {lines: unknown[]}).lines
  if (source.length < 1 || source.length > 100) throw Error('仓库调拨批次行数无效')
  const lineIds = new Set<number>()
  return {lines: source.map(item => {
    if (!item || typeof item !== 'object') throw Error('仓库调拨批次行无效')
    const line = item as Record<string, unknown>
    if (!positiveId(line.transfer_line_id) || lineIds.has(line.transfer_line_id))
      throw Error('仓库调拨明细编号无效')
    lineIds.add(line.transfer_line_id)
    if (!Array.isArray(line.lots) || line.lots.length < 1 || line.lots.length > 20)
      throw Error('仓库调拨批次数量无效')
    const lotIds = new Set<number>()
    return {transfer_line_id: line.transfer_line_id, lots: line.lots.map(item => {
      if (!item || typeof item !== 'object') throw Error('仓库调拨批次无效')
      const part = item as Record<string, unknown>
      if (!positiveId(part.lot_id) || lotIds.has(part.lot_id)
          || typeof part.quantity !== 'string' || receiptLotMilli(part.quantity) === null)
        throw Error('仓库调拨批次编号或数量无效')
      lotIds.add(part.lot_id)
      return {lot_id: part.lot_id, quantity: part.quantity}
    })}
  })}
}

export function validateTransferLotOptions(value: unknown, transferId: number): asserts value is TransferLotOptions {
  const invalid = () => { throw Error('可用批次响应不匹配，请重新读取。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.transfer_id !== transferId || !positiveId(result.from_warehouse_id)
      || !positiveId(result.to_warehouse_id)
      || result.from_warehouse_id === result.to_warehouse_id
      || !Array.isArray(result.lines) || result.lines.length < 1 || result.lines.length > 100) return invalid()
  const lines = new Set<number>()
  for (const item of result.lines) {
    if (!item || typeof item !== 'object') return invalid()
    const line = item as Record<string, unknown>
    if (!positiveId(line.transfer_line_id) || lines.has(line.transfer_line_id)
        || !positiveId(line.material_id) || typeof line.quantity !== 'string'
        || receiptLotMilli(line.quantity) === null || !Array.isArray(line.lots)) return invalid()
    lines.add(line.transfer_line_id)
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

export function validatePostedTransferLots(value: unknown, transferId: number,
                                           requested: TransferLotLineInput[]): void {
  const invalid = () => { throw Error('服务端未固定本次仓库调拨的实物批次，请核对服务端版本和批次差额。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.id !== transferId || result.status !== 'posted' || !Array.isArray(result.lines)) return invalid()
  for (const line of requested) {
    const returned = result.lines.find(item => item && typeof item === 'object'
      && (item as Record<string, unknown>).id === line.transfer_line_id) as Record<string, unknown> | undefined
    if (!returned || !Array.isArray(returned.physical_lots)
        || returned.physical_lots.length !== line.lots.length) return invalid()
    for (let index = 0; index < line.lots.length; index++) {
      const part = returned.physical_lots[index] as Record<string, unknown> | undefined
      if (!part || part.id !== line.lots[index].lot_id || typeof part.quantity !== 'string'
          || receiptLotMilli(part.quantity) !== receiptLotMilli(line.lots[index].quantity)) return invalid()
    }
  }
}


import {receiptLotMilli} from './receipt-lot-api.ts'
import {outboundAvailableMilli} from './outbound-lot-api.ts'

export interface MaterialIssueLotLineInput {
  material_issue_line_id: number
  lots: {lot_id: number; quantity: string}[]
}

export interface MaterialIssueLotOptions {
  material_issue_id: number
  warehouse_id: number
  lines: {material_issue_line_id: number; material_id: number; quantity: string; lots: {
    lot_id: number; code: string; source_kind: string; quantity: string
    supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
  }[]}[]
}

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

// IPC 只转发领料批次字段，并核对服务端是否真正保存了分配证据。
export function materialIssueLotBody(value: unknown): {lines: MaterialIssueLotLineInput[]} {
  if (!value || typeof value !== 'object' || !Array.isArray((value as {lines?: unknown}).lines))
    throw Error('生产领料批次明细无效')
  const source = (value as {lines: unknown[]}).lines
  if (source.length < 1 || source.length > 100) throw Error('生产领料批次行数无效')
  const lineIds = new Set<number>()
  return {lines: source.map(item => {
    if (!item || typeof item !== 'object') throw Error('生产领料批次行无效')
    const line = item as Record<string, unknown>
    if (!positiveId(line.material_issue_line_id) || lineIds.has(line.material_issue_line_id))
      throw Error('生产领料明细编号无效')
    lineIds.add(line.material_issue_line_id)
    if (!Array.isArray(line.lots) || line.lots.length < 1 || line.lots.length > 20)
      throw Error('生产领料批次数量无效')
    const lotIds = new Set<number>()
    return {material_issue_line_id: line.material_issue_line_id, lots: line.lots.map(item => {
      if (!item || typeof item !== 'object') throw Error('生产领料批次无效')
      const part = item as Record<string, unknown>
      if (!positiveId(part.lot_id) || lotIds.has(part.lot_id)
          || typeof part.quantity !== 'string' || receiptLotMilli(part.quantity) === null)
        throw Error('生产领料批次编号或数量无效')
      lotIds.add(part.lot_id)
      return {lot_id: part.lot_id, quantity: part.quantity}
    })}
  })}
}

export function validateMaterialIssueLotOptions(value: unknown, issueId: number):
    asserts value is MaterialIssueLotOptions {
  const invalid = () => { throw Error('可用领料批次响应不匹配，请重新读取。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.material_issue_id !== issueId || !positiveId(result.warehouse_id)
      || !Array.isArray(result.lines) || result.lines.length < 1 || result.lines.length > 100) return invalid()
  const lines = new Set<number>()
  for (const item of result.lines) {
    if (!item || typeof item !== 'object') return invalid()
    const line = item as Record<string, unknown>
    if (!positiveId(line.material_issue_line_id) || lines.has(line.material_issue_line_id)
        || !positiveId(line.material_id) || typeof line.quantity !== 'string'
        || receiptLotMilli(line.quantity) === null || !Array.isArray(line.lots)) return invalid()
    lines.add(line.material_issue_line_id)
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

export function validatePostedMaterialIssueLots(value: unknown, issueId: number,
                                                 requested: MaterialIssueLotLineInput[]): void {
  const invalid = () => { throw Error('服务端未固定本次生产领料的实物批次，请核对服务端版本和批次差额。') }
  if (!value || typeof value !== 'object') return invalid()
  const result = value as Record<string, unknown>
  if (result.id !== issueId || result.status !== 'posted' || !Array.isArray(result.lines)) return invalid()
  for (const line of requested) {
    const returned = result.lines.find(item => item && typeof item === 'object'
      && (item as Record<string, unknown>).id === line.material_issue_line_id) as Record<string, unknown> | undefined
    if (!returned || !Array.isArray(returned.physical_lots)
        || returned.physical_lots.length !== line.lots.length) return invalid()
    for (let index = 0; index < line.lots.length; index++) {
      const part = returned.physical_lots[index] as Record<string, unknown> | undefined
      if (!part || part.id !== line.lots[index].lot_id || typeof part.quantity !== 'string'
          || receiptLotMilli(part.quantity) !== receiptLotMilli(line.lots[index].quantity)) return invalid()
    }
  }
}

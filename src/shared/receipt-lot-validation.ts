import type {ReceiptLotLineInput} from './receipt-lot-api'
import {receiptLotDate, receiptLotMilli} from './receipt-lot-api.ts'

// IPC 只转发这几项业务字段；渲染层无法追加任意 URL、来源编号或库存流水。
export function receiptLotBody(value: unknown): {lines: ReceiptLotLineInput[]} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('采购入库批次无效')
  const lines = (value as Record<string, unknown>).lines
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw Error('采购入库批次行数无效')
  const ids = new Set<number>()
  const clean = lines.map((line): ReceiptLotLineInput => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw Error('采购入库批次明细无效')
    const source = line as Record<string, unknown>
    const id = source.receipt_line_id
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || ids.has(id))
      throw Error('采购入库批次明细编号无效')
    ids.add(id)
    if (!Array.isArray(source.lots) || source.lots.length < 1 || source.lots.length > 20)
      throw Error('采购入库批次数量无效')
    const lots = source.lots.map(part => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) throw Error('采购入库批次记录无效')
      const record = part as Record<string, unknown>
      if (typeof record.quantity !== 'string' || receiptLotMilli(record.quantity) === null)
        throw Error('采购入库批次数量无效')
      const supplierLot = record.supplier_lot
      if (supplierLot !== null && (typeof supplierLot !== 'string' || supplierLot.trim().length > 100))
        throw Error('供应商批号无效')
      const manufactured = record.manufactured_on
      const expires = record.expires_on
      if (manufactured !== null && (typeof manufactured !== 'string' || !receiptLotDate(manufactured)))
        throw Error('生产日期无效')
      if (expires !== null && (typeof expires !== 'string' || !receiptLotDate(expires)))
        throw Error('失效日期无效')
      if (typeof manufactured === 'string' && typeof expires === 'string' && expires < manufactured)
        throw Error('失效日期早于生产日期')
      return {quantity: record.quantity, supplier_lot: supplierLot?.trim() || null,
        manufactured_on: manufactured, expires_on: expires}
    })
    return {receipt_line_id: id, lots}
  })
  return {lines: clean}
}

export function validatePostedReceiptLots(value: unknown, receiptId: number,
                                          requested: ReceiptLotLineInput[]): void {
  const invalid = () => { throw Error('服务端未固定本次采购入库的实物批次，请核对服务端版本和批次差额。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const receipt = value as Record<string, unknown>
  if (receipt.id !== receiptId || receipt.status !== 'posted' || !Array.isArray(receipt.lines)) return invalid()
  for (const line of requested) {
    const returned = receipt.lines.find(item => item && typeof item === 'object'
      && (item as Record<string, unknown>).id === line.receipt_line_id) as Record<string, unknown> | undefined
    if (!returned || !Array.isArray(returned.physical_lots)
        || returned.physical_lots.length !== line.lots.length) return invalid()
    for (let index = 0; index < line.lots.length; index++) {
      const actual = returned.physical_lots[index]
      const expected = line.lots[index]
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return invalid()
      const recorded = actual as Record<string, unknown>
      if (typeof recorded.id !== 'number' || !Number.isSafeInteger(recorded.id) || recorded.id <= 0
          || typeof recorded.code !== 'string' || !recorded.code
          || typeof recorded.quantity !== 'string'
          || receiptLotMilli(recorded.quantity) !== receiptLotMilli(expected.quantity)
          || recorded.supplier_lot !== expected.supplier_lot
          || recorded.manufactured_on !== expected.manufactured_on
          || recorded.expires_on !== expected.expires_on) return invalid()
    }
  }
}

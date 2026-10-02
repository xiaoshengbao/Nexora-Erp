// 采购入库确认时固定实物批次；供应商批号缺失时仍保留独立的内部来源编号。
export interface ReceiptLotPartInput {
  quantity: string
  supplier_lot: string | null
  manufactured_on: string | null
  expires_on: string | null
}

export type PhysicalLotPartInput = ReceiptLotPartInput

export interface InboundLotLineInput {
  inbound_line_id: number
  lots: PhysicalLotPartInput[]
}

export interface ReceiptLotLineInput {
  receipt_line_id: number
  lots: ReceiptLotPartInput[]
}

export interface ReceiptPhysicalLot {
  id: number
  code: string
  quantity: string
  supplier_lot: string | null
  manufactured_on: string | null
  expires_on: string | null
}

export function receiptLotMilli(value: string): bigint | null {
  if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
  return milli > 0n && milli <= 1_000_000_000n ? milli : null
}

export function receiptLotDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

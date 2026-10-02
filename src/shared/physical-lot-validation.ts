// 服务端升级不同步或响应损坏时，不能把空值当作批次已核对。
type Check = (value: unknown) => boolean
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text: Check = value => typeof value === 'string'
const positive: Check = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const nonnegative: Check = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const optional = (check: Check): Check => value => value === null || check(value)
const decimal: Check = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)
const array = (check: Check): Check => value => Array.isArray(value) && value.every(check)
function fields(value: unknown, spec: Record<string, Check>): boolean {
  return object(value) && Object.entries(spec).every(([key, check]) => check(value[key]))
}
const row: Check = value => fields(value, {
  warehouse_id: positive, warehouse_name: text, material_id: positive, sku: text,
  material_name: text, unit: text, lot_id: positive, lot_code: text, source_kind: text,
  supplier_lot: optional(text), manufactured_on: optional(text), expires_on: optional(text), quantity: decimal
})
const difference: Check = value => fields(value, {
  warehouse_id: positive, warehouse_name: text, material_id: positive, sku: text,
  stock_quantity: decimal, lot_quantity: decimal, difference: decimal
})
const identity: Check = value => fields(value, {
  id: positive, material_id: positive, code: text, source_kind: text,
  supplier_lot: optional(text), manufactured_on: optional(text), expires_on: optional(text),
  origin_movement_id: optional(positive), sku: text, material_name: text, unit: text
})
const opening: Check = value => fields(value, {
  id: positive, warehouse_id: positive, warehouse_name: text, quantity: decimal,
  checkpoint_movement_id: nonnegative, evidence: text, created_at: text
})
const movement: Check = value => fields(value, {
  id: positive, movement_id: positive, warehouse_id: positive, warehouse_name: text,
  quantity: decimal, source_type: text, source_id: positive, source_line_id: positive,
  created_by_name: optional(text), created_at: text, original_allocation_id: optional(positive)
})
const balance: Check = value => fields(value, {warehouse_id: positive, warehouse_name: text, quantity: decimal})
const overview: Check = value => fields(value, {
  as_of: text, warehouse_id: optional(positive), material_id: optional(positive),
  rows: array(row), differences: array(difference), fully_allocated: value => typeof value === 'boolean'
}) && object(value) && value.fully_allocated === (Array.isArray(value.differences) && value.differences.length === 0)
const history: Check = value => fields(value, {
  as_of: text, lot: identity, openings: array(opening), movements: array(movement), balances: array(balance)
})
export function validatePhysicalLotResult(action: string, value: unknown): void {
  const check = action === 'physicalLotOverview' ? overview : action === 'physicalLotHistory' ? history : null
  if (check && !check(value)) throw new Error('实物批次响应格式不匹配，请核对服务端版本后重新读取。')
}

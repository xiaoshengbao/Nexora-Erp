// 实物批次是读侧证据；旧库存未识别期初不能冒充真实来料批号。
export interface PhysicalLotRow {
  warehouse_id: number; warehouse_name: string; material_id: number; sku: string
  material_name: string; unit: string; lot_id: number; lot_code: string; source_kind: string
  supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
  quantity: string
}
export interface PhysicalLotDifference {
  warehouse_id: number; warehouse_name: string; material_id: number; sku: string
  stock_quantity: string; lot_quantity: string; difference: string
}
export interface PhysicalLotOverview {
  as_of: string; warehouse_id: number | null; material_id: number | null
  rows: PhysicalLotRow[]; differences: PhysicalLotDifference[]; fully_allocated: boolean
}
export interface PhysicalLotIdentity {
  id: number; material_id: number; code: string; source_kind: string
  supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
  origin_movement_id: number | null; sku: string; material_name: string; unit: string
}
export interface PhysicalLotHistory {
  as_of: string; lot: PhysicalLotIdentity
  openings: {id: number; warehouse_id: number; warehouse_name: string; quantity: string
    checkpoint_movement_id: number; evidence: string; created_at: string}[]
  movements: {id: number; movement_id: number; warehouse_id: number; warehouse_name: string
    quantity: string; source_type: string; source_id: number; source_line_id: number
    created_by_name: string | null; created_at: string; original_allocation_id: number | null}[]
  balances: {warehouse_id: number; warehouse_name: string; quantity: string}[]
}
export interface PhysicalLotOperations {
  physicalLotOverview: {input: {warehouse_id: number | null; material_id: number | null}; output: PhysicalLotOverview}
  physicalLotHistory: {input: {lot_id: number}; output: PhysicalLotHistory}
}

export function physicalLotKindLabel(kind: string): string {
  if (kind === 'legacy') return '历史未识别'
  return ({receipt: '采购入库', other_inbound: '其他入库', production_completion: '合格完工',
    stocktake: '盘点发现'} as Record<string,string>)[kind]
    ?? '已记录批次'
}

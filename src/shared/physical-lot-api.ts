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
  reclassifications: {id: number; warehouse_id: number; warehouse_name: string
    quantity: string; counterpart_lot_id: number; counterpart_lot_code: string
    evidence: string; original_reclassification_id: number | null
    created_by_name: string; created_at: string}[]
  movement_evidence: {id: number; movement_id: number; warehouse_id: number; warehouse_name: string
    quantity: string; source_type: string; source_id: number; source_line_id: number
    evidence: string; created_by_name: string; original_evidence_id: number | null
    created_at: string}[]
  evidence_pairs: {id: number; inbound_movement_id: number; outbound_movement_id: number
    inbound_evidence_id: number; outbound_evidence_id: number; quantity: string; evidence: string
    original_pair_id: number | null; created_by_name: string; created_at: string}[]
  balances: {warehouse_id: number; warehouse_name: string; quantity: string}[]
}
export interface PhysicalLotUnallocatedMovement {
  movement_id: number; warehouse_id: number; material_id: number
  quantity: string; unallocated_quantity: string; source_type: string
  source_id: number; source_line_id: number; created_at: string
}
export interface PhysicalLotUnallocatedList {
  checkpoint_movement_id: number; checkpoint_basis: string
  warehouse_id: number | null; material_id: number | null
  rows: PhysicalLotUnallocatedMovement[]; has_more: boolean
}
export interface PhysicalLotMovementEvidenceInput {
  movement_id: number; lot_id: number | null; quantity: string; evidence: string
  supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
}
export interface PhysicalLotMovementEvidenceResult {
  id: number; movement_id: number; lot_id: number; lot_code: string
  warehouse_id: number; material_id: number; quantity: string; evidence: string
  original_evidence_id: number | null; created_by_name: string; created_at: string
}
export interface PhysicalLotMovementEvidenceReverseInput {record_id: number; reason: string}
export interface PhysicalLotEvidencePairInput {
  inbound_movement_id: number; outbound_movement_id: number; lot_id: number | null
  quantity: string; evidence: string; supplier_lot: string | null
  manufactured_on: string | null; expires_on: string | null
}
export interface PhysicalLotEvidencePairResult {
  id: number; inbound_movement_id: number; outbound_movement_id: number
  inbound_evidence_id: number; outbound_evidence_id: number
  lot_id: number; lot_code: string; warehouse_id: number; material_id: number
  quantity: string; evidence: string; original_pair_id: number | null
  created_by_name: string; created_at: string
}
export interface PhysicalLotEvidencePairReverseInput {record_id: number; reason: string}
export interface PhysicalLotEvidenceInput {
  legacy_lot_id: number; warehouse_id: number; quantity: string; evidence: string
  supplier_lot: string | null; manufactured_on: string | null; expires_on: string | null
}
export interface PhysicalLotEvidenceResult {
  id: number; legacy_lot_id: number; verified_lot_id: number; warehouse_id: number
  quantity: string; evidence: string; created_by_name: string; created_at: string
  verified_lot_code: string; original_reclassification_id: number | null
}
export interface PhysicalLotReverseInput {record_id: number; reason: string}
export interface PhysicalLotOperations {
  physicalLotOverview: {input: {warehouse_id: number | null; material_id: number | null}; output: PhysicalLotOverview}
  physicalLotHistory: {input: {lot_id: number}; output: PhysicalLotHistory}
  physicalLotEvidence: {input: PhysicalLotEvidenceInput; output: PhysicalLotEvidenceResult}
  physicalLotEvidenceReverse: {input: PhysicalLotReverseInput; output: PhysicalLotEvidenceResult}
  physicalLotUnallocated: {input: {warehouse_id: number | null; material_id: number | null}; output: PhysicalLotUnallocatedList}
  physicalLotMovementEvidence: {input: PhysicalLotMovementEvidenceInput; output: PhysicalLotMovementEvidenceResult}
  physicalLotMovementEvidenceReverse: {input: PhysicalLotMovementEvidenceReverseInput; output: PhysicalLotMovementEvidenceResult}
  physicalLotEvidencePair: {input: PhysicalLotEvidencePairInput; output: PhysicalLotEvidencePairResult}
  physicalLotEvidencePairReverse: {input: PhysicalLotEvidencePairReverseInput; output: PhysicalLotEvidencePairResult}
}

function evidenceFields(source: Record<string, unknown>): Pick<PhysicalLotEvidenceInput,
  'quantity' | 'evidence' | 'supplier_lot' | 'manufactured_on' | 'expires_on'> {
  const quantity = source.quantity
  if (typeof quantity !== 'string' || !/^\d+(?:\.\d{1,3})?$/.test(quantity)
      || Number(quantity) <= 0 || Number(quantity) > 1_000_000) throw new Error('补证数量须为正数且最多三位小数')
  const evidence = source.evidence
  if (typeof evidence !== 'string' || evidence.trim().length < 10 || evidence.trim().length > 500)
    throw new Error('请填写 10 至 500 字的现场核对依据')
  const supplier = source.supplier_lot
  if (supplier !== null && (typeof supplier !== 'string' || supplier.trim().length > 100))
    throw new Error('供应商批号无效')
  const date = (item: unknown): item is string | null => item === null
    || (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item)
      && !Number.isNaN(Date.parse(item)) && new Date(item).toISOString().startsWith(item))
  if (!date(source.manufactured_on) || !date(source.expires_on)
      || (source.manufactured_on && source.expires_on && source.expires_on < source.manufactured_on))
    throw new Error('生产日期或失效日期无效')
  return {quantity, evidence: evidence.trim(), supplier_lot: supplier?.trim() || null,
    manufactured_on: source.manufactured_on, expires_on: source.expires_on}
}

export function physicalLotEvidenceBody(value: unknown): PhysicalLotEvidenceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('批次补证数据无效')
  const source = value as Record<string, unknown>
  const positive = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item > 0
  if (!positive(source.legacy_lot_id) || !positive(source.warehouse_id)) throw new Error('批次或仓库编号无效')
  return {legacy_lot_id: source.legacy_lot_id, warehouse_id: source.warehouse_id,
    ...evidenceFields(source)}
}

export function physicalLotReverseBody(value: unknown): {reason: string} {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
  const reason = source?.reason
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500)
    throw new Error('请填写 10 至 500 字的冲销原因')
  return {reason: reason.trim()}
}

export function physicalLotMovementEvidenceBody(value: unknown): Omit<PhysicalLotMovementEvidenceInput,'movement_id'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('逐笔补证数据无效')
  const source = value as Record<string, unknown>
  if (source.lot_id !== null && (typeof source.lot_id !== 'number'
      || !Number.isSafeInteger(source.lot_id) || source.lot_id <= 0)) throw new Error('所选批次编号无效')
  return {lot_id: source.lot_id as number | null,...evidenceFields(source)}
}

export function physicalLotEvidencePairBody(value: unknown): PhysicalLotEvidencePairInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('成对补证数据无效')
  const source = value as Record<string, unknown>
  const inbound = source.inbound_movement_id, outbound = source.outbound_movement_id
  if (typeof inbound !== 'number' || !Number.isSafeInteger(inbound) || inbound <= 0
      || typeof outbound !== 'number' || !Number.isSafeInteger(outbound) || outbound <= inbound)
    throw new Error('须选择先入后出的两笔库存流水')
  const {lot_id, ...evidence} = physicalLotMovementEvidenceBody(value)
  return {inbound_movement_id: inbound, outbound_movement_id: outbound, lot_id, ...evidence}
}

export function physicalLotKindLabel(kind: string): string {
  if (kind === 'legacy') return '历史未识别'
  if (kind === 'legacy_evidence') return '历史现场补证'
  if (kind === 'movement_evidence') return '旧流水逐笔补证'
  return ({receipt: '采购入库', other_inbound: '其他入库', production_completion: '合格完工',
    stocktake: '盘点发现', adjustment: '调整新增', sales_return: '退货新批次',
    material_return: '退料新批次'} as Record<string,string>)[kind]
    ?? '已记录批次'
}

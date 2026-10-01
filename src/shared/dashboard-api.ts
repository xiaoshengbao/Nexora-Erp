export type DashboardPeriod = '7d' | '30d'
export interface DashboardAmount {
  amount: string | null
  known_amount: string
  unpriced_count: number
  source_line_count: number
}
export interface DashboardResult {
  period: DashboardPeriod
  from_date: string; to_date: string; previous_from_date: string; previous_to_date: string
  generated_at: string; currency: 'CNY'; time_basis: 'UTC'
  finance: {
    sales: {current: DashboardAmount; previous: DashboardAmount}
    purchase: {current: DashboardAmount; previous: DashboardAmount}
    trend: {date: string; sales: DashboardAmount; purchase: DashboardAmount}[]
    evidence_total: number
    evidence: {key: string; kind: 'receivable'|'payable'; source_type: string; source_id: number;
      source_line_id: number; order_id: number|null; amount: string|null; posted_at: string}[]
  } | null
  sales: {draft: number; waiting: number} | null
  purchase: {draft: number; waiting: number} | null
  production: {draft: number; released: number; awaiting_inspection: number; awaiting_post: number} | null
  inventory: {positive_positions: number; stocked_materials: number; registered_materials: number; negative_positions: number} | null
  composition: {key: string; label: string; count: number}[]
}
export interface DashboardOperations {
  dashboard: {input: {period: DashboardPeriod}; output: DashboardResult}
}

const record = (value:unknown): value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value)
const count = (value:unknown): boolean => typeof value==='number' && Number.isSafeInteger(value) && value>=0
const money = (value:unknown): boolean => typeof value==='string' && /^-?\d{1,32}\.\d{2}$/.test(value)
const day = (value:unknown): boolean => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
function amount(value:unknown):boolean {
  return record(value) && (value.amount===null || money(value.amount)) && money(value.known_amount)
    && count(value.unpriced_count) && count(value.source_line_count)
}
function counts(value:unknown,keys:string[]):boolean {return value===null || record(value) && keys.every(key=>count(value[key]))}

// 固定接口仍校验网络响应，旧版或异常服务端不能把不完整对象交给经营面板。
export function validateDashboardResult(value:unknown,period:DashboardPeriod): asserts value is DashboardResult {
  const invalid=()=>{throw new Error('首页统计响应格式不匹配，请确认桌面端与服务端版本一致。')}
  if(!record(value) || value.period!==period || value.currency!=='CNY' || value.time_basis!=='UTC'
    || !['from_date','to_date','previous_from_date','previous_to_date'].every(key=>day(value[key]))
    || typeof value.generated_at!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/.test(value.generated_at))invalid()
  if(!record(value))return
  if(!counts(value.sales,['draft','waiting']) || !counts(value.purchase,['draft','waiting'])
    || !counts(value.production,['draft','released','awaiting_inspection','awaiting_post'])
    || !counts(value.inventory,['positive_positions','stocked_materials','registered_materials','negative_positions']))invalid()
  if(!Array.isArray(value.composition) || value.composition.length>4 || !value.composition.every(row=>record(row)
    && typeof row.key==='string' && ['shipment','receipt','production_completion','transfer'].includes(row.key) && typeof row.label==='string' && count(row.count)))invalid()
  const finance=value.finance
  if(finance===null)return
  if(!record(finance))return invalid()
  for(const key of ['sales','purchase']){
    const group=finance[key]
    if(!record(group) || !amount(group.current) || !amount(group.previous))invalid()
  }
  if(!Array.isArray(finance.trend) || finance.trend.length!==(period==='7d'?7:30) || !finance.trend.every(row=>
    record(row) && day(row.date) && amount(row.sales) && amount(row.purchase)))invalid()
  if(!count(finance.evidence_total) || !Array.isArray(finance.evidence) || finance.evidence.length>100 || !finance.evidence.every(row=>
    record(row) && typeof row.key==='string' && typeof row.kind==='string' && ['receivable','payable'].includes(row.kind)
    && typeof row.source_type==='string' && ['shipment','shipment_reversal','sales_return','sales_return_reversal','receipt','receipt_reversal','purchase_return','purchase_return_reversal','after_sales_repair','after_sales_repair_reversal'].includes(row.source_type)
    && count(row.source_id) && count(row.source_line_id) && (row.order_id===null || count(row.order_id))
    && (row.amount===null || money(row.amount)) && typeof row.posted_at==='string'))invalid()
}

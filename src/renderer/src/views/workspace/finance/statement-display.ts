import type { LedgerAccount, StatementGroup, StatementPolicy, StatementReport } from '../../../../../shared/erp-api'

export const statementGroups: Record<StatementGroup, string> = {
  asset: '资产', liability: '负债', equity: '权益', revenue: '收入', expense: '费用及销售成本'
}
export function compatibleStatementGroups(account: LedgerAccount): StatementGroup[] {
  return account.category === 'cost' ? ['asset', 'expense']
    : [account.category === 'income' ? 'revenue' : account.category]
}
export function manualTransferIds(value: string): number[] | null {
  if (!value.trim()) return []
  const parts = value.trim().split(/[\s,，、;；]+/)
  if (parts.some(part => !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)))) return null
  const ids = parts.map(Number)
  return new Set(ids).size === ids.length ? ids : null
}
export function statementPolicyProblems(policy: StatementPolicy, accounts: LedgerAccount[]): string[] {
  const problems: string[] = []
  if (!policy.lines.length) problems.push('至少填写一个报表项目。')
  if (new Set(policy.lines.map(item => item.code)).size !== policy.lines.length) problems.push('项目编码不能重复。')
  if (policy.lines.some(item => !/^[A-Z][A-Z0-9_]{0,31}$/.test(item.code) || !item.name.trim())) problems.push('项目编码须以大写字母开头，仅使用大写字母、数字或下划线；名称不能为空。')
  if (policy.allocations.some(item => {
    const account = accounts.find(account => account.id === item.account_id)
    const line = policy.lines.find(line => line.code === item.line_code)
    return !account || !line || !compatibleStatementGroups(account).includes(line.group)
  })) problems.push('有科目分配与项目类别不一致，请重新选择项目。')
  return problems
}
export function statementPolicyDescription(policy: StatementPolicy | null): string {
  return policy?.version ? `版本 ${policy.version}；${policy.lines.length} 个项目；${policy.allocations.length} 个科目；手工结转 ${policy.manual_transfer_ids.map(id => `记-${id}`).join('、') || '无'}` : '尚未配置'
}
// 未结转损益是反向汇总损益余额，不沿用收入/费用项目的展示方向。
export function statementContributions(report: StatementReport, code: string) {
  const selected = code === '_UNCLOSED_PROFIT' ? report.balance_rows.find(row => row.code === code)?.account_ids ?? [] : null
  return report.contributions.filter(row => selected ? selected.includes(row.account_id) : row.line_code === code)
    .map(row => selected ? { ...row, opening: row.group === 'revenue' ? row.opening : negate(row.opening),
      closing: row.group === 'revenue' ? row.closing : negate(row.closing),
      movement: row.group === 'revenue' ? row.movement : negate(row.movement) } : row)
}
function negate(value: string): string {
  return /^-?0\.00$/.test(value) ? '0.00' : value.startsWith('-') ? value.slice(1) : '-' + value
}

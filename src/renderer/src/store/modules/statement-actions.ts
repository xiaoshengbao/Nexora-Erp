import { watch } from 'vue'
import type { StatementArchiveInput, StatementPolicy, StatementReport } from '../../../../shared/erp-api'
import type { AppState } from '../state'
import { displayError } from '../../utils/formatters.ts'

export function createStatementActions(state: AppState, perform: (action: () => Promise<unknown>, success: string) => Promise<void>) {
  let ticket = 0; let detailTicket = 0; let owner = 0
  const can = (permission: string): boolean => state.user.value?.permissions.includes(permission) ?? false
  const connected = (): boolean => !!window.nexora && !state.connectionLost.value
  function closeStatementArchive(): void {
    detailTicket++; state.statementArchive.value = null; state.statementArchiveLoading.value = false
  }
  function invalidate(): void {
    ticket++; state.statementReport.value = null; state.statementLoading.value = false; state.statementError.value = ''
    closeStatementArchive()
  }
  watch(state.statementQuery, invalidate, { deep: true, flush: 'sync' })
  watch(() => `${state.user.value?.id}:${state.user.value?.permissions.join('|')}`, () => {
    owner++; invalidate(); state.statementOptions.value = null
    state.statementPolicyChanges.value = []; state.statementArchives.value = []
  }, { flush: 'sync' })
  async function loadStatementOptions(): Promise<boolean> {
    if (!can('financial_statement.view') || !connected()) return false
    invalidate()
    state.statementOptions.value = null; state.statementPolicyChanges.value = []; state.statementArchives.value = []
    const current = ++ticket; state.statementLoading.value = true
    try {
      const [options, history, archives] = await Promise.all([
        window.nexora!.callApi('statementOptions', undefined),
        window.nexora!.callApi('statementPolicyChanges', undefined),
        window.nexora!.callApi('statementArchives', undefined)
      ])
      if (current !== ticket || !can('financial_statement.view')) return false
      state.statementOptions.value = options; state.statementPolicyChanges.value = history; state.statementArchives.value = archives
      return true
    } catch (error) {
      if (current === ticket) state.statementError.value = displayError(error)
      return false
    } finally { if (current === ticket) state.statementLoading.value = false }
  }
  async function queryStatement(): Promise<boolean> {
    if (!can('financial_statement.view') || !connected()) return false
    invalidate()
    const current = ++ticket; state.statementLoading.value = true
    const filters = { ...state.statementQuery.value }
    try {
      const result = await window.nexora!.callApi('queryStatement', filters)
      if (current !== ticket || !can('financial_statement.view')) return false
      state.statementReport.value = result
      return true
    } catch (error) {
      if (current === ticket) state.statementError.value = displayError(error)
      return false
    } finally { if (current === ticket) state.statementLoading.value = false }
  }
  async function openStatementArchive(id: number): Promise<void> {
    if (!can('financial_statement.view') || !connected()) return
    closeStatementArchive()
    const current = ++detailTicket; state.statementArchiveLoading.value = true; state.statementError.value = ''
    try {
      const result = await window.nexora!.callApi('statementArchiveDetail', { id })
      if (current === detailTicket && can('financial_statement.view')) state.statementArchive.value = result
    } catch (error) {
      if (current === detailTicket) state.statementError.value = displayError(error)
    } finally { if (current === detailTicket) state.statementArchiveLoading.value = false }
  }
  async function write(permission: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    if (!can(permission) || !connected() || state.busy.value) return false
    const current = owner; let saved = false
    await perform(async () => { await action(); saved = current === owner && can(permission) }, success)
    if (!saved || current !== owner || !can(permission)) return false
    await loadStatementOptions()
    return current === owner && can(permission)
  }
  async function exportStatement(report: StatementReport): Promise<void> {
    if (!can('financial_statement.view') || !connected()) return
    const current = owner
    // 只导出当前查询或已打开归档，页面不能将别的旧快照偷偷交给导出动作。
    if (report !== state.statementReport.value && report !== state.statementArchive.value?.snapshot) return
    try {
      const saved = await window.nexora!.saveReportCsv(`statements-${report.filters.from_date}-${report.filters.to_date}.csv`, report.csv)
      if (saved && current === owner && can('financial_statement.view')) state.notice.value = '财务报表 CSV 已保存。'
    } catch (error) { if (current === owner) state.statementError.value = displayError(error) }
  }
  return {
    loadStatementOptions, queryStatement, openStatementArchive, closeStatementArchive, exportStatement,
    saveStatementPolicy: (input: StatementPolicy & { reason: string }) => {
      const fields = { ...input, lines: input.lines.map(item => ({ ...item })),
        allocations: input.allocations.map(item => ({ ...item })), manual_transfer_ids: [...input.manual_transfer_ids] }
      return write('financial_statement.configure', () => window.nexora!.callApi('saveStatementPolicy', fields), '财务报表配置已保存，旧归档保持原快照。')
    },
    archiveStatement: (input: StatementArchiveInput) => write('financial_statement.archive',
      () => window.nexora!.callApi('archiveStatement', { ...input }), '财务报表已归档，金额及来源快照保持不变。')
  }
}

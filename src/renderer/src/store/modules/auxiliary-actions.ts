import { watch } from 'vue'
import type { AuxiliaryItemInput, AuxiliaryItemUpdate, AuxiliaryPolicyInput } from '../../../../shared/erp-api'
import type { AppState } from '../state'
import { displayError } from '../../utils/formatters.ts'

export function createAuxiliaryActions(state: AppState, perform: (action: () => Promise<unknown>, success: string) => Promise<void>) {
  let owner = 0; let optionsTicket = 0; let queryTicket = 0; let loadingTicket = 0
  const can = (permission: string): boolean => state.user.value?.permissions.includes(permission) ?? false
  const connected = (): boolean => !!window.nexora && !state.connectionLost.value
  function clearReport(): void {
    queryTicket++; state.auxiliaryReport.value = null; state.auxiliaryError.value = ''
  }
  watch(state.auxiliaryQuery, clearReport, { deep: true, flush: 'sync' })
  watch(() => `${state.user.value?.id}:${state.user.value?.permissions.join('|')}:${state.connectionLost.value}`, () => {
    owner++; optionsTicket++; loadingTicket++; clearReport(); state.auxiliaryLoading.value = false
    state.auxiliaryOptions.value = null; state.auxiliaryChanges.value = []
  }, { flush: 'sync' })
  async function loadAuxiliaryOptions(): Promise<boolean> {
    if (!can('auxiliary.view') || !connected()) return false
    clearReport(); state.auxiliaryOptions.value = null; state.auxiliaryChanges.value = []
    const current = ++optionsTicket; const session = owner; const activity = ++loadingTicket; state.auxiliaryLoading.value = true
    try {
      const [options, changes] = await Promise.all([
        window.nexora!.callApi('auxiliaryOptions', undefined), window.nexora!.callApi('auxiliaryChanges', undefined)
      ])
      if (current !== optionsTicket || session !== owner || !can('auxiliary.view')) return false
      state.auxiliaryOptions.value = options; state.auxiliaryChanges.value = changes
      return true
    } catch (error) {
      if (current === optionsTicket && session === owner) state.auxiliaryError.value = displayError(error)
      return false
    } finally { if (activity === loadingTicket && session === owner) state.auxiliaryLoading.value = false }
  }
  async function queryAuxiliary(): Promise<boolean> {
    if (!can('auxiliary.view') || !connected() || state.auxiliaryLoading.value) return false
    clearReport()
    const current = ++queryTicket; const session = owner; const activity = ++loadingTicket
    const filters = { ...state.auxiliaryQuery.value }; state.auxiliaryLoading.value = true
    try {
      const report = await window.nexora!.callApi('queryAuxiliary', filters)
      if (current !== queryTicket || session !== owner || !can('auxiliary.view')) return false
      state.auxiliaryReport.value = report
      return true
    } catch (error) {
      if (current === queryTicket && session === owner) state.auxiliaryError.value = displayError(error)
      return false
    } finally { if (activity === loadingTicket && session === owner) state.auxiliaryLoading.value = false }
  }
  async function write(permission: string, action: () => Promise<unknown>, message: string): Promise<boolean> {
    if (!can(permission) || !connected() || state.busy.value) return false
    const session = owner; let saved = false
    await perform(async () => { await action(); saved = session === owner && can(permission) }, message)
    if (!saved || session !== owner || !can(permission)) return false
    await loadAuxiliaryOptions()
    return session === owner && can(permission)
  }
  async function exportAuxiliary(): Promise<void> {
    const report = state.auxiliaryReport.value
    if (!report || !connected() || !can('auxiliary.view')) return
    const session = owner
    try {
      const saved = await window.nexora!.saveReportCsv(`auxiliary-${report.account.code}-${report.filters.kind}-${report.filters.from_date}-${report.filters.to_date}.csv`, report.csv)
      if (saved && session === owner && can('auxiliary.view')) state.notice.value = '辅助余额 CSV 已保存。'
    } catch (error) { if (session === owner) state.auxiliaryError.value = displayError(error) }
  }
  return {
    loadAuxiliaryOptions, queryAuxiliary, exportAuxiliary,
    createAuxiliaryItem: (input: AuxiliaryItemInput) => write('auxiliary.manage',
      () => window.nexora!.callApi('createAuxiliaryItem', { ...input }), '辅助档案已建立。'),
    updateAuxiliaryItem: (input: AuxiliaryItemUpdate) => write('auxiliary.manage',
      () => window.nexora!.callApi('updateAuxiliaryItem', { ...input }), '辅助档案已更新，已过账快照保持原样。'),
    saveAuxiliaryPolicy: (input: AuxiliaryPolicyInput) => write('auxiliary.configure',
      () => window.nexora!.callApi('saveAuxiliaryPolicy', { ...input, required_kinds: [...input.required_kinds] }), '辅助规则已保存，待处理分录将重新核验。')
  }
}

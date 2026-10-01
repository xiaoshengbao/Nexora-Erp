import {watch} from 'vue'
import type {AppState} from '../state'
import {displayError} from '../../utils/formatters.ts'

export function createDashboardActions(state: AppState) {
  let epoch = 0
  function invalidateDashboard(): void {
    epoch++; state.dashboardResult.value = null; state.dashboardLoading.value = false; state.dashboardError.value = ''
  }
  // 身份、实例、权限、断线和时间范围变化均使旧响应失效，禁止跨账号保留经营金额。
  watch(() => `${state.user.value?.id}:${state.user.value?.permissions.join('|')}`, invalidateDashboard, {flush:'sync'})
  watch(state.connectionLost, invalidateDashboard, {flush:'sync'})
  watch(() => `${state.server.value?.id}:${state.server.value?.fingerprint}`, invalidateDashboard, {flush:'sync'})
  watch(state.dashboardPeriod, invalidateDashboard, {flush:'sync'})
  async function loadDashboard(): Promise<boolean> {
    if (!window.nexora || !state.user.value || state.connectionLost.value) return false
    const ticket = ++epoch
    state.dashboardResult.value = null; state.dashboardLoading.value = true; state.dashboardError.value = ''
    try {
      const result = await window.nexora.callApi('dashboard', {period:state.dashboardPeriod.value})
      if (ticket !== epoch) return false
      state.dashboardResult.value = result
      return true
    } catch (error) {
      if (ticket === epoch) state.dashboardError.value = displayError(error)
      return false
    } finally {
      if (ticket === epoch) state.dashboardLoading.value = false
    }
  }
  return {loadDashboard, invalidateDashboard}
}

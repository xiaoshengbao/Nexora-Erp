import {watch} from 'vue'
import type {AppState} from '../state'
import type {PhysicalLotEvidenceInput,PhysicalLotEvidenceResult,PhysicalLotReverseInput,PhysicalLotRow} from '../../../../shared/physical-lot-api'
import {displayError} from '../../utils/formatters.ts'

export function createPhysicalLotActions(state: AppState) {
  let owner = 0, reads = 0, details = 0
  const available = () => !!window.nexora && !state.connectionLost.value
    && (state.user.value?.permissions.includes('inventory.view') ?? false)
  function clearPhysicalLotHistory(): void { details++; state.lotHistory.value = null }
  function invalidate(): void {
    reads++; clearPhysicalLotHistory(); state.lotOverview.value = null
    state.lotLoading.value = false; state.lotError.value = ''
  }
  watch(() => `${state.user.value?.id}:${state.user.value?.permissions.join('|')}`, () => {
    owner++; invalidate(); state.lotWarehouseId.value = 0; state.lotMaterialId.value = 0
  }, {flush: 'sync'})
  watch(state.connectionLost, () => {owner++; invalidate()}, {flush: 'sync'})
  async function loadPhysicalLots(): Promise<boolean> {
    if (!available()) return false
    const ticket = ++reads, session = owner
    const warehouse = state.lotWarehouseId.value || null, material = state.lotMaterialId.value || null
    state.lotLoading.value = true; state.lotError.value = ''; state.lotOverview.value = null
    clearPhysicalLotHistory()
    try {
      const result = await window.nexora!.callApi('physicalLotOverview', {warehouse_id: warehouse, material_id: material})
      if (ticket !== reads || session !== owner || !available()
          || warehouse !== (state.lotWarehouseId.value || null) || material !== (state.lotMaterialId.value || null)) return false
      if (result.warehouse_id !== warehouse || result.material_id !== material) throw Error('批次查询范围不匹配，请重新读取。')
      state.lotOverview.value = result
      return true
    } catch (cause) {
      if (ticket === reads && session === owner) state.lotError.value = displayError(cause)
      return false
    } finally {
      if (ticket === reads && session === owner) state.lotLoading.value = false
    }
  }
  async function loadPhysicalLotHistory(row: Pick<PhysicalLotRow, 'lot_id' | 'material_id'>): Promise<boolean> {
    if (!available()) return false
    clearPhysicalLotHistory()
    const ticket = details, session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotHistory', {lot_id: row.lot_id})
      if (ticket !== details || session !== owner || !available()) return false
      if (result.lot.id !== row.lot_id || result.lot.material_id !== row.material_id)
        throw Error('批次历史来源不匹配，请重新读取。')
      state.lotHistory.value = result
      return true
    } catch (cause) {
      if (ticket === details && session === owner) state.lotError.value = displayError(cause)
      return false
    }
  }
  async function savePhysicalLotEvidence(input: PhysicalLotEvidenceInput): Promise<PhysicalLotEvidenceResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.reclassify')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotEvidence', input)
      if (session !== owner || !available()) return null
      if (result.legacy_lot_id !== input.legacy_lot_id || result.warehouse_id !== input.warehouse_id
          || Number(result.quantity) !== Number(input.quantity))
        throw Error('批次补证响应与提交范围不一致，请重新读取。')
      await loadPhysicalLots()
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  async function reversePhysicalLotEvidence(input: PhysicalLotReverseInput): Promise<PhysicalLotEvidenceResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.reclassify')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotEvidenceReverse', input)
      if (session !== owner || !available()) return null
      if (result.original_reclassification_id !== input.record_id || !result.quantity.startsWith('-'))
        throw Error('批次补证冲销响应与原记录不一致，请重新读取。')
      await loadPhysicalLots()
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  return {loadPhysicalLots, loadPhysicalLotHistory, savePhysicalLotEvidence,
    reversePhysicalLotEvidence, clearPhysicalLotHistory}
}

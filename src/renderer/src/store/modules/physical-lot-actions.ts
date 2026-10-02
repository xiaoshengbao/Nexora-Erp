import {watch} from 'vue'
import type {AppState} from '../state'
import type {PhysicalLotEvidenceInput,PhysicalLotEvidenceResult,PhysicalLotEvidenceGroupInput,PhysicalLotEvidenceGroupResult,PhysicalLotEvidenceGroupReverseInput,PhysicalLotEvidencePairInput,PhysicalLotEvidencePairResult,PhysicalLotEvidencePairReverseInput,PhysicalLotMovementEvidenceInput,PhysicalLotMovementEvidenceResult,PhysicalLotMovementEvidenceReverseInput,PhysicalLotReverseInput,PhysicalLotRow} from '../../../../shared/physical-lot-api'
import {displayError} from '../../utils/formatters.ts'

export function createPhysicalLotActions(state: AppState) {
  let owner = 0, reads = 0, details = 0, unallocatedReads = 0
  const available = () => !!window.nexora && !state.connectionLost.value
    && (state.user.value?.permissions.includes('inventory.view') ?? false)
  function clearPhysicalLotHistory(): void { details++; state.lotHistory.value = null }
  function invalidate(): void {
    reads++; unallocatedReads++; clearPhysicalLotHistory(); state.lotOverview.value = null
    state.lotUnallocated.value = null
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
  async function loadPhysicalLotUnallocated(): Promise<boolean> {
    if (!available()) return false
    const ticket = ++unallocatedReads, session = owner
    const warehouse = state.lotWarehouseId.value || null, material = state.lotMaterialId.value || null
    state.lotUnallocated.value = null
    try {
      const result = await window.nexora!.callApi('physicalLotUnallocated',
        {warehouse_id: warehouse, material_id: material})
      if (ticket !== unallocatedReads || session !== owner || !available()
          || warehouse !== (state.lotWarehouseId.value || null)
          || material !== (state.lotMaterialId.value || null)) return false
      if (result.warehouse_id !== warehouse || result.material_id !== material)
        throw Error('未分配流水查询范围不匹配，请重新读取。')
      state.lotUnallocated.value = result
      return true
    } catch (cause) {
      if (ticket === unallocatedReads && session === owner) state.lotError.value = displayError(cause)
      return false
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
  async function savePhysicalLotMovementEvidence(input: PhysicalLotMovementEvidenceInput): Promise<PhysicalLotMovementEvidenceResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.movement_evidence')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotMovementEvidence', input)
      if (session !== owner || !available()) return null
      const source = state.lotUnallocated.value?.rows.find(row => row.movement_id === input.movement_id)
      if (result.movement_id !== input.movement_id || (input.lot_id !== null && result.lot_id !== input.lot_id)
          || (source && (result.warehouse_id !== source.warehouse_id || result.material_id !== source.material_id))
          || (Number(result.quantity) !== Number(input.quantity)
            && Number(result.quantity) !== -Number(input.quantity)))
        throw Error('逐笔补证响应与提交范围不一致，请重新读取。')
      await Promise.all([loadPhysicalLots(), loadPhysicalLotUnallocated()])
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  async function reversePhysicalLotMovementEvidence(input: PhysicalLotMovementEvidenceReverseInput): Promise<PhysicalLotMovementEvidenceResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.movement_evidence')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotMovementEvidenceReverse', input)
      if (session !== owner || !available()) return null
      if (result.original_evidence_id !== input.record_id)
        throw Error('逐笔补证冲销响应与原记录不一致，请重新读取。')
      await Promise.all([loadPhysicalLots(), loadPhysicalLotUnallocated()])
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  async function savePhysicalLotEvidencePair(input: PhysicalLotEvidencePairInput): Promise<PhysicalLotEvidencePairResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.movement_evidence')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotEvidencePair', input)
      if (session !== owner || !available()) return null
      const source = state.lotUnallocated.value?.rows.find(row => row.movement_id === input.inbound_movement_id)
      if (result.inbound_movement_id !== input.inbound_movement_id
          || result.outbound_movement_id !== input.outbound_movement_id
          || (input.lot_id !== null && result.lot_id !== input.lot_id)
          || Number(result.quantity) !== Number(input.quantity)
          || (source && (result.warehouse_id !== source.warehouse_id || result.material_id !== source.material_id)))
        throw Error('成对补证响应与提交范围不一致，请重新读取。')
      await Promise.all([loadPhysicalLots(), loadPhysicalLotUnallocated()])
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  async function reversePhysicalLotEvidencePair(input: PhysicalLotEvidencePairReverseInput): Promise<PhysicalLotEvidencePairResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.movement_evidence')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotEvidencePairReverse', input)
      if (session !== owner || !available()) return null
      if (result.original_pair_id !== input.record_id || !result.quantity.startsWith('-'))
        throw Error('成对补证冲销响应与原记录不一致，请重新读取。')
      await Promise.all([loadPhysicalLots(), loadPhysicalLotUnallocated()])
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  async function savePhysicalLotEvidenceGroup(input: PhysicalLotEvidenceGroupInput): Promise<PhysicalLotEvidenceGroupResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.movement_evidence')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotEvidenceGroup', input)
      if (session !== owner || !available()) return null
      const expected = [...input.pairs].map(row => `${row.inbound_movement_id}:${row.outbound_movement_id}:${Number(row.quantity)}`).sort()
      const received = result.pairs.map(row => `${row.inbound_movement_id}:${row.outbound_movement_id}:${Number(row.quantity)}`).sort()
      const source = state.lotUnallocated.value?.rows.find(row => row.movement_id === input.pairs[0].inbound_movement_id)
      if (expected.join('|') !== received.join('|')
          || (input.lot_id !== null && result.lot_id !== input.lot_id)
          || result.pairs.some(row => row.lot_id !== result.lot_id)
          || (source && (result.warehouse_id !== source.warehouse_id || result.material_id !== source.material_id)))
        throw Error('成组补证响应与提交范围不一致，请重新读取。')
      await Promise.all([loadPhysicalLots(), loadPhysicalLotUnallocated()])
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  async function reversePhysicalLotEvidenceGroup(input: PhysicalLotEvidenceGroupReverseInput): Promise<PhysicalLotEvidenceGroupResult | null> {
    if (!available() || !state.user.value?.permissions.includes('physical_lot.movement_evidence')) return null
    const session = owner
    state.lotError.value = ''
    try {
      const result = await window.nexora!.callApi('physicalLotEvidenceGroupReverse', input)
      if (session !== owner || !available()) return null
      if (result.original_group_id !== input.record_id || result.pairs.some(row => !row.quantity.startsWith('-')))
        throw Error('成组补证冲销响应与原记录不一致，请重新读取。')
      await Promise.all([loadPhysicalLots(), loadPhysicalLotUnallocated()])
      return result
    } catch (cause) {
      if (session === owner) state.lotError.value = displayError(cause)
      return null
    }
  }
  return {loadPhysicalLots, loadPhysicalLotUnallocated, loadPhysicalLotHistory,
    savePhysicalLotEvidence, reversePhysicalLotEvidence,
    savePhysicalLotMovementEvidence, reversePhysicalLotMovementEvidence,
    savePhysicalLotEvidencePair, reversePhysicalLotEvidencePair,
    savePhysicalLotEvidenceGroup, reversePhysicalLotEvidenceGroup,
    clearPhysicalLotHistory}
}

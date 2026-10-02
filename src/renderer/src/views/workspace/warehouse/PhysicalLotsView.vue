<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {storeToRefs} from 'pinia'
import {RouterLink} from 'vue-router'
import type {PhysicalLotRow} from '../../../../../shared/physical-lot-api'
import {physicalLotKindLabel} from '../../../../../shared/physical-lot-api'
import {usePiniaAppStore} from '../../../store/app-store'
import {movementTypeLabel} from '../../../utils/formatters'
import AppButton from '../../../components/app/AppButton.vue'
import WorkspaceSelect from '../../../components/workspace/WorkspaceSelect.vue'
import WorkspaceTable from '../../../components/workspace/WorkspaceTable.vue'

const store=usePiniaAppStore()
const {lotOverview:overview,lotHistory:history,lotLoading:loading,lotError:failure,
  lotWarehouseId:warehouse,lotMaterialId:material,warehouses,materials,busy,connectionLost,user}=storeToRefs(store)
const preparing=ref(false)
const disabled=computed(()=>busy.value || loading.value || preparing.value || connectionLost.value)
const lotColumns=[{key:'warehouse',title:'仓库',width:'17%'},{key:'material',title:'物料 / 单位',width:'25%'},
  {key:'lot',title:'实物批次与来源',width:'28%'},{key:'quantity',title:'批次现存量',width:'14%'},
  {key:'actions',title:'证据',width:'16%'}]
const differenceColumns=[{key:'warehouse_name',title:'仓库'},{key:'sku',title:'物料'},
  {key:'stock_quantity',title:'正式库存量'},{key:'lot_quantity',title:'已归批次量'},
  {key:'difference',title:'未分配差额'}]
const movementColumns=[{key:'created_at',title:'时间'},{key:'warehouse_name',title:'仓库'},
  {key:'source',title:'来源与操作人'},{key:'quantity',title:'批次数量变动'},
  {key:'original_allocation_id',title:'冲销关联'}]
function rowRecord(value:Record<string,unknown>):PhysicalLotRow|undefined {
  return overview.value?.rows.find(row=>row.lot_id===value.lot_id && row.warehouse_id===value.warehouse_id)
}
async function openHistory(value:Record<string,unknown>):Promise<void> {
  const row=rowRecord(value)
  if(!row || disabled.value)return
  preparing.value=true
  try{await store.loadPhysicalLotHistory(row)}finally{preparing.value=false}
}
function prepareLedger(warehouseId:number,materialId:number):void {
  Object.assign(store.ledgerQuery,{warehouse_id:warehouseId || null,material_id:materialId,
    from_date:'',to_date:'',source_type:null})
}
watch([warehouse,material],()=>{void store.loadPhysicalLots()})
watch(()=>`${user.value?.id}:${user.value?.permissions.join('|')}:${connectionLost.value}`,()=>{
  if(!connectionLost.value && store.can('inventory.view'))void store.loadPhysicalLots()
})
onMounted(()=>{void store.loadPhysicalLots()})
onUnmounted(()=>{store.clearPhysicalLotHistory()})
</script>

<template>
  <section class="stack physical-lots-page">
    <p v-if="!store.can('inventory.view')" role="status">当前账号没有库存查看权限，请联系管理员核对授权。</p>
    <template v-else>
      <p class="lot-note">实物批次目前只用于结存核对。历史未识别期初没有真实批号，现有单据尚未录入批次；批次余额与正式库存一致也不代表所有历史流水已追溯。</p>
      <p v-if="connectionLost" role="alert">服务端连接已中断，旧批次余额与来源证据已失效；恢复后请重新读取。</p>
      <p v-if="failure" role="alert">{{ failure }} 请核对筛选范围后重试。</p>
      <WorkspaceTable title="实物批次结存" :show-title="false" :columns="lotColumns" :data="overview?.rows??[]"
        :loading="loading" :min-table-width="1000">
        <template #filters>
          <label>仓库<WorkspaceSelect v-model="warehouse" :disabled="disabled" :options="[{value:0,label:'全部仓库'},...warehouses.map(row=>({value:row.id,label:`${row.code} · ${row.name}`}))]" /></label>
          <label>物料<WorkspaceSelect v-model="material" :disabled="disabled" :options="[{value:0,label:'全部物料'},...materials.map(row=>({value:row.id,label:`${row.sku} · ${row.name}`}))]" /></label>
          <AppButton type="button" :disabled="disabled" @click="store.loadPhysicalLots()">刷新批次</AppButton>
        </template>
        <template #beforeTable>
          <p v-if="overview" role="status" class="lot-summary">读取时间：{{ store.localTime(overview.as_of) }}。{{ overview.fully_allocated ? '当前筛选范围无数量差额。' : `当前有 ${overview.differences.length} 个仓库与物料组合存在未分配差额。` }}</p>
        </template>
        <template #cell-warehouse="{row}"><strong>{{ row.warehouse_name }}</strong></template>
        <template #cell-material="{row}"><strong>{{ row.sku }}</strong><span class="lot-muted">{{ row.material_name }} · {{ row.unit }}</span></template>
        <template #cell-lot="{row}"><strong>{{ row.lot_code }}</strong><span class="lot-muted">{{ physicalLotKindLabel(row.source_kind) }} · 供应商批号 {{ row.supplier_lot || '未提供' }}</span></template>
        <template #cell-quantity="{row}">{{ row.quantity }}</template>
        <template #cell-actions="{row}"><AppButton type="button" :disabled="disabled" @click="openHistory(row)">批次流水</AppButton></template>
        <template #empty>{{ loading ? '正在读取批次…' : failure ? '读取失败，请刷新重试。' : connectionLost ? '连接中断，旧结果已失效。' : '当前范围没有批次结存；请核对筛选条件与正式库存差额。' }}</template>
      </WorkspaceTable>
      <section v-if="overview?.differences.length" aria-label="批次未分配差额" class="stack">
        <h3>未分配差额</h3>
        <p class="lot-note">差额表示正式库存流水尚未分配到实物批次，不能当作可追踪库存。请先核对来源单据和历史期初。</p>
        <WorkspaceTable title="未分配差额" :show-title="false" :columns="differenceColumns" :data="overview.differences" :min-table-width="850">
          <template #cell-difference="{row}"><strong>{{ row.difference }}</strong></template>
        </WorkspaceTable>
      </section>
      <section v-if="history" aria-label="实物批次来源历史" class="stack lot-history">
        <h3>{{ history.lot.sku }} · {{ history.lot.code }} · 来源历史</h3>
        <p class="lot-muted">{{ physicalLotKindLabel(history.lot.source_kind) }}；供应商批号 {{ history.lot.supplier_lot || '未提供' }}；生产日期 {{ history.lot.manufactured_on || '未提供' }}；失效日期 {{ history.lot.expires_on || '未提供' }}。</p>
        <p v-if="history.lot.origin_movement_id">首次来源库存流水 #{{ history.lot.origin_movement_id }}。</p>
        <p v-for="opening in history.openings" :key="opening.id" class="lot-note">{{ opening.warehouse_name }} 历史未识别期初 {{ opening.quantity }} {{ history.lot.unit }}；升级检查点流水 #{{ opening.checkpoint_movement_id }}。{{ opening.evidence }}</p>
        <p v-if="!history.openings.length && !history.movements.length" class="lot-muted">该批次尚无期初或分配流水。</p>
        <h4>逐仓现存</h4>
        <p v-for="balance in history.balances" :key="balance.warehouse_id">{{ balance.warehouse_name }}：{{ balance.quantity }} {{ history.lot.unit }}</p>
        <h4>已归属的库存流水</h4>
        <WorkspaceTable title="批次流水" :show-title="false" :columns="movementColumns" :data="history.movements" :min-table-width="1000">
          <template #cell-created_at="{row}">{{ store.localTime(row.created_at) }}</template>
          <template #cell-source="{row}"><strong>{{ movementTypeLabel(row.source_type) }} #{{ row.source_id }}</strong><span class="lot-muted">明细 #{{ row.source_line_id }} · 库存流水 #{{ row.movement_id }} · {{ row.created_by_name || '操作人未记录' }}</span></template>
          <template #cell-original_allocation_id="{row}">{{ row.original_allocation_id ? `冲销分配 #${row.original_allocation_id}` : '—' }}</template>
          <template #empty>该批次暂无新制分配流水；历史期初不会被伪装为逐笔来源。</template>
        </WorkspaceTable>
        <RouterLink to="/workspace/inventory-ledger" @click="prepareLedger(history.balances[0]?.warehouse_id??warehouse,history.lot.material_id)">到正式库存台账核对物料流水</RouterLink>
      </section>
    </template>
  </section>
</template>

<style scoped>
.lot-note{padding:10px 14px;border-left:3px solid var(--workspace-field-accent);background:var(--workspace-field-disabled);line-height:1.6}
.lot-muted{color:#50667d;font-size:13px;overflow-wrap:anywhere}.lot-summary{font-size:13px;line-height:1.6}
.lot-history h3,.lot-history h4{margin-bottom:0}.lot-history a{color:var(--workspace-field-accent);text-underline-offset:3px}
:deep(td strong),:deep(td .lot-muted){display:block}:deep(td){font-variant-numeric:tabular-nums}
:global(:root[data-theme='dark'] .physical-lots-page .lot-muted){color:#9aadc5}
</style>

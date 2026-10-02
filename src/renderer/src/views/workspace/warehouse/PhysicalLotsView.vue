<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {storeToRefs} from 'pinia'
import {RouterLink} from 'vue-router'
import type {PhysicalLotRow,PhysicalLotUnallocatedMovement} from '../../../../../shared/physical-lot-api'
import {physicalLotKindLabel} from '../../../../../shared/physical-lot-api'
import {usePiniaAppStore} from '../../../store/app-store'
import {movementTypeLabel} from '../../../utils/formatters'
import AppButton from '../../../components/app/AppButton.vue'
import AppInput from '../../../components/app/AppInput.vue'
import WorkspaceSelect from '../../../components/workspace/WorkspaceSelect.vue'
import WorkspaceTable from '../../../components/workspace/WorkspaceTable.vue'
import {NDatePicker} from 'naive-ui'
import {datePickerString,vDateField} from '../../../utils/date-field'

const store=usePiniaAppStore()
const {lotOverview:overview,lotHistory:history,lotLoading:loading,lotError:failure,
  lotUnallocated:unallocated,lotWarehouseId:warehouse,lotMaterialId:material,
  warehouses,materials,busy,connectionLost,user}=storeToRefs(store)
const preparing=ref(false)
const selectedLegacy=ref<PhysicalLotRow|null>(null)
const evidenceQuantity=ref('')
const evidenceText=ref('')
const supplierLot=ref('')
const manufacturedOn=ref('')
const expiresOn=ref('')
const savedLotCode=ref('')
const reversingRecordId=ref<number|null>(null)
const reverseReason=ref('')
const selectedMovement=ref<PhysicalLotUnallocatedMovement|null>(null)
const movementLotId=ref(0)
const movementQuantity=ref('')
const movementEvidence=ref('')
const movementSupplierLot=ref('')
const movementManufacturedOn=ref('')
const movementExpiresOn=ref('')
const reversingMovementEvidenceId=ref<number|null>(null)
const movementReverseReason=ref('')
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
const evidenceColumns=[{key:'created_at',title:'时间'},{key:'warehouse_name',title:'仓库'},
  {key:'counterpart_lot_code',title:'对应批次'},{key:'quantity',title:'数量变动'},
  {key:'evidence',title:'现场核对依据与操作人'}]
const unallocatedColumns=[{key:'created_at',title:'发生时间'},{key:'source',title:'正式流水来源'},
  {key:'quantity',title:'原流水数量'},{key:'unallocated_quantity',title:'未分配数量'},
  {key:'action',title:'操作'}]
const movementEvidenceColumns=[{key:'created_at',title:'补证时间'},
  {key:'source',title:'原流水与仓库'},{key:'quantity',title:'归属数量'},
  {key:'evidence',title:'核对依据与操作人'}]
const availableMovementLots=computed(()=>overview.value?.rows.filter(row=>
  row.warehouse_id===selectedMovement.value?.warehouse_id
  && row.material_id===selectedMovement.value?.material_id && Number(row.quantity)>0)??[])
function rowRecord(value:Record<string,unknown>):PhysicalLotRow|undefined {
  return overview.value?.rows.find(row=>row.lot_id===value.lot_id && row.warehouse_id===value.warehouse_id)
}
async function openHistory(value:Record<string,unknown>):Promise<void> {
  const row=rowRecord(value)
  if(!row || disabled.value)return
  preparing.value=true
  try{await store.loadPhysicalLotHistory(row)}finally{preparing.value=false}
}
function selectLegacy(value:Record<string,unknown>):void {
  const row=rowRecord(value)
  if(!row || row.source_kind!=='legacy' || Number(row.quantity)<=0 || disabled.value)return
  selectedLegacy.value=row; evidenceQuantity.value=''; evidenceText.value='';
  supplierLot.value=''; manufacturedOn.value=''; expiresOn.value=''; savedLotCode.value=''
}
async function saveEvidence():Promise<void> {
  const row=selectedLegacy.value
  if(!row || disabled.value)return
  preparing.value=true
  try {
    const result=await store.savePhysicalLotEvidence({legacy_lot_id:row.lot_id,
      warehouse_id:row.warehouse_id,quantity:evidenceQuantity.value,evidence:evidenceText.value,
      supplier_lot:supplierLot.value.trim()||null,manufactured_on:manufacturedOn.value||null,
      expires_on:expiresOn.value||null})
    if(result){selectedLegacy.value=null;savedLotCode.value=result.verified_lot_code
      await store.loadPhysicalLotHistory({lot_id:result.verified_lot_id,material_id:row.material_id})}
  }finally{preparing.value=false}
}
function canReverseEvidence(value:Record<string,unknown>):boolean {
  return store.can('physical_lot.reclassify') && typeof value.id==='number'
    && value.original_reclassification_id===null
    && !history.value?.reclassifications.some(item=>item.original_reclassification_id===value.id)
}
async function reverseEvidence():Promise<void> {
  const recordId=reversingRecordId.value,lot=history.value?.lot
  if(!recordId || !lot || disabled.value)return
  preparing.value=true
  try {
    const result=await store.reversePhysicalLotEvidence({record_id:recordId,reason:reverseReason.value})
    if(result){reversingRecordId.value=null;reverseReason.value='';savedLotCode.value=''
      await store.loadPhysicalLotHistory({lot_id:lot.id,material_id:lot.material_id})}
  }finally{preparing.value=false}
}
function refresh():void {void store.loadPhysicalLots();void store.loadPhysicalLotUnallocated()}
function selectMovement(value:Record<string,unknown>):void {
  const row=unallocated.value?.rows.find(item=>item.movement_id===value.movement_id)
  if(!row || disabled.value)return
  selectedMovement.value=row
  movementLotId.value=Number(row.unallocated_quantity)<0
    ? (overview.value?.rows.find(lot=>lot.warehouse_id===row.warehouse_id
      && lot.material_id===row.material_id && Number(lot.quantity)>0)?.lot_id??0) : 0
  movementQuantity.value=''
  movementEvidence.value='';movementSupplierLot.value='';movementManufacturedOn.value='';movementExpiresOn.value=''
}
async function saveMovementEvidence():Promise<void> {
  const row=selectedMovement.value
  if(!row || disabled.value)return
  preparing.value=true
  try {
    const result=await store.savePhysicalLotMovementEvidence({movement_id:row.movement_id,
      lot_id:movementLotId.value||null,quantity:movementQuantity.value,evidence:movementEvidence.value,
      supplier_lot:movementLotId.value?null:movementSupplierLot.value.trim()||null,
      manufactured_on:movementLotId.value?null:movementManufacturedOn.value||null,
      expires_on:movementLotId.value?null:movementExpiresOn.value||null})
    if(result){selectedMovement.value=null;await store.loadPhysicalLotHistory({
      lot_id:result.lot_id,material_id:result.material_id})}
  }finally{preparing.value=false}
}
async function reverseMovementEvidence():Promise<void> {
  const recordId=reversingMovementEvidenceId.value,lot=history.value?.lot
  if(!recordId || !lot || disabled.value)return
  preparing.value=true
  try {
    const result=await store.reversePhysicalLotMovementEvidence({
      record_id:recordId,reason:movementReverseReason.value})
    if(result){reversingMovementEvidenceId.value=null;movementReverseReason.value=''
      await store.loadPhysicalLotHistory({lot_id:lot.id,material_id:lot.material_id})}
  }finally{preparing.value=false}
}
function canReverseMovementEvidence(value:Record<string,unknown>):boolean {
  return store.can('physical_lot.movement_evidence') && typeof value.id==='number'
    && value.original_evidence_id===null
    && !history.value?.movement_evidence.some(item=>item.original_evidence_id===value.id)
}
function prepareLedger(warehouseId:number,materialId:number):void {
  Object.assign(store.ledgerQuery,{warehouse_id:warehouseId || null,material_id:materialId,
    from_date:'',to_date:'',source_type:null})
}
watch([warehouse,material],()=>{selectedLegacy.value=null;selectedMovement.value=null;
  reversingRecordId.value=null;reversingMovementEvidenceId.value=null;savedLotCode.value='';refresh()})
watch(()=>`${user.value?.id}:${user.value?.permissions.join('|')}:${connectionLost.value}`,()=>{
  selectedLegacy.value=null;selectedMovement.value=null;reversingRecordId.value=null;
  reversingMovementEvidenceId.value=null;savedLotCode.value=''
  if(!connectionLost.value && store.can('inventory.view'))refresh()
})
onMounted(()=>{refresh()})
onUnmounted(()=>{store.clearPhysicalLotHistory();selectedLegacy.value=null;
  selectedMovement.value=null;reversingRecordId.value=null;reversingMovementEvidenceId.value=null})
</script>

<template>
  <section class="stack physical-lots-page">
    <p v-if="!store.can('inventory.view')" role="status">当前账号没有库存查看权限，请联系管理员核对授权。</p>
    <template v-else>
      <p class="lot-note">实物批次用于核对已接入单据的实物流向。历史未识别期初没有真实批号；旧版未指定批次的单据会显示差额。现场补证和旧流水逐笔补证只调整批次归属，不改变正式库存或成本。批次余额与正式库存一致也不代表所有历史流水已追溯。</p>
      <p v-if="connectionLost" role="alert">服务端连接已中断，旧批次余额与来源证据已失效；恢复后请重新读取。</p>
      <p v-if="failure" role="alert">{{ failure }} 请核对筛选范围后重试。</p>
      <p v-if="savedLotCode" role="status">已记录历史批次补证，新批次 {{ savedLotCode }}。</p>
      <WorkspaceTable title="实物批次结存" :show-title="false" :columns="lotColumns" :data="overview?.rows??[]"
        :loading="loading" :min-table-width="1000">
        <template #filters>
          <label>仓库<WorkspaceSelect v-model="warehouse" :disabled="disabled" :options="[{value:0,label:'全部仓库'},...warehouses.map(row=>({value:row.id,label:`${row.code} · ${row.name}`}))]" /></label>
          <label>物料<WorkspaceSelect v-model="material" :disabled="disabled" :options="[{value:0,label:'全部物料'},...materials.map(row=>({value:row.id,label:`${row.sku} · ${row.name}`}))]" /></label>
          <AppButton type="button" :disabled="disabled" @click="refresh">刷新批次</AppButton>
        </template>
        <template #beforeTable>
          <p v-if="overview" role="status" class="lot-summary">读取时间：{{ store.localTime(overview.as_of) }}。{{ overview.fully_allocated ? '当前筛选范围无数量差额。' : `当前有 ${overview.differences.length} 个仓库与物料组合存在未分配差额。` }}</p>
        </template>
        <template #cell-warehouse="{row}"><strong>{{ row.warehouse_name }}</strong></template>
        <template #cell-material="{row}"><strong>{{ row.sku }}</strong><span class="lot-muted">{{ row.material_name }} · {{ row.unit }}</span></template>
        <template #cell-lot="{row}"><strong>{{ row.lot_code }}</strong><span class="lot-muted">{{ physicalLotKindLabel(row.source_kind) }} · 供应商批号 {{ row.supplier_lot || '未提供' }}</span></template>
        <template #cell-quantity="{row}">{{ row.quantity }}</template>
        <template #cell-actions="{row}"><AppButton type="button" :disabled="disabled" @click="openHistory(row)">批次流水</AppButton><AppButton v-if="store.can('physical_lot.reclassify') && row.source_kind==='legacy' && Number(row.quantity)>0" type="button" :disabled="disabled" @click="selectLegacy(row)">现场补证</AppButton></template>
        <template #empty>{{ loading ? '正在读取批次…' : failure ? '读取失败，请刷新重试。' : connectionLost ? '连接中断，旧结果已失效。' : '当前范围没有批次结存；请核对筛选条件与正式库存差额。' }}</template>
      </WorkspaceTable>
      <form v-if="selectedLegacy" class="stack lot-evidence" aria-label="历史批次现场补证" @submit.prevent="saveEvidence">
        <h3>{{ selectedLegacy.sku }} · {{ selectedLegacy.warehouse_name }} · 历史批次补证</h3>
        <p class="lot-note">当前未识别结存 {{ selectedLegacy.quantity }} {{ selectedLegacy.unit }}。请只录入已现场核对的数量和依据；系统会保留原历史期初及本次转归记录。</p>
        <label>核对数量 <AppInput v-model="evidenceQuantity" required inputmode="decimal" placeholder="最多三位小数" :disabled="disabled" /></label>
        <label>现场核对依据 <AppInput v-model="evidenceText" type="textarea" required minlength="10" maxlength="500" rows="3" placeholder="填写核对人、时间、实物标签或签字记录" :disabled="disabled" /></label>
        <label>供应商批号（可选） <AppInput v-model="supplierLot" maxlength="100" :disabled="disabled" /></label>
        <label>生产日期（可选） <NDatePicker v-date-field="{min:'2000-01-01',max:'2099-12-31'}" to="body" type="date" format="yyyy-MM-dd" value-format="yyyy-MM-dd" :formatted-value="manufacturedOn||null" :disabled="disabled" @update:formatted-value="value=>manufacturedOn=datePickerString(value)" /></label>
        <label>失效日期（可选） <NDatePicker v-date-field="{min:'2000-01-01',max:'2099-12-31'}" to="body" type="date" format="yyyy-MM-dd" value-format="yyyy-MM-dd" :formatted-value="expiresOn||null" :disabled="disabled" @update:formatted-value="value=>expiresOn=datePickerString(value)" /></label>
        <div class="lot-evidence-actions"><AppButton type="submit" :disabled="disabled">确认补证</AppButton><AppButton type="button" :disabled="disabled" @click="selectedLegacy=null">取消</AppButton></div>
      </form>
      <section v-if="overview?.differences.length" aria-label="批次未分配差额" class="stack">
        <h3>未分配差额</h3>
        <p class="lot-note">差额表示正式库存流水尚未分配到实物批次，不能当作可追踪库存。请先核对来源单据和历史期初。</p>
        <WorkspaceTable title="未分配差额" :show-title="false" :columns="differenceColumns" :data="overview.differences" :min-table-width="850">
          <template #cell-difference="{row}"><strong>{{ row.difference }}</strong></template>
        </WorkspaceTable>
      </section>
      <section v-if="unallocated" aria-label="待补证的旧客户端流水" class="stack">
        <h3>待补证的旧客户端流水</h3>
        <p class="lot-note">只列出升级检查点 #{{ unallocated.checkpoint_movement_id }} 之后尚未完整归属批次的流水。逐笔依据须来自实物或交接记录，不能仅凭单据推测批号。每次补证会缩小当前库存差额。</p>
        <p v-if="unallocated.has_more" role="status">当前只显示最近 100 笔，请按仓库或物料缩小范围。</p>
        <WorkspaceTable title="待补证流水" :show-title="false" :columns="unallocatedColumns"
          :data="unallocated.rows" :min-table-width="900">
          <template #cell-created_at="{row}">{{ store.localTime(row.created_at) }}</template>
          <template #cell-source="{row}"><strong>{{ movementTypeLabel(row.source_type) }} #{{ row.source_id }}</strong><span class="lot-muted">明细 #{{ row.source_line_id }} · 流水 #{{ row.movement_id }}</span></template>
          <template #cell-action="{row}"><AppButton v-if="store.can('physical_lot.movement_evidence')" type="button" :disabled="disabled" @click="selectMovement(row)">逐笔补证</AppButton></template>
          <template #empty>当前筛选范围没有可补证的未分配流水。</template>
        </WorkspaceTable>
      </section>
      <form v-if="selectedMovement" class="stack lot-evidence" aria-label="旧流水逐笔补证" @submit.prevent="saveMovementEvidence">
        <h3>库存流水 #{{ selectedMovement.movement_id }} · 逐笔补证</h3>
        <p class="lot-note">原流水 {{ selectedMovement.quantity }}，尚未分配 {{ selectedMovement.unallocated_quantity }}。出库只能选择本仓现存批次；入库可建立新批次或归入已有批次。</p>
        <label>实物批次 <WorkspaceSelect v-model="movementLotId" :disabled="disabled"
          :options="[...(Number(selectedMovement.unallocated_quantity)>0?[{value:0,label:'新建实物批次'}]:[]),...availableMovementLots.map(row=>({value:row.lot_id,label:`${row.lot_code} · 现存 ${row.quantity}`}))]" /></label>
        <label>核对数量 <AppInput v-model="movementQuantity" required inputmode="decimal" placeholder="正数，最多三位小数" :disabled="disabled" /></label>
        <label>逐笔核对依据 <AppInput v-model="movementEvidence" type="textarea" required minlength="10" maxlength="500" rows="3" placeholder="写明原流水对应的实物、交接或签收证据" :disabled="disabled" /></label>
        <template v-if="!movementLotId && Number(selectedMovement.unallocated_quantity)>0">
          <label>供应商批号（可选） <AppInput v-model="movementSupplierLot" maxlength="100" :disabled="disabled" /></label>
          <label>生产日期（可选） <NDatePicker v-date-field="{min:'2000-01-01',max:'2099-12-31'}" to="body" type="date" format="yyyy-MM-dd" value-format="yyyy-MM-dd" :formatted-value="movementManufacturedOn||null" :disabled="disabled" @update:formatted-value="value=>movementManufacturedOn=datePickerString(value)" /></label>
          <label>失效日期（可选） <NDatePicker v-date-field="{min:'2000-01-01',max:'2099-12-31'}" to="body" type="date" format="yyyy-MM-dd" value-format="yyyy-MM-dd" :formatted-value="movementExpiresOn||null" :disabled="disabled" @update:formatted-value="value=>movementExpiresOn=datePickerString(value)" /></label>
        </template>
        <p v-if="Number(selectedMovement.unallocated_quantity)<0 && !availableMovementLots.length" class="lot-muted">本仓暂无可选择的正余额批次，请先核对历史期初与来源。</p>
        <div class="lot-evidence-actions"><AppButton type="submit" :disabled="disabled || (Number(selectedMovement.unallocated_quantity)<0 && !movementLotId)">确认逐笔补证</AppButton><AppButton type="button" :disabled="disabled" @click="selectedMovement=null">取消</AppButton></div>
      </form>
      <section v-if="history" aria-label="实物批次来源历史" class="stack lot-history">
        <h3>{{ history.lot.sku }} · {{ history.lot.code }} · 来源历史</h3>
        <p class="lot-muted">{{ physicalLotKindLabel(history.lot.source_kind) }}；供应商批号 {{ history.lot.supplier_lot || '未提供' }}；生产日期 {{ history.lot.manufactured_on || '未提供' }}；失效日期 {{ history.lot.expires_on || '未提供' }}。</p>
        <p v-if="history.lot.origin_movement_id">首次来源库存流水 #{{ history.lot.origin_movement_id }}。</p>
        <p v-for="opening in history.openings" :key="opening.id" class="lot-note">{{ opening.warehouse_name }} 历史未识别期初 {{ opening.quantity }} {{ history.lot.unit }}；升级检查点流水 #{{ opening.checkpoint_movement_id }}。{{ opening.evidence }}</p>
        <p v-if="!history.openings.length && !history.movements.length && !history.reclassifications.length && !history.movement_evidence.length" class="lot-muted">该批次尚无期初或分配流水。</p>
        <h4>逐仓现存</h4>
        <p v-for="balance in history.balances" :key="balance.warehouse_id">{{ balance.warehouse_name }}：{{ balance.quantity }} {{ history.lot.unit }}</p>
        <h4>已归属的库存流水</h4>
        <WorkspaceTable title="批次流水" :show-title="false" :columns="movementColumns" :data="history.movements" :min-table-width="1000">
          <template #cell-created_at="{row}">{{ store.localTime(row.created_at) }}</template>
          <template #cell-source="{row}"><strong>{{ movementTypeLabel(row.source_type) }} #{{ row.source_id }}</strong><span class="lot-muted">明细 #{{ row.source_line_id }} · 库存流水 #{{ row.movement_id }} · {{ row.created_by_name || '操作人未记录' }}</span></template>
          <template #cell-original_allocation_id="{row}">{{ row.original_allocation_id ? `冲销分配 #${row.original_allocation_id}` : '—' }}</template>
          <template #empty>该批次暂无新制分配流水；历史期初不会被伪装为逐笔来源。</template>
        </WorkspaceTable>
        <h4>旧流水逐笔补证</h4>
        <WorkspaceTable title="逐笔补证记录" :show-title="false" :columns="movementEvidenceColumns" :data="history.movement_evidence" :min-table-width="900">
          <template #cell-created_at="{row}">{{ store.localTime(row.created_at) }}</template>
          <template #cell-source="{row}"><strong>{{ movementTypeLabel(row.source_type) }} #{{ row.source_id }}</strong><span class="lot-muted">{{ row.warehouse_name }} · 明细 #{{ row.source_line_id }} · 流水 #{{ row.movement_id }}</span></template>
          <template #cell-evidence="{row}">{{ row.evidence }} · {{ row.created_by_name }}
            <span v-if="row.original_evidence_id" class="lot-muted">冲销原补证 #{{ row.original_evidence_id }}</span>
            <AppButton v-else-if="canReverseMovementEvidence(row)" type="button" :disabled="disabled" @click="reversingMovementEvidenceId=row.id">冲销逐笔补证</AppButton>
          </template>
          <template #empty>该批次没有旧流水逐笔补证记录。</template>
        </WorkspaceTable>
        <form v-if="reversingMovementEvidenceId" class="stack lot-evidence" aria-label="冲销旧流水逐笔补证" @submit.prevent="reverseMovementEvidence">
          <h4>冲销逐笔补证 #{{ reversingMovementEvidenceId }}</h4>
          <label>冲销原因 <AppInput v-model="movementReverseReason" type="textarea" required minlength="10" maxlength="500" rows="3" :disabled="disabled" /></label>
          <div class="lot-evidence-actions"><AppButton type="submit" :disabled="disabled">确认冲销</AppButton><AppButton type="button" :disabled="disabled" @click="reversingMovementEvidenceId=null">取消</AppButton></div>
        </form>
        <h4>现场补证记录</h4>
        <WorkspaceTable title="现场补证记录" :show-title="false" :columns="evidenceColumns" :data="history.reclassifications" :min-table-width="850">
          <template #cell-created_at="{row}">{{ store.localTime(row.created_at) }}</template>
          <template #cell-evidence="{row}">{{ row.evidence }} · {{ row.created_by_name }}
            <span v-if="row.original_reclassification_id" class="lot-muted">冲销原补证 #{{ row.original_reclassification_id }}</span>
            <AppButton v-else-if="canReverseEvidence(row)" type="button" :disabled="disabled" @click="reversingRecordId=row.id">冲销补证</AppButton>
          </template>
          <template #empty>该批次没有现场补证记录。</template>
        </WorkspaceTable>
        <form v-if="reversingRecordId" class="stack lot-evidence" aria-label="冲销现场补证" @submit.prevent="reverseEvidence">
          <h4>冲销补证 #{{ reversingRecordId }}</h4>
          <p class="lot-note">仅当补证批次仍有足量结存时可冲销；原记录会保留。</p>
          <label>冲销原因 <AppInput v-model="reverseReason" type="textarea" required minlength="10" maxlength="500" rows="3" :disabled="disabled" /></label>
          <div class="lot-evidence-actions"><AppButton type="submit" :disabled="disabled">确认冲销</AppButton><AppButton type="button" :disabled="disabled" @click="reversingRecordId=null">取消</AppButton></div>
        </form>
        <RouterLink to="/workspace/inventory-ledger" @click="prepareLedger(history.balances[0]?.warehouse_id??warehouse,history.lot.material_id)">到正式库存台账核对物料流水</RouterLink>
      </section>
    </template>
  </section>
</template>

<style scoped>
.lot-note{padding:10px 14px;border-left:3px solid var(--workspace-field-accent);background:var(--workspace-field-disabled);line-height:1.6}
.lot-muted{color:#50667d;font-size:13px;overflow-wrap:anywhere}.lot-summary{font-size:13px;line-height:1.6}
.lot-history h3,.lot-history h4{margin-bottom:0}.lot-history a{color:var(--workspace-field-accent);text-underline-offset:3px}
.lot-evidence{padding:16px;border:1px solid var(--workspace-field-accent);border-radius:8px}.lot-evidence label{display:grid;gap:6px}.lot-evidence-actions{display:flex;gap:8px}
:deep(td strong),:deep(td .lot-muted){display:block}:deep(td){font-variant-numeric:tabular-nums}
:global(:root[data-theme='dark'] .physical-lots-page .lot-muted){color:#9aadc5}
</style>

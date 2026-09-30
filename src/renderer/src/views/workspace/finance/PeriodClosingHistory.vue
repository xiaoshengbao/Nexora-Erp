<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { PeriodClosingRecord } from '../../../../../shared/erp-api'
import WorkspaceTable from '../../../components/workspace/WorkspaceTable.vue'
import { usePiniaAppStore } from '../../../store/app-store'
import { financialSource, localTime } from '../../../utils/formatters'

const { periodClosingHistory: records } = storeToRefs(usePiniaAppStore())
const selected = ref<PeriodClosingRecord | null>(null)
const evidence = computed(() => selected.value && 'ledger' in selected.value.evidence ? selected.value.evidence : null)
const columns = [ { key: 'id', title: '记录号' }, { key: 'action', title: '操作' },
  { key: 'period_version', title: '期间版本' }, { key: 'created_at', title: '时间' },
  { key: 'created_by_name', title: '操作者' }, { key: 'reason', title: '依据 / 原因' }, { key: 'actions', title: '证据' } ]
const balanceColumns = [ { key: 'code', title: '科目编码' }, { key: 'name', title: '名称' },
  { key: 'opening_debit', title: '期初借方' }, { key: 'opening_credit', title: '期初贷方' },
  { key: 'debit', title: '本期借方' }, { key: 'credit', title: '本期贷方' },
  { key: 'closing_debit', title: '期末借方' }, { key: 'closing_credit', title: '期末贷方' } ]
const inventoryColumns = [ { key: 'sku', title: '物料编码' }, { key: 'name', title: '名称' },
  { key: 'quantity', title: '期末数量' }, { key: 'amount', title: '金额（元）' }, { key: 'average_unit_cost', title: '平均单价' } ]
const movementColumns = [ { key: 'id', title: '流水号' }, { key: 'created_at', title: '时间（UTC）' },
  { key: 'material_id', title: '物料号' }, { key: 'source_type', title: '来源类型' },
  { key: 'source_id', title: '来源单号' }, { key: 'quantity', title: '数量' }, { key: 'amount', title: '金额（元）' } ]
const businessColumns = [ { key: 'kind', title: '往来类别' }, { key: 'party_name', title: '往来单位' },
  { key: 'source', title: '来源' }, { key: 'order_id', title: '订单号' }, { key: 'sku', title: '物料' },
  { key: 'amount', title: '金额（元）' }, { key: 'posted_at', title: '确认时间（UTC）' } ]
const paymentColumns = [ { key: 'id', title: '记录号' }, { key: 'kind', title: '往来类别' },
  { key: 'order_id', title: '订单号' }, { key: 'action', title: '操作' }, { key: 'amount', title: '金额（元）' },
  { key: 'reference', title: '依据' }, { key: 'reverses_id', title: '冲销原记录' }, { key: 'created_by', title: '操作者编号' } ]
const movementNames: Record<string, string> = { receipt: '采购入库', receipt_reversal: '采购入库冲销',
  purchase_return: '采购退货', purchase_return_reversal: '采购退货冲销', shipment: '销售出库', shipment_reversal: '销售出库冲销',
  sales_return: '销售退货', sales_return_reversal: '销售退货冲销', other_inbound: '其他入库', other_inbound_reversal: '其他入库冲销',
  other_outbound: '其他出库', other_outbound_reversal: '其他出库冲销', transfer_in: '调拨入库', transfer_out: '调拨出库',
  transfer_reversal_in: '调拨冲销入库', transfer_reversal_out: '调拨冲销出库', stocktake: '盘点', stocktake_reversal: '盘点冲销',
  adjustment: '库存调整', adjustment_reversal: '库存调整冲销', material_issue: '生产领料', material_return: '生产退料',
  production_completion: '生产完工', production_completion_reversal: '生产完工冲销' }
</script>

<template>
  <div class="stack period-closing-history">
    <WorkspaceTable title="结账与重开记录" :columns="columns" :data="records" :min-table-width="900">
      <template #cell-action="{ row }">{{ row.action === 'close' ? '结账' : '重开' }}</template>
      <template #cell-created_at="{ row }">{{ localTime(row.created_at) }}</template>
      <template #cell-actions="{ row }"><button v-if="row.action === 'close'" class="text-button" @click="selected = row">查看余额快照</button><span v-else class="muted">保留原结账</span></template>
      <template #empty>暂无结账记录。结账后保存余额、来源与操作者，不覆盖原记录。</template>
    </WorkspaceTable>
    <template v-if="evidence">
      <p>结账记录 {{ selected?.id }} · {{ evidence.period.start_date }} 至 {{ evidence.period.end_date }} · 保存于 {{ localTime(selected?.created_at ?? '') }}</p>
      <p class="muted">这是当次结账保存的证据。重开或后续业务不会覆盖它；金额按人民币，业务时间按 UTC。{{ evidence.opening_balance_id ? `正式期初来源：期初-${evidence.opening_balance_id}` : '当次没有正式期初来源。' }}</p>
      <WorkspaceTable title="总账余额快照（元）" :columns="balanceColumns" :data="evidence.ledger.rows" :min-table-width="920" />
      <WorkspaceTable title="库存余额快照" :columns="inventoryColumns" :data="evidence.inventory.materials" :min-table-width="760" />
      <WorkspaceTable title="库存金额来源" :columns="movementColumns" :data="evidence.inventory.movements" :min-table-width="960"><template #cell-source_type="{ row }">{{ movementNames[row.source_type] ?? '库存流水' }}</template></WorkspaceTable>
      <p>业务应收来源净额 {{ evidence.business_sources.receivable_amount }} 元；应付来源净额 {{ evidence.business_sources.payable_amount }} 元；无价来源 {{ evidence.business_sources.unpriced_count }} 笔。收付款记录 {{ evidence.payments.length }} 笔，已过账凭证 {{ evidence.posted_journal_ids.length }} 张。</p>
      <details><summary>往来、收付款与凭证来源明细</summary><div class="stack">
        <WorkspaceTable title="往来来源快照" :columns="businessColumns" :data="evidence.business_sources.entries" :min-table-width="940">
          <template #cell-kind="{ row }">{{ row.kind === 'receivable' ? '应收' : '应付' }}</template>
          <template #cell-source="{ row }">{{ financialSource(row) }}</template>
          <template #cell-amount="{ row }">{{ row.amount ?? '待核价' }}</template>
        </WorkspaceTable>
        <WorkspaceTable title="收付款记录快照" :columns="paymentColumns" :data="evidence.payments" :min-table-width="940">
          <template #cell-kind="{ row }">{{ row.kind === 'receivable' ? '应收' : '应付' }}</template>
          <template #cell-action="{ row }">{{ row.action === 'settlement' ? '收付款' : row.action === 'refund' ? '退款' : '冲销' }}</template>
        </WorkspaceTable>
        <p>已过账凭证编号：{{ evidence.posted_journal_ids.length ? evidence.posted_journal_ids.join('、') : '无' }}</p>
      </div></details>
    </template>
  </div>
</template>

<style scoped>
/* 展开证据后由弹窗承接纵向滚动，避免浏览器把聚焦行滚进 vxe 隐藏视口并裁掉表头。 */
.period-closing-history :deep(.vxe-table--viewport-wrapper) { overflow: clip; }
</style>

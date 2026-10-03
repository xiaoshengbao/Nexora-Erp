<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { NCheckbox, NModal } from 'naive-ui'
import AppButton from '../../../components/app/AppButton.vue'
import AppInput from '../../../components/app/AppInput.vue'
import WorkspaceSelect from '../../../components/workspace/WorkspaceSelect.vue'
import WorkspaceTable from '../../../components/workspace/WorkspaceTable.vue'
import { submitCreateDialog } from '../../../utils/create-dialog'
import { usePiniaAppStore } from '../../../store/app-store'
import type { BankAccount } from '../../../../../shared/erp-api'

const store = usePiniaAppStore()
const { bankBalanceOverview, bankBalancePreview, bankBindingForm, bankBalanceForm,
  bankLedgerMatchForm, bankLedgerReverseReasons, bankReportDecisionReasons,
  user, busy, error, notice, connectionLost } = storeToRefs(store)
const { can, localTime, bindBankLedgerAccount, previewBankBalance, matchBankLedger,
  reverseBankLedgerMatch, createBankBalanceReport, decideBankBalanceReport } = store
const bindingOpen = ref(false)
const accountOptions = computed(() => (bankBalanceOverview.value?.accounts ?? [])
  .filter(item => item.ledger_account_id !== null)
  .map(item => ({ value: item.id, label: `${item.code} · ${item.name}` })))
const availableLedger = computed(() => (bankBalanceOverview.value?.ledger_accounts ?? [])
  .filter(item => !(bankBalanceOverview.value?.accounts ?? []).some(account =>
    account.id !== bankBindingForm.value.accountId && account.ledger_account_id === item.id))
  .map(item => ({ value: item.id, label: `${item.code} · ${item.name}` })))
const selectedAccount = computed(() => bankBalanceOverview.value?.accounts.find(
  item => item.id === bankBalanceForm.value.account_id))
const bankColumns = [{ key: 'selected', title: '选择', width: '90' }, { key: 'document', title: '银行已入账、企业未入账' }]
const bookColumns = [{ key: 'selected', title: '选择', width: '90' }, { key: 'document', title: '企业已入账、银行未入账' }]
const historyColumns = [{ key: 'document', title: '勾对与撤销证据' }, { key: 'actions', title: '操作', width: '280' }]
const reportColumns = [{ key: 'document', title: '余额调节表' }, { key: 'actions', title: '独立复核', width: '310' }]
const bindingColumns = [{ key: 'document', title: '科目绑定变更' }]

watch(() => [bankBalanceForm.value.account_id, bankBalanceForm.value.as_of_date,
  bankBalanceForm.value.declared_bank_closing], () => { bankBalancePreview.value = null }, { flush: 'sync' })
watch(() => bankBalanceForm.value.account_id, accountId => {
  bankLedgerMatchForm.value = { account_id: accountId, bank_line_ids: [], journal_line_ids: [], reason: '' }
}, { flush: 'sync' })
watch(connectionLost, lost => { if (lost) { bindingOpen.value = false; bankBalancePreview.value = null } })

function beginBinding(account: BankAccount): void {
  bankBindingForm.value = { accountId: account.id, ledger_account_id: account.ledger_account_id ?? 0,
    opening_balance: account.opening_balance ?? '', effective_date: account.effective_date ?? bankBalanceOverview.value?.opening_effective_date ?? '',
    version: account.version, reason: '' }
  bindingOpen.value = true
}
function toggle(ids: number[], id: number, checked: boolean): void {
  const position = ids.indexOf(id)
  if (checked && position < 0) ids.push(id)
  if (!checked && position >= 0) ids.splice(position, 1)
}
async function submitBinding(): Promise<void> {
  if (connectionLost.value || !can('bank_reconciliation.account')) return
  await submitCreateDialog(bindBankLedgerAccount, { busy, error, notice }, bindingOpen)
}
async function submitMatch(): Promise<void> {
  if (connectionLost.value || !can('bank_reconciliation.match')
    || !bankLedgerMatchForm.value.bank_line_ids.length || !bankLedgerMatchForm.value.journal_line_ids.length) return
  await matchBankLedger()
}
async function submitReport(): Promise<void> {
  if (connectionLost.value || !can('bank_reconciliation.reconcile') || !bankBalancePreview.value) return
  await createBankBalanceReport()
}
const statusLabel = (status: string): string => ({ draft: '待复核', approved: '已复核',
  rejected: '已驳回', superseded: '已由新表取代' })[status as 'draft' | 'approved' | 'rejected' | 'superseded'] ?? status
</script>

<template>
  <section class="stack">
    <div class="section-heading">
      <div><p class="eyebrow">BANK BALANCE</p><h2>银行余额调节</h2></div>
    </div>
    <p class="muted">按人民币核对银行对账单与已确认期初、已过账总账。先绑定银行账户和资产类借方科目，再勾对两侧明细；未达项会分别调节两侧余额。文件和期初凭据仍需人工核实。</p>

    <NModal v-if="can('bank_reconciliation.account')" v-model:show="bindingOpen" preset="card"
      :mask-closable="!busy" :style="{ width: 'min(720px, calc(100vw - 32px))' }">
      <h2>绑定银行账户与总账科目</h2>
      <p class="muted">银行期初余额须与该科目已确认的总账期初相符，启用日也须一致。期初存在未达项时应先核实并完成启用前调整；有总账勾对或调节表后不能修改绑定。</p>
      <form @submit.prevent="submitBinding">
        <div class="form-grid">
          <label>资产类借方科目<WorkspaceSelect v-model="bankBindingForm.ledger_account_id" required :options="availableLedger" /></label>
          <label>银行期初余额<AppInput v-model.trim="bankBindingForm.opening_balance" required placeholder="例如 125.00" /></label>
          <label>总账启用日<AppInput v-model.trim="bankBindingForm.effective_date" required maxlength="10" placeholder="YYYY-MM-DD" /></label>
          <label>绑定依据<AppInput v-model.trim="bankBindingForm.reason" required maxlength="200" /></label>
        </div>
        <AppButton type="submit" variant="primary" :disabled="busy || connectionLost">保存绑定</AppButton>
      </form>
    </NModal>

    <WorkspaceTable title="银行账户与总账科目" :columns="[{ key: 'document', title: '账户与绑定' }, { key: 'actions', title: '操作', width: '170' }]"
      :data="bankBalanceOverview?.accounts ?? []" :min-table-width="750">
      <template #cell-document="{ row: item }">
        <strong>{{ item.code }} · {{ item.name }}</strong>
        <p class="muted" v-if="item.ledger_account_id">总账科目 #{{ item.ledger_account_id }} · 银行期初 ¥{{ item.opening_balance }} · 启用日 {{ item.effective_date }} · 版本 {{ item.version }}</p>
        <p class="muted" v-else>尚未绑定；须先完成总账正式期初确认。</p>
      </template>
      <template #cell-actions="{ row: item }">
        <AppButton v-if="can('bank_reconciliation.account')" type="button" :disabled="busy || connectionLost" @click="beginBinding(item)">{{ item.ledger_account_id ? '核对绑定' : '设置绑定' }}</AppButton>
      </template>
    </WorkspaceTable>

    <div class="section-heading"><div><h3>编制调节表</h3></div></div>
    <div class="form-grid">
      <label>银行账户<WorkspaceSelect v-model="bankBalanceForm.account_id" required :options="accountOptions" /></label>
      <label>调节截止日<AppInput v-model.trim="bankBalanceForm.as_of_date" required maxlength="10" placeholder="YYYY-MM-DD" /></label>
      <label>银行对账单期末余额<AppInput v-model.trim="bankBalanceForm.declared_bank_closing" required placeholder="按银行原始凭据填写" /></label>
    </div>
    <AppButton type="button" variant="primary" :disabled="busy || connectionLost || !can('bank_reconciliation.view') || !selectedAccount?.ledger_account_id"
      @click="previewBankBalance">计算调节预览</AppButton>

    <template v-if="bankBalancePreview">
      <div class="form-grid">
        <div>银行期初 ¥{{ bankBalancePreview.bank_opening }} → 流水净额 ¥{{ bankBalancePreview.bank_movements }} → 系统期末 ¥{{ bankBalancePreview.bank_closing_computed }}</div>
        <div>银行凭据期末 ¥{{ bankBalancePreview.bank_closing_declared }} · {{ bankBalancePreview.bank_statement_balanced ? '与流水相符' : '与流水不符' }}</div>
        <div>总账期初 ¥{{ bankBalancePreview.book_opening }} → 已过账净额 ¥{{ bankBalancePreview.book_movements }} → 账面期末 ¥{{ bankBalancePreview.book_closing }}</div>
        <div>调整后银行 ¥{{ bankBalancePreview.adjusted_bank }} · 调整后账面 ¥{{ bankBalancePreview.adjusted_book }}</div>
      </div>
      <p :class="bankBalancePreview.balanced ? 'muted' : ''">{{ bankBalancePreview.balanced ? '两侧调节相符，可留存草稿并交由其他账号复核。' : '余额尚未调节相符；可留存草稿记录差异，但不能复核通过。' }}</p>
      <p class="muted">来源指纹：{{ bankBalancePreview.fingerprint }}</p>

      <WorkspaceTable title="银行已入账、企业未入账" :columns="bankColumns" :data="bankBalancePreview.bank_unmatched" :min-table-width="680">
        <template #cell-selected="{ row: item }">
          <NCheckbox v-if="can('bank_reconciliation.match')" :checked="bankLedgerMatchForm.bank_line_ids.includes(item.id)"
            :disabled="busy || connectionLost" @update:checked="(checked: boolean) => toggle(bankLedgerMatchForm.bank_line_ids, item.id, checked)" />
        </template>
        <template #cell-document="{ row: item }">
          <strong>#{{ item.id }} · {{ item.occurred_on }} · ¥{{ item.amount }}</strong>
          <p class="muted">交易号 {{ item.transaction_id }} · {{ item.counterparty }}</p>
        </template>
      </WorkspaceTable>
      <WorkspaceTable title="企业已入账、银行未入账" :columns="bookColumns" :data="bankBalancePreview.book_unmatched" :min-table-width="680">
        <template #cell-selected="{ row: item }">
          <NCheckbox v-if="can('bank_reconciliation.match')" :checked="bankLedgerMatchForm.journal_line_ids.includes(item.id)"
            :disabled="busy || connectionLost" @update:checked="(checked: boolean) => toggle(bankLedgerMatchForm.journal_line_ids, item.id, checked)" />
        </template>
        <template #cell-document="{ row: item }">
          <strong>分录 #{{ item.id }} · {{ item.journal_date }} · ¥{{ item.amount }}</strong>
          <p class="muted">凭证 #{{ item.journal_id }} · {{ item.reference }} · {{ item.summary }}</p>
        </template>
      </WorkspaceTable>
      <form v-if="can('bank_reconciliation.match')" @submit.prevent="submitMatch">
        <label>勾对依据<AppInput v-model.trim="bankLedgerMatchForm.reason" required maxlength="200" placeholder="可多选同方向明细，两侧合计必须一致" /></label>
        <AppButton type="submit" :disabled="busy || connectionLost || !bankLedgerMatchForm.bank_line_ids.length || !bankLedgerMatchForm.journal_line_ids.length">勾对所选明细</AppButton>
      </form>
      <form v-if="can('bank_reconciliation.reconcile')" @submit.prevent="submitReport">
        <label>编制依据<AppInput v-model.trim="bankBalanceForm.reason" required maxlength="200" placeholder="填写对账单与总账核对依据" /></label>
        <AppButton type="submit" variant="primary" :disabled="busy || connectionLost">留存调节草稿</AppButton>
      </form>
    </template>

    <WorkspaceTable title="勾对与撤销历史" :columns="historyColumns" :data="bankBalanceOverview?.matches ?? []" :min-table-width="850">
      <template #cell-document="{ row: item }">
        <strong>#{{ item.id }} · {{ item.amount }} 元 · {{ item.reversal ? '已撤销' : '有效' }}</strong>
        <p class="muted">银行流水 {{ item.members.filter((entry: { side: string }) => entry.side === 'bank').map((entry: { source_id: number }) => `#${entry.source_id}`).join('、') }} ↔ 总账分录 {{ item.members.filter((entry: { side: string }) => entry.side === 'book').map((entry: { source_id: number }) => `#${entry.source_id}`).join('、') }}</p>
        <p class="muted">{{ localTime(item.created_at) }} · {{ item.created_by_name }} · {{ item.reason }}<span v-if="item.reversal"> · 撤销：{{ item.reversal.reason }}</span></p>
      </template>
      <template #cell-actions="{ row: item }">
        <form v-if="!item.reversal && can('bank_reconciliation.reverse')" @submit.prevent="reverseBankLedgerMatch(item.id)">
          <AppInput v-model.trim="bankLedgerReverseReasons[item.id]" required maxlength="200" placeholder="撤销原因" />
          <AppButton type="submit" :disabled="busy || connectionLost">撤销勾对</AppButton>
        </form>
      </template>
    </WorkspaceTable>

    <WorkspaceTable title="余额调节表与复核记录" :columns="reportColumns" :data="bankBalanceOverview?.reports ?? []" :min-table-width="950">
      <template #cell-document="{ row: item }">
        <strong>#{{ item.id }} · {{ item.as_of_date }} · {{ statusLabel(item.status) }}<span v-if="item.stale"> · 来源已变化</span></strong>
        <p class="muted">账户 #{{ item.account_id }} · 调整后银行 ¥{{ item.snapshot.adjusted_bank }} / 账面 ¥{{ item.snapshot.adjusted_book }} · {{ item.snapshot.balanced ? '编制时相符' : '编制时不符' }}</p>
        <p class="muted">{{ localTime(item.created_at) }} · 编制 {{ item.created_by_name }} · {{ item.reason }} · 指纹 {{ item.fingerprint }}</p>
        <p v-for="decision in item.decisions" :key="decision.id" class="muted">{{ localTime(decision.created_at) }} · {{ decision.created_by_name }} · {{ statusLabel(decision.action === 'approve' ? 'approved' : decision.action === 'reject' ? 'rejected' : 'superseded') }} · {{ decision.reason }}</p>
      </template>
      <template #cell-actions="{ row: item }">
        <form v-if="item.status === 'draft' && can('bank_reconciliation.review') && user?.id !== item.created_by" @submit.prevent>
          <AppInput v-model.trim="bankReportDecisionReasons[item.id]" required maxlength="200" placeholder="复核或驳回依据" />
          <AppButton type="button" :disabled="busy || connectionLost || item.stale || !item.snapshot.balanced || !bankReportDecisionReasons[item.id]?.trim()"
            @click="decideBankBalanceReport(item.id, 'approve')">复核通过</AppButton>
          <AppButton type="button" :disabled="busy || connectionLost || !bankReportDecisionReasons[item.id]?.trim()"
            @click="decideBankBalanceReport(item.id, 'reject')">驳回</AppButton>
        </form>
      </template>
    </WorkspaceTable>

    <WorkspaceTable title="账户绑定审计" :columns="bindingColumns" :data="bankBalanceOverview?.account_changes ?? []" :min-table-width="750">
      <template #cell-document="{ row: item }">
        <strong>账户 #{{ item.account_id }} · {{ localTime(item.created_at) }} · {{ item.changed_by_name }}</strong>
        <p class="muted">依据：{{ item.reason }}</p>
      </template>
    </WorkspaceTable>
  </section>
</template>

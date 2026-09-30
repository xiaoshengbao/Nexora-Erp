<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { StatementOptions, StatementPolicy, StatementGroup } from '../../../../../shared/erp-api'
import { usePiniaAppStore } from '../../../store/app-store'
import AppButton from '../../../components/app/AppButton.vue'
import AppInput from '../../../components/app/AppInput.vue'
import WorkspaceSelect from '../../../components/workspace/WorkspaceSelect.vue'
import WorkspaceTable from '../../../components/workspace/WorkspaceTable.vue'
import { compatibleStatementGroups, manualTransferIds, statementGroups, statementPolicyProblems } from './statement-display'

const props = defineProps<{ options: StatementOptions }>()
const emit = defineEmits<{ close: [] }>()
const store = usePiniaAppStore()
const { busy, connectionLost, statementLoading: loading } = storeToRefs(store)
const { can, saveStatementPolicy } = store
const policy = ref<StatementPolicy>({ ...props.options.policy,
  lines: props.options.policy.lines.map(item => ({ ...item })),
  allocations: props.options.policy.allocations.map(item => ({ ...item })),
  manual_transfer_ids: [...props.options.policy.manual_transfer_ids] })
const reason = ref('')
const manual = ref(policy.value.manual_transfer_ids.join('、'))
const groups = Object.entries(statementGroups).map(([value, label]) => ({ value: value as StatementGroup, label }))
const problems = computed(() => [...statementPolicyProblems(policy.value, props.options.accounts),
  ...(manualTransferIds(manual.value) === null ? ['手工结转须填写不重复的正整数凭证编号，用逗号或空格分隔。'] : [])])
const accountColumns = [{ key: 'code', title: '科目编码', width: '110' }, { key: 'name', title: '科目名称', width: '230' },
  { key: 'category', title: '类别', width: '160' }, { key: 'assignment', title: '报表项目', width: '330' }]
function assigned(id: number): string { return policy.value.allocations.find(item => item.account_id === id)?.line_code ?? '' }
function assign(id: number, code: string): void {
  policy.value.allocations = policy.value.allocations.filter(item => item.account_id !== id)
  if (code) policy.value.allocations.push({ account_id: id, line_code: code })
}
function removeLine(index: number): void {
  const [line] = policy.value.lines.splice(index, 1)
  // 删除项目是显式操作，取消对应分配后由用户重新安排，不保留悬空引用。
  policy.value.allocations = policy.value.allocations.filter(item => item.line_code !== line.code)
}
async function save(): Promise<void> {
  const ids = manualTransferIds(manual.value)
  if (ids === null || problems.value.length || busy.value || loading.value) return
  if (await saveStatementPolicy({ ...policy.value, manual_transfer_ids: ids, reason: reason.value })) emit('close')
}
</script>

<template>
  <form class="statement-policy-editor" @submit.prevent="save">
    <p>按公司确定的项目分配科目。同一科目只能归属一个项目；成本须明确选择在制资产或损益费用。保存时保留配置前后范围及依据。</p>
    <fieldset :disabled="busy || loading || connectionLost || !can('financial_statement.configure')">
      <legend>报表项目</legend>
      <div v-for="(line, index) in policy.lines" :key="index" class="statement-line-editor">
        <label>项目编码<AppInput v-model="line.code" required maxlength="32" pattern="[A-Z][A-Z0-9_]{0,31}" :readonly="policy.allocations.some(item => item.line_code === line.code)" /></label>
        <label>项目名称<AppInput v-model="line.name" required maxlength="80" /></label>
        <label>所属分组<WorkspaceSelect v-model="line.group" required :options="groups" :disabled="busy || loading || connectionLost" /></label>
        <AppButton type="button" variant="text" @click="removeLine(index)" :aria-label="`删除项目 ${line.name || index + 1}`">删除项目</AppButton>
      </div>
      <AppButton type="button" variant="secondary" :disabled="policy.lines.length >= 1000" @click="policy.lines.push({ code: '', name: '', group: 'asset' })">添加项目</AppButton>
      <p class="muted">项目编码分配科目后锁定；要更换编码，请删除项目再重新分配科目。</p>
      <WorkspaceTable title="科目分配" :columns="accountColumns" :data="options.accounts" :min-table-width="830">
        <template #cell-name="{ row }">{{ row.name }}{{ row.is_active ? '' : '（停用）' }}</template>
        <template #cell-category="{ row }">{{ row.category === 'cost' ? '成本（明确归类）' : statementGroups[row.category === 'income' ? 'revenue' : row.category] }}</template>
        <template #cell-assignment="{ row }"><WorkspaceSelect :model-value="assigned(row.id)" :aria-label="`${row.code} ${row.name}报表项目`" :disabled="busy || loading || connectionLost" :options="[{ value: '', label: '暂不映射' }, ...policy.lines.filter(line => line.code && compatibleStatementGroups(row).includes(line.group)).map(line => ({ value: line.code, label: `${line.code} · ${line.name}` }))]" @update:model-value="value => assign(row.id, value)" /></template>
        <template #empty>尚无科目，请先在总账科目中维护。</template>
      </WorkspaceTable>
      <label>手工结转凭证编号（可留空）<AppInput v-model="manual" placeholder="例如 12、15，对应记-12、记-15" /></label>
      <p class="muted">只登记已核对的已过账原始手工结转，系统结转自动识别。含资产、负债或业务来源的混合凭证不能登记；服务器会核对凭证分录。</p>
      <label>配置依据<AppInput v-model="reason" required maxlength="500" placeholder="说明项目、科目范围或手工结转调整依据" /></label>
    </fieldset>
    <ul v-if="problems.length" role="status"><li v-for="problem in problems" :key="problem">{{ problem }}</li></ul>
    <div class="statement-actions"><AppButton type="submit" variant="primary" :disabled="busy || loading || connectionLost || !reason.trim() || problems.length > 0 || !can('financial_statement.configure')">保存配置</AppButton><AppButton type="button" variant="secondary" :disabled="busy" @click="emit('close')">取消编辑</AppButton></div>
  </form>
</template>

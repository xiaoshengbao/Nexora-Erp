<script setup lang="ts">
import { computed } from 'vue'
import type { AuxiliaryKind, AuxiliaryItem, AuxiliaryPolicy, AuxiliaryReference } from '../../../../../shared/erp-api'
import WorkspaceSelect from '../../../components/workspace/WorkspaceSelect.vue'
import { auxiliaryKinds, auxiliaryLabels, replaceAuxiliary } from './auxiliary-display'

const props = withDefaults(defineProps<{
  modelValue?: AuxiliaryReference[]; items?: AuxiliaryItem[]; policy?: AuxiliaryPolicy; date?: string
  disabled?: boolean; labelPrefix?: string; kinds?: AuxiliaryKind[]
}>(), { items: () => [], date: '', disabled: false, labelPrefix: '分录', kinds: () => [...auxiliaryKinds] })
const emit = defineEmits<{ 'update:modelValue': [values: AuxiliaryReference[]] }>()
const requiredKinds = computed(() => props.policy && props.date >= props.policy.start_date ? props.policy.required_kinds : [])
const selected = (kind: AuxiliaryKind) => props.modelValue?.find(item => item.kind === kind)?.id ?? 0
function options(kind: AuxiliaryKind) {
  const values = props.items.filter(item => item.kind === kind).map(item => ({ value: item.id,
    label: `${item.code} · ${item.name}${item.is_active ? '' : '（已停用）'}`, disabled: !item.is_active }))
  const value = selected(kind)
  if (value && !values.some(item => item.value === value)) values.push({ value, label: `#${value}（不可用，请重新选择）`, disabled: true })
  return [{ value: 0, label: requiredKinds.value.includes(kind) ? '请选择（必填）' : '未分配', disabled: requiredKinds.value.includes(kind) }, ...values]
}
</script>

<template>
  <div class="auxiliary-selector">
    <label v-for="kind in kinds" :key="kind">
      <span>{{ auxiliaryLabels[kind] }}{{ requiredKinds.includes(kind) ? '（必填）' : '' }}</span>
      <WorkspaceSelect :model-value="selected(kind)" :options="options(kind)" :disabled="disabled"
        :required="requiredKinds.includes(kind)" :aria-label="`${labelPrefix}${auxiliaryLabels[kind]}`" size="small"
        @update:model-value="value => emit('update:modelValue', replaceAuxiliary(modelValue, kind, value))" />
    </label>
  </div>
</template>

<style scoped>
.auxiliary-selector { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; min-width: 240px; }
.auxiliary-selector label { display: grid; gap: 4px; min-width: 0; }
.auxiliary-selector label > span { font-size: 12px; }
</style>

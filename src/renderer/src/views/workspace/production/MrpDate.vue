<script setup lang="ts">
import { NDatePicker } from 'naive-ui'
import type { Directive } from 'vue'
import { dateOutsideRange, datePickerString, vDateField } from '../../../utils/date-field'
defineProps<{ modelValue: string; min?: string; disabled?: boolean; ariaLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
// 表格日期没有外部 label，给实际输入元素补上来源名称。
const vMrpDateLabel: Directive<HTMLElement, string | undefined> = {
  mounted(element, binding) { if (binding.value) element.querySelector('input')?.setAttribute('aria-label', binding.value) }
}
</script>
<template>
  <NDatePicker to="body" :formatted-value="modelValue || null" type="date" format="yyyy-MM-dd" value-format="yyyy-MM-dd"
    v-date-field="{ required: true, min }" :is-date-disabled="(timestamp: number) => dateOutsideRange(timestamp, min, undefined)"
    :disabled="disabled" v-mrp-date-label="ariaLabel" @update:formatted-value="value => emit('update:modelValue', datePickerString(value))" />
</template>

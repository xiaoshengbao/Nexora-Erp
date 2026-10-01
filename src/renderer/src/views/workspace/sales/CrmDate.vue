<script setup lang="ts">
import { NDatePicker } from 'naive-ui'
import { dateOutsideRange, datePickerString, vDateField } from '../../../utils/date-field'
defineProps<{modelValue: string; disabled?: boolean}>()
const emit=defineEmits<{'update:modelValue':[value:string]}>()
</script>
<template>
  <NDatePicker to="body" :formatted-value="modelValue || null" type="date" format="yyyy-MM-dd" value-format="yyyy-MM-dd"
    v-date-field="{required:true,min:'1900-01-01',max:'2199-12-31'}" :disabled="disabled"
    :is-date-disabled="(timestamp: number)=>dateOutsideRange(timestamp,'1900-01-01','2199-12-31')"
    @update:formatted-value="value=>emit('update:modelValue',datePickerString(value))" />
</template>

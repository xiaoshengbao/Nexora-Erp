import type { Directive } from 'vue'

export interface DateFieldConstraints {
  required?: boolean
  min?: string
  max?: string
}

// 单日选择保持后端的 yyyy-MM-dd 字符串协议；清空筛选恢复空字符串，不传时间戳。
export function datePickerString(value: string | [string, string] | null): string {
  return typeof value === 'string' ? value : ''
}

function localDateString(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// 日历时间戳按本地日期比较，不能用 UTC 的 toISOString，否则部分时区会偏移一天。
export function dateOutsideRange(timestamp: number, min?: string, max?: string): boolean {
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return true
  const value = localDateString(timestamp)
  return Boolean((min && value < min) || (max && value > max))
}

export function dateFieldError(value: string, constraints: DateFieldConstraints): string {
  if (!value) return constraints.required ? '请选择日期。' : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '请按 YYYY-MM-DD 填写日期。'
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setHours(0, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  if (year === 0) return '请填写有效日期。'
  if (localDateString(date.getTime()) !== value) return '请填写有效日期。'
  if (constraints.min && value < constraints.min) return `日期不能早于 ${constraints.min}。`
  if (constraints.max && value > constraints.max) return `日期不能晚于 ${constraints.max}。`
  return ''
}

interface DateFieldBinding {
  input: HTMLInputElement
  constraints: DateFieldConstraints
  validate: () => void
}
const fields = new WeakMap<HTMLElement, DateFieldBinding>()

// NDatePicker 直接在页面使用；指令只补回原生 required 与范围校验，不另封装日期组件。
export const vDateField: Directive<HTMLElement, DateFieldConstraints> = {
  mounted(element, binding) {
    const input = element.querySelector<HTMLInputElement>('input')
    if (!input) return
    const field: DateFieldBinding = {
      input,
      constraints: binding.value,
      validate: () => {
        input.required = Boolean(field.constraints.required)
        input.setAttribute('aria-required', String(input.required))
        input.setCustomValidity(dateFieldError(input.value, field.constraints))
      }
    }
    fields.set(element, field)
    for (const event of ['input', 'change', 'blur']) input.addEventListener(event, field.validate)
    field.validate()
  },
  updated(element, binding) {
    const field = fields.get(element)
    if (!field) return
    field.constraints = binding.value
    field.validate()
  },
  beforeUnmount(element) {
    const field = fields.get(element)
    if (!field) return
    for (const event of ['input', 'change', 'blur'])
      field.input.removeEventListener(event, field.validate)
    fields.delete(element)
  }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dateFieldError, dateOutsideRange, datePickerString, vDateField } from '../src/renderer/src/utils/date-field.ts'

test('日期保持后端字符串格式，清空日期不会把 null 写入旧表单', () => {
  assert.equal(datePickerString('2026-10-01'), '2026-10-01')
  assert.equal(datePickerString(null), '')
  assert.equal(datePickerString(['2026-10-01', '2026-10-02']), '')
})

// 使用本地日历日期，覆盖 UTC 日期在部分时区与本地相差一天的情况。
test('日期上下限包含当天，固定启用日只接受那一天', () => {
  const day = new Date(2026, 9, 1).getTime()
  assert.equal(dateOutsideRange(day, '2026-10-01', '2026-10-01'), false)
  assert.equal(dateOutsideRange(new Date(2026, 8, 30).getTime(), '2026-10-01'), true)
  assert.equal(dateOutsideRange(new Date(2026, 9, 2).getTime(), undefined, '2026-10-01'), true)
  assert.equal(dateOutsideRange(day), false)
  assert.equal(dateOutsideRange(NaN), true)
  assert.equal(dateOutsideRange(Number.MAX_VALUE), true)
})

test('必填、手输非法日期与超出边界保留真实表单校验', () => {
  assert.match(dateFieldError('', { required: true }), /请选择/)
  assert.equal(dateFieldError('', {}), '')
  assert.equal(dateFieldError('2024-02-29', { required: true }), '')
  assert.equal(dateFieldError('0001-01-01', {}), '')
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-1', '0000-01-01']) {
    assert.notEqual(dateFieldError(value, {}), '', value)
  }
  assert.match(dateFieldError('2026-09-30', { min: '2026-10-01' }), /不能早于/)
  assert.match(dateFieldError('2026-10-02', { max: '2026-10-01' }), /不能晚于/)
  assert.equal(dateFieldError('2026-10-01', { min: '2026-10-01', max: '2026-10-01' }), '')
})

test('日期指令在输入与范围更新后刷新校验，卸载时释放监听', () => {
  const listeners = new Map()
  const input = {
    value: '', required: false, error: '',
    setAttribute() {}, setCustomValidity(error) { this.error = error },
    addEventListener(event, handler) { listeners.set(event, handler) },
    removeEventListener(event, handler) { assert.equal(listeners.get(event), handler); listeners.delete(event) }
  }
  const element = { querySelector() { return input } }
  vDateField.mounted(element, { value: { required: true } })
  assert.equal(input.required, true)
  assert.match(input.error, /请选择/)
  input.value = '2026-10-01'; listeners.get('input')()
  assert.equal(input.error, '')
  vDateField.updated(element, { value: { required: true, min: '2026-10-02' } })
  assert.match(input.error, /不能早于/)
  input.value = ''; vDateField.updated(element, { value: { required: false } })
  assert.equal(input.required, false); assert.equal(input.error, '')
  vDateField.beforeUnmount(element)
  assert.equal(listeners.size, 0)
})

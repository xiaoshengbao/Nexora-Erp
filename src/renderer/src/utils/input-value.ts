export interface InputModifiers {
  trim?: boolean
  number?: boolean
}

// 金额和数量按原业务模型保留字符串；编号/端口或 .number 才转换为数字，空值不能变成 0。
export function normalizeInputValue(
  value: string,
  current: string | number | null | undefined,
  modifiers: InputModifiers = {}
): string | number {
  const text = modifiers.trim ? value.trim() : value
  if ((typeof current === 'number' || modifiers.number) && text !== '') {
    const number = Number(text)
    if (Number.isFinite(number)) return number
  }
  return text
}

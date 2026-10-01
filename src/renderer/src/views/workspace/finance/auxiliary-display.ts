import type { AuxiliaryKind, AuxiliaryReference, AuxiliarySnapshot } from '../../../../../shared/erp-api'

export const auxiliaryLabels: Record<AuxiliaryKind, string> = {
  customer: '客户', supplier: '供应商', department: '部门', project: '项目'
}
export const auxiliaryKinds: AuxiliaryKind[] = ['customer', 'supplier', 'department', 'project']
export function auxiliaryText(values?: readonly AuxiliarySnapshot[]): string {
  return values?.length ? values.map(item => `${auxiliaryLabels[item.kind]}：${item.code} · ${item.name}`).join('；') : '未分配'
}
export function replaceAuxiliary(values: readonly AuxiliaryReference[] | undefined, kind: AuxiliaryKind, id: number): AuxiliaryReference[] {
  const result = (values ?? []).filter(item => item.kind !== kind).map(({ kind, id }) => ({ kind, id }))
  if (Number.isSafeInteger(id) && id > 0) result.push({ kind, id })
  return result.sort((a, b) => a.kind.localeCompare(b.kind))
}

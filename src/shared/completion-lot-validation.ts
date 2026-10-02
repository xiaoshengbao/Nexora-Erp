import type {CompletionLotPartInput} from './completion-lot-api'
import {completionLotDate,completionLotMilli} from './completion-lot-api.ts'

// 完工确认只转发实物数量和日期，不接受渲染层指定内部批号或库存来源。
export function completionLotBody(value: unknown): {lots: CompletionLotPartInput[]} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('完工实物批次无效')
  const lots = (value as Record<string, unknown>).lots
  if (!Array.isArray(lots) || lots.length < 1 || lots.length > 20) throw Error('完工实物批次数量无效')
  return {lots: lots.map(part => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) throw Error('完工实物批次记录无效')
    const record = part as Record<string, unknown>
    if (typeof record.quantity !== 'string' || completionLotMilli(record.quantity) === null)
      throw Error('完工实物批次数量无效')
    const manufactured = record.manufactured_on
    const expires = record.expires_on
    if (manufactured !== null && (typeof manufactured !== 'string' || !completionLotDate(manufactured)))
      throw Error('生产日期无效')
    if (expires !== null && (typeof expires !== 'string' || !completionLotDate(expires)))
      throw Error('失效日期无效')
    if (typeof manufactured === 'string' && typeof expires === 'string' && expires < manufactured)
      throw Error('失效日期不能早于生产日期')
    return {quantity: record.quantity, manufactured_on: manufactured, expires_on: expires}
  })}
}

export function validatePostedCompletionLots(value: unknown, completionId: number,
                                             requested: CompletionLotPartInput[]): void {
  const invalid = () => { throw Error('服务端未固定本次合格完工的实物批次，请核对服务端版本和批次差额。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const entry = value as Record<string, unknown>
  if (entry.id !== completionId || entry.status !== 'posted' || !Array.isArray(entry.physical_lots)
      || entry.physical_lots.length !== requested.length) return invalid()
  for (let index = 0; index < requested.length; index++) {
    const returned = entry.physical_lots[index]
    if (!returned || typeof returned !== 'object' || Array.isArray(returned)) return invalid()
    const lot = returned as Record<string, unknown>
    if (typeof lot.id !== 'number' || !Number.isSafeInteger(lot.id) || lot.id <= 0
        || lot.code !== `P${completionId}-P${index + 1}`
        || typeof lot.quantity !== 'string'
        || completionLotMilli(lot.quantity) !== completionLotMilli(requested[index].quantity)
        || lot.manufactured_on !== requested[index].manufactured_on
        || lot.expires_on !== requested[index].expires_on) return invalid()
  }
}

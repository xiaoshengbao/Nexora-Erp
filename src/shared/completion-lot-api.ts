import {receiptLotDate,receiptLotMilli} from './receipt-lot-api.ts'

export interface CompletionLotPartInput {
  quantity: string
  manufactured_on: string | null
  expires_on: string | null
}

export interface CompletionPhysicalLot extends CompletionLotPartInput {
  id: number
  code: string
}

export {receiptLotDate as completionLotDate,receiptLotMilli as completionLotMilli}

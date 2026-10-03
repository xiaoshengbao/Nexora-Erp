import type { AppLocale } from '../utils/locale-preference'
import { englishCopy } from './en-US'

// 只翻译显式调用的界面文案，未知业务文案保留原文；参数不会再次被当作文案翻译。
export function translateCopy(locale: AppLocale, source: string, parameters: Record<string, string | number> = {}): string {
  const copy = locale === 'en-US' ? englishCopy[source] ?? source : source
  return copy.replace(/\{(\w+)\}/g, (placeholder: string, key: string) =>
    Object.prototype.hasOwnProperty.call(parameters, key) ? String(parameters[key]) : placeholder)
}

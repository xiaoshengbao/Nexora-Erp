export type AppLocale = 'zh-CN' | 'en-US'
export const LOCALE_STORAGE_KEY = 'nexora-locale'
type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>

// 旧版本没有语言设置；缺失、损坏或无法读取时继续使用中文。
export function readLocalePreference(storage: LocaleStorage | undefined): AppLocale {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US'
}

// 保存失败只影响下次启动，不阻止当前窗口切换语言。
export function saveLocalePreference(storage: LocaleStorage | undefined, locale: AppLocale): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // 本地存储被禁用时保留当前会话偏好。
  }
}

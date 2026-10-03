import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { isAppLocale, readLocalePreference, saveLocalePreference } from '../utils/locale-preference'
import { translateCopy } from '../i18n/common-copy'

function availableStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

// 公共入口和根级抽屉共用一个状态，语言偏好不随退出登录被清空。
export const useSettingsStore = defineStore('settings', () => {
  const settingsOpen = ref(false)
  const locale = ref(readLocalePreference(availableStorage()))
  const isEnglish = computed(() => locale.value === 'en-US')
  const t = (source: string, parameters?: Record<string, string | number>): string =>
    translateCopy(locale.value, source, parameters)
  const openSettings = (): void => { settingsOpen.value = true }
  const closeSettings = (): void => { settingsOpen.value = false }
  function setLocale(value: unknown): void {
    // 控件与存储边界都只接受明确支持的语言，禁止未知值进入根语言容器。
    if (isAppLocale(value)) locale.value = value
  }
  watch(locale, (value) => {
    if (typeof document !== 'undefined') document.documentElement.lang = value
    saveLocalePreference(availableStorage(), value)
  }, { immediate: true })
  return { settingsOpen, locale, isEnglish, t, openSettings, closeSettings, setLocale }
})

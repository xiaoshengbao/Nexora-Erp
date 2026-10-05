import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { isThemeColor, readThemeColor, saveThemeColor, themeColorPalette, themeColorVariables } from '../utils/theme-color'
import { readThemePreference, saveThemePreference } from '../utils/theme-preference'
import type { ThemeMode } from '../utils/theme-preference'
import { createThemeTransition, themeToggleOrigin, waitForThemePaint } from '../utils/theme-transition'

function availableStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

// 主题作为独立 Pinia store，根组件与账号区读取同一份设置。
export const useThemeStore = defineStore('theme', () => {
  const themeMode = ref<ThemeMode>(readThemePreference(availableStorage()))
  const isDarkTheme = computed(() => themeMode.value === 'dark')
  const themeColor = ref(readThemeColor(availableStorage()))
  const colorPalette = computed(() => themeColorPalette(themeColor.value, isDarkTheme.value))

  // 颜色和明暗模式独立保存，切换颜色不重建页面或触发全屏明暗动画。
  function setThemeColor(value: unknown): void {
    if (isThemeColor(value)) themeColor.value = value
  }

  function setDarkTheme(enabled: boolean): void {
    themeMode.value = enabled ? 'dark' : 'light'
  }

  // 动画只负责主题切换时的画面快照，持久化和根节点配色继续由本 store 维护。
  const motion = createThemeTransition({
    isDark: () => isDarkTheme.value,
    setDark: setDarkTheme,
    flush: nextTick,
    environment: () => typeof document === 'undefined' ? undefined : {
      width: window.innerWidth,
      height: window.innerHeight,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      root: document.documentElement,
      // 快照退出后再跨过一次绘制，保证真实页面与完整的新快照平稳交接。
      settle: waitForThemePaint,
      start: typeof document.startViewTransition === 'function'
        ? (update) => document.startViewTransition(update) : undefined
    }
  })
  function toggleTheme(event: MouseEvent): void {
    // Naive UI 转发事件时 currentTarget 可能是包装节点；点击 SVG 也回溯到实际按钮。
    const target = event.target instanceof Element ? event.target.closest('button.theme-toggle')
      : event.currentTarget instanceof Element ? event.currentTarget.closest('button.theme-toggle') : null
    const origin = target instanceof HTMLElement ? themeToggleOrigin(event, target.getBoundingClientRect()) : undefined
    void motion.toggle(origin).catch((error: unknown) => console.error('切换主题失败', error))
  }
  function selectTheme(mode: ThemeMode, event: MouseEvent): void {
    // 设置卡片传入明确目标；点击文字、图标或键盘操作都从卡片内部展开。
    const target = event.target instanceof Element ? event.target.closest('button') : null
    const origin = target instanceof HTMLElement ? themeToggleOrigin(event, target.getBoundingClientRect()) : undefined
    void motion.select(mode === 'dark', origin).catch((error: unknown) => console.error('选择主题失败', error))
  }
  onScopeDispose(motion.dispose)

  watch([themeMode, themeColor], ([mode, color]) => {
    // 主题切换同步更新根节点与本地偏好，设置存储不可用时仍保留当前视觉状态。
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = mode
      document.documentElement.style.colorScheme = mode
      document.documentElement.dataset.themeColor = color
      for (const [key, value] of Object.entries(themeColorVariables(colorPalette.value))) {
        document.documentElement.style.setProperty(key, value)
      }
    }
    saveThemePreference(availableStorage(), mode)
    saveThemeColor(availableStorage(), color)
  }, { immediate: true })

  return { themeMode, themeColor, colorPalette, setThemeColor, isDarkTheme, setDarkTheme, toggleTheme, selectTheme }
})

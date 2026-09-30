import type { GlobalThemeOverrides } from 'naive-ui'

type SelectThemeOverrides = NonNullable<GlobalThemeOverrides['Select']>

export type WorkspaceSelectValue = string | number | boolean | null
export interface WorkspaceSelectOption<T extends WorkspaceSelectValue = WorkspaceSelectValue> {
  label: string
  value: T
  disabled?: boolean
}

// 菜单内部使用带类型的键，避免数字编号、同名字符串、布尔值及“全部”的 null 互相混淆。
export function workspaceSelectKey(value: WorkspaceSelectValue): string {
  return JSON.stringify([typeof value, value])
}

export function resolveWorkspaceSelection<T extends WorkspaceSelectValue>(
  options: readonly WorkspaceSelectOption<T>[],
  key: unknown,
  disabled = false
): WorkspaceSelectOption<T> | undefined {
  if (disabled || typeof key !== 'string') return undefined
  return options.find((option) => !option.disabled && workspaceSelectKey(option.value) === key)
}

// 必填校验按可选项判断，0 可以是“全部仓库”，也可以是不可提交的占位项。
export function hasWorkspaceSelection<T extends WorkspaceSelectValue>(
  options: readonly WorkspaceSelectOption<T>[],
  value: T
): boolean {
  return options.some((option) => !option.disabled && Object.is(option.value, value))
}

// 通过 Naive UI 的主题接口同时设置触发框与传送到 body 的菜单，避免弹窗内样式被裁切或失配。
export function workspaceSelectTheme(dark: boolean): SelectThemeOverrides {
  const border = dark ? '#425570' : '#d4dce6'
  const accent = dark ? '#78d6cd' : '#237d7a'
  const surface = dark ? '#101c30' : '#ffffff'
  return {
    menuBoxShadow: dark ? '0 12px 32px rgba(0, 0, 0, .32)' : '0 12px 32px rgba(23, 33, 59, .14)',
    peers: {
      InternalSelection: {
        heightMedium: '40px',
        heightSmall: '34px',
        borderRadius: '8px',
        fontSizeMedium: '13px',
        fontSizeSmall: '13px',
        color: surface,
        colorActive: surface,
        colorDisabled: dark ? '#182638' : '#f3f6f9',
        textColor: dark ? '#eef5ff' : '#17213b',
        textColorDisabled: dark ? '#8496ae' : '#8d9bab',
        placeholderColor: dark ? '#9cb0c7' : '#718399',
        arrowColor: dark ? '#9cb0c7' : '#718399',
        border: `1px solid ${border}`,
        borderHover: `1px solid ${accent}`,
        borderActive: `1px solid ${accent}`,
        borderFocus: `1px solid ${accent}`,
        boxShadowActive: '0 0 0 2px rgba(81, 183, 180, .16)',
        boxShadowFocus: '0 0 0 2px rgba(81, 183, 180, .16)',
        paddingSingle: '0 11px'
      },
      InternalSelectMenu: {
        color: dark ? '#16253a' : '#ffffff',
        borderRadius: '10px',
        optionFontSizeMedium: '13px',
        optionFontSizeSmall: '13px',
        optionHeightMedium: '36px',
        optionHeightSmall: '32px',
        optionTextColor: dark ? '#e4edf8' : '#24394f',
        optionTextColorActive: accent,
        optionCheckColor: accent,
        optionColorPending: dark ? '#23374e' : '#f0f5f8',
        optionColorActive: dark ? '#203e49' : '#e5f4f2',
        optionColorActivePending: dark ? '#294b54' : '#d8eeeb',
        paddingMedium: '6px',
        paddingSmall: '6px',
        height: '280px'
      }
    }
  }
}

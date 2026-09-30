import type { GlobalThemeOverrides } from 'naive-ui'

// 日期与文本输入共享主题接口，真正的输入元素只保留文本，不重复绘制边框。
const inputTheme: NonNullable<GlobalThemeOverrides['Input']> = {
  heightMedium: 'var(--app-field-height)',
  fontSizeMedium: 'var(--app-field-font-size)',
  borderRadius: '8px',
  color: 'var(--workspace-field-background)',
  colorFocus: 'var(--workspace-field-background)',
  colorDisabled: 'var(--workspace-field-disabled)',
  textColor: 'var(--workspace-field-text)',
  textColorDisabled: 'var(--workspace-field-muted)',
  placeholderColor: 'var(--workspace-field-muted)',
  border: '1px solid var(--workspace-field-border)',
  borderDisabled: '1px solid var(--workspace-field-border)',
  borderHover: '1px solid var(--workspace-field-accent)',
  borderFocus: '1px solid var(--workspace-field-accent)',
  boxShadowFocus: '0 0 0 2px rgba(81, 183, 180, .16)'
}

export const naiveThemeOverrides: GlobalThemeOverrides = {
  common: { primaryColor: '#237d7a', primaryColorHover: '#1d6c69', primaryColorPressed: '#195d5a' },
  Input: inputTheme,
  // 页面直接使用 NDatePicker，日历面板仍由 Naive UI 提供中文和键盘交互。
  DatePicker: { panelBorderRadius: '10px', peers: { Input: inputTheme } }
}

import type { GlobalThemeOverrides } from 'naive-ui'
import type { ThemeColorPalette } from './theme-color'

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
  boxShadowFocus: '0 0 0 2px var(--app-accent-ring)'
}

export const naiveThemeOverrides: GlobalThemeOverrides = {
  common: { primaryColor: '#237d7a', primaryColorHover: '#1d6c69', primaryColorPressed: '#195d5a' },
  Input: inputTheme,
  // 折叠标题、箭头与分隔线沿用输入控件配色，避免目录在明暗主题里出现两套颜色。
  Collapse: {
    titleFontSize: '13px',
    titleFontWeight: '600',
    titleTextColor: 'var(--workspace-field-text)',
    textColor: 'var(--workspace-field-text)',
    arrowColor: 'var(--workspace-field-muted)',
    dividerColor: 'var(--workspace-field-border)',
    titlePadding: '12px 0'
  },
  // 页面直接使用 NDatePicker，日历面板仍由 Naive UI 提供中文和键盘交互。
  DatePicker: { panelBorderRadius: '10px', peers: { Input: inputTheme } }
}

// Naive UI 会解析主色生成日历、开关等控件状态，因此传入实际色值而非 CSS 变量。
export function appThemeOverrides(palette: ThemeColorPalette): GlobalThemeOverrides {
  return { ...naiveThemeOverrides, common: { primaryColor: palette.accent, primaryColorHover: palette.accentHover, primaryColorPressed: palette.accentPressed } }
}

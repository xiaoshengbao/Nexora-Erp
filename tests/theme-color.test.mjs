import assert from 'node:assert/strict'
import { test } from 'node:test'
import { themeColorPresets, isThemeColor, readThemeColor, saveThemeColor, themeColorPalette, themeColorVariables } from '../src/renderer/src/utils/theme-color.ts'
import { appThemeOverrides } from '../src/renderer/src/utils/app-theme.ts'
import { workspaceSelectTheme } from '../src/renderer/src/utils/workspace-select.ts'

test('固定预设支持独立存取，损坏或被阻止的偏好回退默认青绿', () => {
  assert.equal(new Set(themeColorPresets.map(preset => preset.key)).size, 6)
  for (const value of [null, '', 'invalid', '#ff0000', 'url(test)', {}, undefined]) {
    assert.equal(isThemeColor(value), false)
    assert.equal(readThemeColor({ getItem: () => value }), 'teal')
  }
  assert.equal(readThemeColor(), 'teal')
  assert.equal(readThemeColor({ getItem() { throw new Error('blocked') } }), 'teal')
  assert.doesNotThrow(() => saveThemeColor({ setItem() { throw new Error('blocked') } }, 'blue'))
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  for (const preset of themeColorPresets) {
    saveThemeColor(storage, preset.key)
    assert.equal(readThemeColor(storage), preset.key)
    assert.equal(values.size, 1)
  }
})

// 对真实色值计算 WCAG 对比度，避免预设切换后按钮白字或强调文字不可读。
function luminance(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}
test('全部预设适配两种模式，按钮状态和导航文字保持可读且菜单同步配色', () => {
  for (const preset of themeColorPresets) for (const dark of [false, true]) {
    const palette = themeColorPalette(preset.key, dark), variables = themeColorVariables(palette)
    for (const state of ['primary', 'hover', 'pressed'])
      assert.ok(contrast(palette[state], '#ffffff') >= 4.5, `${preset.key}/${state}`)
    for (const surface of [palette.tint, palette.activeTint, dark ? '#16253a' : '#ffffff'])
      assert.ok(contrast(palette.accent, surface) >= 4.5, `${preset.key}/${dark}/${surface}`)
    assert.equal(variables['--workspace-field-accent'], palette.accent)
    assert.equal(variables['--app-button-primary'], preset.primary)
    assert.equal(appThemeOverrides(palette).common.primaryColor, palette.accent)
    const peers = workspaceSelectTheme(dark, palette).peers
    assert.equal(peers.InternalSelection.borderFocus, `1px solid ${palette.accent}`)
    assert.equal(peers.InternalSelectMenu.optionCheckColor, palette.accent)
    assert.equal(peers.InternalSelectMenu.optionColorActive, palette.tint)
  }
})

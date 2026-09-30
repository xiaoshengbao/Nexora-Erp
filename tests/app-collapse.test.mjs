import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSSRApp, h } from 'vue'
import { NCollapse } from 'naive-ui'
import { setup as setupSsrStyles } from '@css-render/vue3-ssr'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

test('折叠默认收起，展开内容具有独立读屏关联与普通按钮语义', async t => {
  const server = await createServer({ configFile: false, plugins: [vue()],
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  t.after(() => server.close())
  const { default: AppCollapseItem } = await server.ssrLoadModule('/src/renderer/src/components/app/AppCollapseItem.vue')
  const render = async (expanded, disabled = false) => {
    const app = createSSRApp({ render: () => h(NCollapse, { defaultExpandedNames: expanded }, () => [
      h(AppCollapseItem, { name: 'finance', title: '财务管理', disabled }, () =>
        h(NCollapse, { defaultExpandedNames: ['journals'] }, () =>
          h(AppCollapseItem, { name: 'journals', title: '凭证' }, () => h('input', { value: '未保存名称' }))))
    ]) })
    setupSsrStyles(app)
    return renderToString(app)
  }
  // 首次展开前延迟创建内容，隐藏目录不会产生可聚焦输入框。
  const collapsed = await render([])
  assert.doesNotMatch(collapsed, /<input\b/)
  assert.match(collapsed, /aria-expanded="false"/)
  const expanded = await render(['finance'])
  assert.match(expanded, /value="未保存名称"/)
  const buttons = [...expanded.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
  assert.equal(buttons.length, 2)
  assert.match(buttons[0], /aria-expanded="true"/)
  assert.match(buttons[1], /aria-expanded="true"/)
  const ids = buttons.map(button => button.match(/aria-controls="([^"]+)"/)[1])
  assert.notEqual(ids[0], ids[1])
  for (const [index, button] of buttons.entries()) {
    assert.match(button, /type="button"/)
    assert.ok(expanded.includes(`id="${ids[index]}"`))
  }
  assert.match(expanded, /role="region" aria-label="财务管理"/)
  assert.equal((expanded.match(/aria-expanded="true"/g) ?? []).length, 2)
  // 禁用目录不能通过标题按钮切换，避免鼠标或键盘绕过只读状态。
  const disabled = await render([], true)
  assert.match(disabled.match(/<button\b[^>]*>/)[0], /\sdisabled(?:\s|>)/)
})

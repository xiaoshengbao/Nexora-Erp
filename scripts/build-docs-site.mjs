import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve, dirname, posix } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Marked } from 'marked'
import { sandboxMarkup } from '../docs/site/sandbox-ui.mjs'

export const repository = 'https://github.com/zhangzzj2003/Nexora-Erp'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const languages = {
  'zh-CN': { other: 'en', readme: 'README.md', guide: 'docs/development.zh-CN.md',
    features: '项目功能', progress: '开发进度', docs: '开发文档', skip: '跳到正文', contents: '本页目录', source: '查看 Markdown',
    title: '每一步业务，<br><span>彼此相连。</span>', subtitle: '联光 ERP · 面向企业内部的桌面 ERP',
    intro: '采购、库存、销售与生产，连接到同一套可追溯的业务记录。', scope: '当前处于单公司、多仓库、在线局域网内部试用阶段。',
    button: '阅读开发文档', code: '查看源码', home: '项目介绍', lang: 'EN',
    flows: [['采购', 'PURCHASE', '申请与订单'], ['库存', 'INVENTORY', '收发与台账'], ['生产', 'PRODUCTION', '工单与成本'], ['销售', 'SALES', '出库与退货']],
    pillars: [['业务闭环', '分批收发与来源追溯'], ['财务基础', '科目、期间与变更审计'], ['持续开发', '手工凭证已合并，自动凭证待补']], footer: '内部试用 · 单公司 · 在线局域网', download: '下载 Markdown' },
  en: { other: 'zh-CN', readme: 'README.en.md', guide: 'docs/development.en.md',
    features: 'Features', progress: 'Progress', docs: 'Development guide', skip: 'Skip to content', contents: 'On this page', source: 'View Markdown',
    title: 'Every operation.<br><span>Connected.</span>', subtitle: 'Nexora ERP · Desktop ERP for internal operations',
    intro: 'Purchasing, inventory, sales and production, connected through traceable business records.', scope: 'Internal trial: one company, multiple warehouses, online LAN clients.',
    button: 'Read the guide', code: 'View source', home: 'Overview', lang: '中文',
    flows: [['Purchasing', 'PURCHASE', 'Requests & orders'], ['Inventory', 'INVENTORY', 'Movements & ledgers'], ['Production', 'PRODUCTION', 'Work orders & costs'], ['Sales', 'SALES', 'Shipments & returns']],
    pillars: [['Business flow', 'Partial movements and source tracing'], ['Finance foundations', 'Accounts, periods and change history'], ['In development', 'Manual journals shipped; automation next']], footer: 'Internal trial · Single company · Online LAN', download: 'Download Markdown' }
}

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

export function resolveLink(href, source, language) {
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) return href
  // 禁止文档链接生成可执行协议；相对路径统一按仓库位置解析。
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) throw new Error(`不允许的文档链接: ${href}`)
  const [path, fragment] = href.split('#')
  const normalized = posix.normalize(posix.join(posix.dirname(source), path))
  const routes = { 'README.md': '../zh-CN/', 'README.en.md': '../en/', 'docs/development.zh-CN.md': '../zh-CN/development.html', 'docs/development.en.md': '../en/development.html' }
  if (normalized.startsWith('../')) throw new Error(`文档链接越出仓库: ${href}`)
  if (routes[normalized]) return routes[normalized] + (fragment ? `#${fragment}` : '')
  return `${repository}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${normalized.split('/').map(encodeURIComponent).join('/')}${fragment ? `#${fragment}` : ''}`
}

export function renderMarkdown(markdown, source, language, home = false) {
  const headings = []
  let index = 0
  const parser = new Marked({ gfm: true })
  parser.use({ renderer: {
    html({ text }) { return escapeHtml(text) },
    link({ href, tokens }) { return `<a href="${escapeHtml(resolveLink(href, source, language))}">${this.parser.parseInline(tokens)}</a>` },
    heading({ depth, tokens }) {
      const text = this.parser.parseInline(tokens)
      const id = `section-${++index}`
      if (depth === 2) headings.push({ id, text })
      return `<h${depth} id="${id}">${text}</h${depth}>\n`
    },
    table(token) {
      const header = token.header.map(cell => `<th scope="col">${this.parser.parseInline(cell.tokens)}</th>`).join('')
      const rows = token.rows.map(row => `<tr>${row.map(cell => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`).join('')
      return `<div class="table-scroll" tabindex="0" role="region" aria-label="${language === 'en' ? 'Scrollable table' : '可横向滚动的表格'}"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`
    }
  } })
  const body = home ? markdown.slice(markdown.indexOf('## ')) : markdown
  return { html: parser.parse(body), headings }
}

function header(language, guide, headings) {
  const t = languages[language]
  const current = guide ? 'development.html' : './'
  return `<a class="skip" href="#main">${t.skip}</a><header class="site-header"><a class="brand" href="./"><img src="../assets/brand.png" alt="" width="36" height="36"><span>Nexora</span></a><nav aria-label="${language === 'en' ? 'Main navigation' : '主导航'}"><a href="./#section-1">${t.features}</a><a href="./#section-2">${t.progress}</a><a href="development.html" ${guide ? 'aria-current="page"' : ''}>${t.docs}</a></nav><div class="header-end"><a href="${repository}">GitHub ↗</a><a class="language" href="../${t.other}/${current}" lang="${t.other}" hreflang="${t.other}">${t.lang}</a></div></header>`
}

function hero(language) {
  const t = languages[language]
  const en = language === 'en'
  const labels = en ? ['Receipt', 'Stock', 'Payable', 'Trace'] : ['入库', '库存', '财务', '追溯']
  const captions = en ? ['Warehouse confirmation starts the record.', 'The same transaction writes the stock movement.', 'The receipt becomes a traceable payable source.', 'Follow each source back to the original receipt.'] : ['仓库确认入库，业务记录由此开始。', '同一事务写入库存流水，数量与来源一起保留。', '已确认入库形成应付来源，金额可追溯到原单。', '沿着来源记录，查回同一张入库单。']
  return `<section class="hero"><h1>${t.title}</h1><p class="subtitle">${t.subtitle}</p><p class="hero-description">${t.intro}</p><div class="actions"><a class="primary" href="development.html">${t.button} <span aria-hidden="true">↗</span></a><a href="${repository}">${t.code} <span aria-hidden="true">↗</span></a></div></section><section class="scroll-scene" aria-label="${en ? 'Interactive receipt, stock and payable demo' : '入库、库存与应付交互演示'}"><div class="scene-sticky"><div class="stage-heading"><span>${en ? 'Follow a receipt. Explore every connection.' : '从一张入库单，看见业务的每一次连接。'}</span><button type="button" data-action="reset">${en ? 'Reset demo' : '重置演示'}</button></div><div class="scene-board">${sandboxMarkup(language)}<svg class="connection-layer" aria-hidden="true"><defs><filter id="line-glow" x="-80%" y="-100%" width="260%" height="300%"><feGaussianBlur stdDeviation="3"/></filter></defs><g data-connection="0"><path class="connection-glow"/><path class="connection-line"/><circle class="connection-node" r="4"/></g><g data-connection="1"><path class="connection-glow"/><path class="connection-line"/><circle class="connection-node" r="4"/></g></svg></div><div class="scene-narration">${captions.map((caption,index)=>`<p data-caption="${index}" ${index ? 'hidden' : ''}>${caption}</p>`).join('')}</div><div class="scene-controls"><div role="group" aria-label="${en ? 'Select a flow step' : '选择演示步骤'}">${labels.map((label,index)=>`<button type="button" data-stage="${index}" aria-pressed="${index===0}">${label}</button>`).join('')}</div><button type="button" data-overview>${en ? 'Overview' : '返回总览'}</button><button type="button" data-pause="${en ? 'Pause motion' : '暂停动效'}" data-resume="${en ? 'Resume scroll' : '继续滚动演示'}" aria-pressed="false">${en ? 'Pause motion' : '暂停动效'}</button></div><p class="demo-status" data-demo-status role="status" aria-live="polite"></p><p class="demo-disclaimer">${en ? 'Interactive demo · Local sample data · Refresh to reset' : '网页交互演示 · 使用本地示例数据 · 刷新恢复初始状态'}</p><noscript><p class="no-script-note">${en ? 'DEMO-001: 12 units received → stock +12 → payable ¥120.00. Enable JavaScript to interact.' : 'DEMO-001：入库 12 件 → 库存 +12 → 应付 ¥120.00。启用 JavaScript 后可操作演示。'}</p></noscript></div></section><section class="pillars" aria-label="${t.home}">${t.pillars.map(([name,detail])=>`<div><h2>${name}</h2><p>${detail}</p></div>`).join('')}</section><div class="foundation"><p>Electron / Vue 3 / FastAPI / SQLite</p><a href="#section-2">${t.progress} →</a></div>`
}

function page(language, guide, rendered) {
  const t = languages[language]
  const title = guide ? `${t.docs} · Nexora ERP` : `Nexora ERP · ${t.home}`
  const source = guide ? t.guide : t.readme
  const toc = `<aside class="toc"><nav aria-label="${t.contents}"><p>${t.contents}</p>${rendered.headings.map(h => `<a href="#${h.id}">${h.text}</a>`).join('')}<a class="source-link" href="${repository}/blob/main/${source}">${t.source} ↗</a></nav></aside>`
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${escapeHtml(guide ? t.docs + ': Electron, Vue, FastAPI, testing, builds and GitHub Pages.' : t.intro)}"><link rel="icon" href="../assets/brand.png"><link rel="stylesheet" href="../assets/site.css">${guide ? '' : '<link rel="stylesheet" href="../assets/sandbox.css">'}</head><body class="${guide ? 'guide' : 'overview'}">${header(language,guide,rendered.headings)}<main id="main" ${guide ? 'class="doc-layout"' : ''}>${guide ? toc : hero(language)}<article class="prose ${guide ? '' : 'home-content'}">${rendered.html}<p class="download"><a href="../sources/${posix.basename(source)}" download>${t.download} ↓</a></p></article></main><footer><a class="brand-text" href="./">Nexora ERP</a><span>${t.footer}</span><a href="${repository}">GitHub ↗</a></footer>${guide ? '' : '<script type="module" src="../assets/motion.mjs"></script>'}</body></html>`
}

export function buildSite(output = resolve(root, 'dist/site')) {
  mkdirSync(resolve(output, 'assets'), { recursive: true })
  mkdirSync(resolve(output, 'sources'), { recursive: true })
  copyFileSync(resolve(root, 'docs/site/site.css'), resolve(output, 'assets/site.css'))
  copyFileSync(resolve(root, 'resources/icon.png'), resolve(output, 'assets/brand.png'))
  for (const file of ['motion.mjs', 'scene-geometry.mjs', 'webgl-stage.mjs', 'sandbox.mjs', 'sandbox-ui.mjs', 'sandbox.css']) copyFileSync(resolve(root, 'docs/site', file), resolve(output, 'assets', file))
  copyFileSync(resolve(root, 'docs/site/fonts/InterVariable.woff2'), resolve(output, 'assets/InterVariable.woff2'))
  copyFileSync(resolve(root, 'docs/site/fonts/LICENSE.txt'), resolve(output, 'assets/FONT-LICENSE.txt'))
  for (const [language, t] of Object.entries(languages)) {
    mkdirSync(resolve(output, language), { recursive: true })
    for (const guide of [false, true]) {
      const source = guide ? t.guide : t.readme
      const markdown = readFileSync(resolve(root, source), 'utf8')
      writeFileSync(resolve(output, language, guide ? 'development.html' : 'index.html'), page(language, guide, renderMarkdown(markdown,source,language,!guide)))
      writeFileSync(resolve(output, 'sources', posix.basename(source)), markdown)
    }
  }
  writeFileSync(resolve(output, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=zh-CN/"><title>Nexora ERP</title></head><body><a href="zh-CN/">简体中文</a> · <a href="en/">English</a></body></html>')
  writeFileSync(resolve(output, '.nojekyll'), '')
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`官网已生成：${buildSite()}`)
}

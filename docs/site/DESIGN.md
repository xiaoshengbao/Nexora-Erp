---
name: Nexora ERP 官网
description: 浅色银白实体窗口、WebGL 来源关系与可读文档；仅适用于 docs/site
colors:
  paper: "#fafbfc"
  stage: "#f8fafc"
  ink: "#182b35"
  muted: "#596873"
  teal: "#176f67"
  action: "#087f75"
  action-hover: "#06695f"
  selected: "#078579"
  linked: "#12bfa7"
  linked-row: "#e0f8f0"
  panel: "#fff"
  window-surface: "#fbfdff"
  sidebar-surface: "#f7fafc"
  chrome-shade: "#eaf0f5"
  silver-outer: "#8e9da8"
  silver-inner: "#8396a5"
  silver-edge: "#b0bec8"
  silver-base: "#849aa8"
  stage-light: "#dfeaf078"
  placeholder: "#dfe9ef"
  rule: "#d9e0e4"
  field-rule: "#ccdbe5"
  field-focus: "#2ca998"
  field-ink: "#203440"
  secondary-ink: "#365d6a"
  stage-control-ink: "#47616d"
  status-bg: "#c9f6eb"
  status-ink: "#076f61"
  draft-bg: "#fcf1d5"
  draft-ink: "#7d5712"
  error: "#a2292f"
typography:
  display: {fontFamily: 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', fontSize: "clamp(48px, 6vw, 80px)", fontWeight: 750, lineHeight: 1.13, letterSpacing: "-.035em"}
  headline: {fontSize: "clamp(30px, 3.2vw, 45px)", fontWeight: 700, lineHeight: 1.3, letterSpacing: "-.025em"}
  window-title: {fontSize: "36px", lineHeight: 1.2, letterSpacing: "-.025em"}
  body: {fontSize: "16px", lineHeight: 1.9}
  sandbox: {fontSize: "16px"}
  sidebar: {fontSize: "17px"}
  field-label: {fontSize: "15px"}
  table: {fontSize: "15px", lineHeight: 1.5}
  amount: {fontSize: "46px", lineHeight: 1.25, letterSpacing: "-.03em"}
  code: {fontFamily: 'Consolas, "SFMono-Regular", monospace', fontSize: "13px", lineHeight: 1.8}
rounded:
  placeholder: "3px"
  field: "5px"
  sidebar-action: "6px"
  sheet: "8px"
  primary: "9px"
  window-content: "10px"
  window-chrome: "11px"
  window-base: "12px"
  window: "14px"
  step: "22px"
  step-track: "26px"
spacing:
  control-gap: "9px"
  field-label-gap: "7px"
  field-gap: "18px"
  sheet-inset: "23px"
  scene-horizontal: "32px"
components:
  button-primary: {backgroundColor: "{colors.action}", textColor: "{colors.panel}", rounded: "{rounded.primary}", padding: "13px 24px"}
  sandbox-primary: {backgroundColor: "{colors.action}", textColor: "{colors.panel}", rounded: "{rounded.field}", padding: "9px 13px"}
  sandbox-primary-hover: {backgroundColor: "{colors.action-hover}"}
  sandbox-secondary: {backgroundColor: "{colors.panel}", textColor: "{colors.secondary-ink}", rounded: "{rounded.field}", padding: "9px 13px"}
  field: {backgroundColor: "{colors.panel}", textColor: "{colors.field-ink}", rounded: "{rounded.field}", padding: "9px"}
  status-chip: {backgroundColor: "{colors.status-bg}", textColor: "{colors.status-ink}", rounded: "{rounded.field}", padding: "6px 11px"}
  status-chip-draft: {backgroundColor: "{colors.draft-bg}", textColor: "{colors.draft-ink}"}
  stage-button: {textColor: "{colors.stage-control-ink}", rounded: "{rounded.step}", padding: "8px 16px"}
  stage-button-selected: {backgroundColor: "{colors.selected}", textColor: "{colors.panel}"}
  demo-window: {rounded: "{rounded.window}"}
  window-viewport: {rounded: "{rounded.window}", padding: "3px"}
  receipt-sheet: {backgroundColor: "{colors.panel}", rounded: "{rounded.sheet}", padding: "23px"}
---

# Design System: Nexora ERP 官网

<!-- 归档当前源码中的设计；范围仅 docs/site，不覆盖 ERP 桌面应用，也不是整站验收证明。 -->

## Overview

**Creative North Star: "清晰的业务舞台"**

浅色舞台、银白实体应用窗、现代无衬线文字与青绿来源关系共同解释业务。窗口保持独立软件界面的宽高与桌面侧栏，整体缩小后形成明显透视；银边的厚度、同一地面上的阴影与镜像共同表达实体感。保留用户批准的浅色方向与 Inter 字体，不恢复此前浅角度、窄长三列的构图。

本规范覆盖当前 WebGL 视觉层、原生 HTML 业务沙盒与平实文档。Nexora/联光 ERP 名称及品牌资源沿用项目资产；官网支持中英文，本地演示不连接 ERP 服务，也不代表桌面应用已支持双语。

**Key Characteristics:**

- 独立银白实体窗，GPU 逐层挤出银边，地面阴影、反光与只读内容镜像配合。
- 三窗共地平线；总览两侧为 30° / −30°，库存中窗为 4°。
- 应用逻辑画布整体缩放，桌面保留采购、库存、销售、生产、财务、系统文字。
- HTML 管理业务、表单与焦点；GPU 和镜像只承担视觉。
- 文档平实可读，手机与减少动态模式纵向排列并保留业务操作。

## Colors

前置 token 提取自 site.css 与 sandbox.css，记录实际局部覆盖。青绿是业务行动与来源关系的识别色；银灰和冷白只承担窗口材质，环境光不扩展成新的业务状态色。

### Primary

teal 用于官网链接与全局焦点，action 用于主行动，action-hover 用于业务主按钮悬停，selected 用于步骤选择。linked 与 linked-row 表达来源锚点及库存关联。已入库与草稿分别使用 status 与 draft 配对的浅底和文字；错误同时显示 error 色和字段说明。

### Neutral

paper 是文档纸面，stage 是首页底色，panel 是单据面板。window-surface、sidebar-surface 与 chrome-shade 保留应用内容、侧栏和标题栏的冷白层次；ink、muted 区分正文与说明，rule、field-rule 承担内容分隔和字段边界。

silver-outer 是实体外框的灰银，silver-inner 与 silver-edge 是内银框的暗部和收边，silver-base 是窗底银面；stage-light 是舞台环境光，placeholder 是库存表中的装饰占位条。它们是当前源码中新增材质的实际色值，已在 sidecar 归档 palette advisory 的用途。GPU 金属、来源带和光点颜色由着色器生成，不以单个 CSS 色块代替材质。

**The Business Accent Rule.** 品牌色强调操作与来源关系，不替代字段文字。

## Typography

Inter、Segoe UI、PingFang SC、Microsoft YaHei、sans-serif 是既定现代无衬线体系。Inter 本地可变字体支持 100–900 字重及 font-display: swap；中文沿用回退字体。字体来自 [Inter 官方仓库](https://github.com/rsms/inter)，采用 SIL Open Font License 1.1，许可随 fonts/LICENSE.txt 分发。此前字体检测提示已随用户批准的字体选择保留在 sidecar。

前置的 sandbox、sidebar、table、window-title 和 amount 都是逻辑应用画布内的桌面字级；画布缩放后可见尺寸随窗口一起变化。总览的窗口标题局部为 35px，应付金额为 44px。手机标题为 23px、业务正文与字段为 12px、表格为 11px、应付金额为 34px；首页标题在 760px 以下使用 clamp(38px,10vw,62px)，说明由桌面 18px 降为 14px。

文档正文最大 75ch，720px 以下为 15px。业务数字采用等宽数字；代码采用 Consolas、SFMono-Regular、monospace。

**The Readable Documentation Rule.** 产品展示的密度与标题尺度不扩散到长文正文。

## Layout

页眉最大 1360px，桌面舞台最大 1440px。滚动场景为 340vh，粘性区域为 100svh、最小 620px。窗口区初始采用 calc(100svh - 220px)，最大 650px；进入总览时 JS 随窗口状态调整舞台高度。HTML 与 GPU 共用 scene-geometry.mjs，透视距离为 1400px，投影原点在各窗底部中心；窗下沿统一落在舞台底部上方 35px。

初始入库的逻辑画布为 1100 × 590；总览的入库、库存、财务分别为 600 × 570、1000 × 585、600 × 550。初始入库的目标占宽为 85%，双窗目标占宽为 40% / 59%，三窗为 29% / 46% / 29%；这些是布局意图，实际宽度同时受可用高度及透视近侧限制。窗口保留逻辑宽高比，整体等比缩放，不将桌面界面挤成窄表单。

聚焦窗归正至 0°，逻辑宽统一为 1000px；入库、库存、财务的逻辑高度分别为 720px、650px、680px。目标占宽仍为 85%，高度不足时等比缩小。其余窗移向两侧、透明度降至 .25，并退出交互。财务仅在启用桌面动态且聚焦时将来源摘要与付款表单分为两列；静态、手机与减少动态模式保持纵向布局。

桌面侧栏保持 148px，紧凑总览为 145px，并保留全部业务名称。仅在 760px 以下变为 40px 图标栏；手机窗口最大 600px、间距 54px，取消固定行程，表格在窗内横向滚动。减少动态模式同样取消透视及固定行程，纵向舞台最大 1100px。

文档最大 1210px，230px 目录、最大 840px 正文、70px 列距。1100px 以下为 190px 目录、35px 列距；720px 以下单列。打印恢复顺序内容流并隐藏画布、连线与镜像。

**The Shared Ground Rule.** 三窗共用底部投影原点与同一地面，窗口内容沿逻辑宽高比整体缩放。

## Elevation & Depth

桌面原生 WebGL 使用两块透明画布。下层绘制深度为 −14、−10、−6、−2 的逐层银框侧面、地面接触阴影与反光；上层以三角带绘制柔边来源线和光点。窗口内容仍是 HTML。画布 pointer-events:none 且 aria-hidden，不截获输入；父舞台保持 transform-style:flat，子窗使用底部中心的 perspective 与 rotateY。

内容镜像是窗口 viewport 的只读 HTML 复制，随业务 render 更新；移除 data-*、id、name、tabindex，镜像容器 aria-hidden、inert，且 pointer-events:none。镜像在窗下方翻转、模糊并渐隐，提供当前内容的倒影；GPU 反光作为地面材质补充，两者都不承载第二份交互。

聚焦时来源线退至窗后（z-index 1、opacity .4），目标窗为 z-index 3，避免覆盖表单。CSS 窗口仍保留轻阴影（0 2px 3px #3d566459,0 18px 28px #29434f20）；GPU 失效时银边渐变与这份阴影继续提供窗口外观。首页主行动使用柔和阴影（0 8px 22px #087f7518），文档依靠浅色层次与分隔线组织阅读。

**The Purposeful Depth Rule.** 空间感解释窗口关系，编辑时保证可点击与可读，文档保持平面阅读。

## Shapes

实体窗与内 viewport 使用柔和圆角（14px）；标题栏上角（11px）、内容下角（10px）与底部银面下角（12px）组成同一轮廓。单据面板（8px）、字段、业务按钮和状态（5px）、侧栏选择（6px）保持软件界面的紧凑感。首页行动（9px）、步骤按钮（22px）、轨道（26px）与表格占位条（3px）按各自用途区分。边框通常为 1px；GPU 圆角材质独立实现。

底部银面的 12px、内标题栏的 11px 和占位条的 3px 是当前源码中的实际 radius advisory，随用途归档，不将它们当成全站新增圆角档位的建议。

## Components

### Buttons and Fields

桌面逻辑画布内，普通沙盒按钮最小高 38px、字段最小高 39px；主按钮实心青绿、次按钮白底，禁用 opacity .5。字段焦点为 2px、外扩 1px；全局键盘焦点为 3px 青绿、外扩 5px。错误关联 aria-invalid、说明文本与状态播报；主动来源导航结束后聚焦目标标题，输入获得焦点冻结镜头，未出现、离开舞台或聚焦后退到两侧的桌面窗 inert 且 aria-hidden。较多物料与付款记录可在窗口内容区正常滚动。

### Application Navigation

采购、库存、财务按钮进入对应窗口的聚焦操作。销售、生产、系统是应用上下文标签，保留文字与图标但不可点击；不为演示添加不存在的业务入口。静态和手机模式的跳转滚动至对应窗，不附加桌面聚焦的两列样式。

### Business Sandbox

本地沙盒支持新建/复制草稿、多物料入库、库存筛选、来源追溯、部分付款与付款历史。确认派生库存和应付，已确认单据只读，草稿不改余额。默认 DEMO-001 为数量 12、单价 ¥10.00、库存 +12、应付 ¥120.00；失败不替换旧状态。刷新/重置恢复默认，同标签页语言链接用一次性 sessionStorage 交接校验状态。库存的装饰占位行 aria-hidden，不表示额外业务记录。

### Stage and Source Connections

原生 scroll 与按需 requestAnimationFrame 驱动：20–38% 库存右进，52–70% 财务右进；34–43% / 66–76% 绘出两条线，85–95% 光点回看来源。阶段文字边界为 32%、63%、85%；分步选择锁定手动模式。聚焦约 450ms，恢复滚动约 300ms 对齐实际位置；滚动只改镜头，不写业务。

曲线读取实际来源锚点，库存连接行边缘；不可见、草稿或不同来源不绘对应线。手机使用外缘 SVG 纵向连线，窗口以 18px / 400ms 轻微显现；减少动态效果取消位移、透视、显现与连线光晕，保留静态来源线和操作。手机与减少动态偏好不初始化 WebGL；无脚本显示静态示例。

WebGL 首次桌面动态绘制才初始化，DPR 最高 2 并受 GPU 缓冲尺寸限制。初始化、编译失败或上下文丢失时回退 HTML/CSS/SVG，不重置业务数据；恢复时重建 GPU 资源并请求当前帧，卸载释放资源。静止、离屏和后台不维持连续循环。组件 sidecar 是自包含 HTML/CSS 外观预览，不运行 WebGL 或业务状态机，也不宣称完整舞台复现或整站视觉验收通过。

## Do's and Don'ts

### Do:

- **Do** 将规范限制在 docs/site，保留浅色银白实体窗与既定无衬线字体。
- **Do** 让 HTML 与 GPU 使用相同的 1400px 透视、底部中心原点和逻辑画布比例。
- **Do** 保留桌面侧栏文字、真实锚点、字段验证、键盘路径、手动模式与 GPU 失效回退。
- **Do** 区分本地演示、桌面能力和计划，随字体保留 OFL 许可。

### Don't:

- **Don't** 恢复此前 7° 浅角度、窄长三列的构图，或旧卡片、深色概念图与衬线默认方案。
- **Don't** 用画布或镜像承载业务表单、截获输入，或在恢复 GPU 时重置业务数据。
- **Don't** 在编辑时移动镜头、以连线遮挡字段，或以滚动触发业务操作。
- **Don't** 将销售、生产、系统上下文标签伪装为可操作的演示功能。
- **Don't** 将本规范覆盖到 ERP 应用，把预览色阶当成生产 token，或把静态预览写成整站验收证明。

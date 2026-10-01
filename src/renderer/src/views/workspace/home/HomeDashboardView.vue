<script setup lang="ts">
import {computed,watch} from 'vue'
import {storeToRefs} from 'pinia'
import {NCollapse,NSkeleton} from 'naive-ui'
import AppButton from '../../../components/app/AppButton.vue'
import AppCollapseItem from '../../../components/app/AppCollapseItem.vue'
import WorkspaceTable from '../../../components/workspace/WorkspaceTable.vue'
import {usePiniaAppStore} from '../../../store/app-store'
import {dashboardMetrics,dashboardComposition,dashboardSourceLabel,formatDashboardMoney,trendCoordinates,trendLine,trendArea,trendTicks} from './dashboard-data'
import './home-dashboard.css'

const store=usePiniaAppStore()
const {dashboardResult:result,dashboardPeriod:period,dashboardLoading:loading,dashboardError:error,user,connectionLost,server}=storeToRefs(store)
const {loadDashboard,navigateToRoute}=store
watch(()=>[period.value,connectionLost.value,user.value?.id,user.value?.permissions.join('|'),server.value?.id,server.value?.fingerprint],()=>{void loadDashboard()},{immediate:true})
const metrics=computed(()=>result.value?dashboardMetrics(result.value):[])
const composition=computed(()=>dashboardComposition(result.value?.composition??[]))
const compositionTotal=computed(()=>composition.value.reduce((sum,item)=>sum+item.count,0))
const donutBackground=computed(()=>{
  if(!compositionTotal.value)return 'var(--dash-soft)'
  let start=0
  return `conic-gradient(${composition.value.map(item=>{const end=start+item.percent;const part=`${item.color} ${start}% ${end}%`;start=end;return part}).join(', ')})`
})
const trend=computed(()=>result.value?.finance?.trend??[])
const unpriced=computed(()=>trend.value.some(row=>row.sales.amount===null||row.purchase.amount===null))
const salesValues=computed(()=>trend.value.map(row=>Number(row.sales.amount??0)/1000))
const purchaseValues=computed(()=>trend.value.map(row=>Number(row.purchase.amount??0)/1000))
const ceiling=computed(()=>Math.max(0.001,...salesValues.value,...purchaseValues.value)*1.12)
const floor=computed(()=>Math.min(0,...salesValues.value,...purchaseValues.value)*1.12)
const salesPoints=computed(()=>trendCoordinates(salesValues.value,ceiling.value,floor.value))
const purchasePoints=computed(()=>trendCoordinates(purchaseValues.value,ceiling.value,floor.value))
const zeroY=computed(()=>trendCoordinates([0],ceiling.value,floor.value)[0].y)
const labels=computed(()=>trendTicks(trend.value.map(row=>row.date)))
const pending=computed(()=>{
  const value=result.value
  if(!value)return []
  return [
    ...(value.sales?[{label:'销售订单',count:value.sales.draft+value.sales.waiting,note:`${value.sales.draft} 单草稿 · ${value.sales.waiting} 单待出库`,route:'sales' as const,tone:'teal'}]:[]),
    ...(value.purchase?[{label:'采购订单',count:value.purchase.draft+value.purchase.waiting,note:`${value.purchase.draft} 单草稿 · ${value.purchase.waiting} 单待入库`,route:'purchase' as const,tone:'blue'}]:[]),
    ...(value.production?[{label:'生产工单',count:value.production.draft+value.production.released,note:`${value.production.draft} 单草稿 · ${value.production.released} 单已下达或生产中`,route:'workOrders' as const,tone:'amber'}]:[])]
})
const pipelineMax=computed(()=>Math.max(1,...pending.value.map(row=>row.count)))
const permissionsMissing=computed(()=>result.value&&!result.value.finance&&!result.value.sales&&!result.value.purchase&&!result.value.production&&!result.value.inventory)
const axisAmount=(value:number):string=>value.toLocaleString('zh-CN',{notation:'compact',maximumSignificantDigits:3})
const dailyColumns=[{key:'date',title:'日期'},{key:'sales',title:'销售净额（元）'},{key:'purchase',title:'采购净额（元）'},{key:'unpriced',title:'缺价行数'}]
const dailyRows=computed(()=>trend.value.map(row=>({date:row.date,sales:formatDashboardMoney(row.sales.amount),purchase:formatDashboardMoney(row.purchase.amount),unpriced:row.sales.unpriced_count+row.purchase.unpriced_count})))
const evidenceColumns=[{key:'posted_at',title:'发生时间（UTC）',width:'190'},{key:'source',title:'来源',width:'200'},{key:'order',title:'订单'},{key:'line',title:'来源行'},{key:'money',title:'金额（元）'}]
const evidenceRows=computed(()=>result.value?.finance?.evidence.map(row=>({...row,source:`${dashboardSourceLabel(row.source_type)} #${row.source_id}`,order:row.order_id??'历史自由入库',line:`#${row.source_line_id}`,money:formatDashboardMoney(row.amount)}))??[])
</script>

<template>
  <section class="dashboard" aria-label="工作台经营概览" :aria-busy="loading">
    <div class="dashboard-hero">
      <div><h2>关键业务，一眼看清</h2><p>从销售、采购到库存与生产，在同一处查看业务运行状态。</p></div>
      <div class="dashboard-source-note"><span class="dashboard-source-badge">服务端业务数据</span><small v-if="result">快照 {{ result.generated_at.slice(0,19).replace('T',' ') }} UTC<br/>按当前账号权限汇总</small><small v-else>连接后读取已确认单据<br/>金额与数量分别核对</small></div>
    </div>
    <div class="dashboard-toolbar">
      <div><strong>经营概览</strong><span v-if="result">{{ result.from_date }} 至 {{ result.to_date }} · UTC</span></div>
      <div class="dashboard-toolbar-actions"><div class="dashboard-periods" role="group" aria-label="统计时间范围"><AppButton variant="plain" :aria-pressed="period==='7d'" @click="period='7d'">近 7 天</AppButton><AppButton variant="plain" :aria-pressed="period==='30d'" @click="period='30d'">近 30 天</AppButton></div><AppButton :disabled="connectionLost||!user" :loading="loading" @click="loadDashboard">刷新统计</AppButton></div>
    </div>
    <p v-if="connectionLost" class="dashboard-state" role="status">服务端连接已中断。恢复连接后自动重新读取统计。</p>
    <p v-else-if="error" class="dashboard-state dashboard-state--error" role="alert">统计查询失败：{{ error }}。请点击“刷新统计”重试。</p>
    <div v-else-if="loading" class="dashboard-loading" role="status" aria-label="正在读取经营统计"><NSkeleton v-for="index in 4" :key="index" height="150px" :sharp="false"/><span>正在读取经营统计…</span></div>
    <p v-else-if="!user" class="dashboard-state">请先登录，再查看有权访问的业务统计。</p>
    <template v-else-if="result">
      <p v-if="permissionsMissing" class="dashboard-state">当前账号尚无采购、销售、生产、库存或财务查看权限。请联系管理员分配所需权限。</p>
      <div class="dashboard-metrics"><article v-for="metric in metrics" :key="metric.label" class="dashboard-metric" :class="`dashboard-metric--${metric.tone}`"><span class="dashboard-metric-label">{{ metric.label }}</span><div class="dashboard-metric-value"><strong :title="metric.value">{{ metric.value }}</strong><span>{{ metric.unit }}</span></div><div class="dashboard-metric-foot"><span>{{ metric.change }}</span><small>{{ metric.note }}</small></div></article></div>
      <p class="dashboard-basis">业务净额按确认、退货与冲销发生日计入，销售含维修服务费；这是业务来源汇总，不代表收付款、毛利或已过账总账收入。待办和库存展示当前状态，切换日期不改变它们。</p>
      <div class="dashboard-charts">
        <article class="dashboard-panel dashboard-trend-panel">
          <div class="dashboard-panel-head"><h3>销售与采购走势</h3><div v-if="result.finance" class="dashboard-legend"><span><i class="legend-sales"></i>销售</span><span><i class="legend-purchase"></i>采购</span></div></div><p class="dashboard-panel-caption">每日业务净额 · 单位：千元 · 负数保留退货与冲销影响</p>
          <p v-if="!result.finance" class="dashboard-state">需财务查看权限，未读取金额与趋势。</p><p v-else-if="unpriced" class="dashboard-state">期间存在缺价来源，暂不绘制可能不完整的金额趋势。请在下方核对缺价记录。</p>
          <template v-else>
            <div class="dashboard-trend-chart"><div class="dashboard-y-axis" aria-hidden="true"><span>{{ axisAmount(ceiling) }}</span><span>{{ axisAmount((ceiling+floor)/2) }}</span><span>{{ axisAmount(floor) }}</span></div>
              <svg viewBox="0 0 640 215" role="img" :aria-label="`${result.from_date}至${result.to_date}业务净额趋势，下方有逐日金额表`"><defs><linearGradient id="dashboard-sales-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#35b8aa" stop-opacity=".22"/><stop offset="100%" stop-color="#35b8aa" stop-opacity="0"/></linearGradient></defs><g class="dashboard-chart-grid" aria-hidden="true"><line x1="28" y1="40" x2="612" y2="40"/><line x1="28" y1="115" x2="612" y2="115"/><line x1="28" y1="190" x2="612" y2="190"/></g><line v-if="floor<0" class="dashboard-zero-line" x1="28" :y1="zeroY" x2="612" :y2="zeroY"/><path :d="trendArea(salesPoints,zeroY)" fill="url(#dashboard-sales-fill)"/><polyline class="dashboard-line-sales" :points="trendLine(salesPoints)"/><polyline class="dashboard-line-purchase" :points="trendLine(purchasePoints)"/><circle v-for="(point,index) in salesPoints" :key="index" :cx="point.x" :cy="point.y" r="3" class="dashboard-point-sales"><title>{{ trend[index].date }} 销售 {{ formatDashboardMoney(trend[index].sales.amount) }} 元</title></circle><circle v-for="(point,index) in purchasePoints" :key="index" :cx="point.x" :cy="point.y" r="3" class="dashboard-point-purchase"><title>{{ trend[index].date }} 采购 {{ formatDashboardMoney(trend[index].purchase.amount) }} 元</title></circle></svg>
              <svg class="dashboard-x-axis" viewBox="0 0 640 24" aria-hidden="true"><text v-for="label in labels" :key="label.label" :x="label.x" y="16" text-anchor="middle">{{ label.label }}</text></svg>
            </div>
          </template>
          <NCollapse v-if="result.finance" class="dashboard-details"><AppCollapseItem name="daily" title="查看逐日金额与缺价数量"><WorkspaceTable class="dashboard-data-table" title="每日业务来源金额 · 人民币元 · UTC" :show-title="false" :min-table-width="560" :columns="dailyColumns" :data="dailyRows"/></AppCollapseItem></NCollapse>
        </article>
        <article class="dashboard-panel dashboard-composition-panel"><div class="dashboard-panel-head"><h3>有效单据构成</h3></div><p class="dashboard-panel-caption">期间确认且当前未冲销 · 仅有权查看的领域 · 按整单计数</p><p v-if="!composition.length" class="dashboard-state">需采购、销售、库存或生产查看权限。</p><div v-else class="dashboard-donut-wrap"><div class="dashboard-donut" :style="{background:donutBackground}" role="img" :aria-label="`有效单据共${compositionTotal}单，数量见右侧列表`"><div><strong>{{ compositionTotal }}</strong><span>{{ compositionTotal?'有效单据':'期间暂无有效单据' }}</span></div></div><ul class="dashboard-composition-list"><li v-for="item in composition" :key="item.key"><span><i :style="{background:item.color}"></i>{{ item.label }}</span><strong>{{ item.count }} 单 · {{ item.percent.toFixed(1) }}%</strong></li></ul></div></article>
      </div>
      <div class="dashboard-bottom">
        <article class="dashboard-panel"><div class="dashboard-panel-head"><h3>当前待处理单据</h3><small>不限日期</small></div><p v-if="!pending.length" class="dashboard-state">当前账号无订单或工单查看权限。</p><div v-else class="dashboard-pipeline"><div v-for="item in pending" :key="item.label" class="dashboard-pipeline-row"><div><AppButton variant="text" @click="navigateToRoute(item.route)">{{ item.label }}</AppButton><strong>{{ item.count }} <small>单</small></strong></div><small>{{ item.note }}</small><div class="dashboard-pipeline-track"><span :class="`tone-${item.tone}`" :style="{width:`${item.count/pipelineMax*100}%`}"></span></div></div></div></article>
        <article class="dashboard-panel"><div class="dashboard-panel-head"><h3>当前核对事项</h3></div><ul class="dashboard-reminders"><li v-if="result.finance"><div><strong>缺价来源</strong><small>{{ result.finance.sales.current.unpriced_count+result.finance.purchase.current.unpriced_count }} 行 · 有缺价时总净额待定，不能视为零。</small></div></li><li v-if="result.inventory"><div><strong>库存数量核对</strong><small>{{ result.inventory.stocked_materials }} / {{ result.inventory.registered_materials }} 种登记物料有正库存；{{ result.inventory.negative_positions }} 个仓库物料组合为负数。</small></div></li><li v-if="result.production"><div><strong>完工交接</strong><small>{{ result.production.awaiting_inspection }} 单待检验 · {{ result.production.awaiting_post }} 单待入库</small></div></li><li v-if="!result.finance&&!result.inventory&&!result.production"><div><strong>按订单核对收发进度</strong><small>请进入有权查看的单据页面处理。首页不会读取未授权的金额和库存。</small></div></li></ul></article>
      </div>
      <NCollapse v-if="result.finance" class="dashboard-panel dashboard-details"><AppCollapseItem name="evidence" :title="`核对期间金额来源（${result.finance.evidence_total} 行）`"><p class="dashboard-panel-caption">以下显示最近 100 行；完整来源请进入应收应付。退货与冲销均保留原发生日期。</p><AppButton variant="text" @click="navigateToRoute('financeSources')">查看完整应收应付来源</AppButton><WorkspaceTable class="dashboard-data-table" title="期间业务净额来源 · 人民币元 · UTC" :show-title="false" :min-table-width="800" :columns="evidenceColumns" :data="evidenceRows" empty-text="期间没有已确认金额来源；两项净额为零。"/></AppCollapseItem></NCollapse>
    </template>
  </section>
</template>

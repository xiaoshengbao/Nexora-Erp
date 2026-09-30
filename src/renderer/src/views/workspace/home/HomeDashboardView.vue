<script setup lang="ts">
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../../components/app/AppButton.vue'
import { computed, ref } from 'vue'
import { demoDashboardSnapshots, trendArea, trendCoordinates, trendLine } from './dashboard-data'
import type { DashboardPeriod } from './dashboard-data'
import './home-dashboard.css'

const period = ref<DashboardPeriod>('7d')
// 演示数据只从本地快照读取，不混用当前登录账号的真实业务记录。
const snapshot = computed(() => demoDashboardSnapshots[period.value])
const trendCeiling = computed(() => Math.max(1, ...snapshot.value.trend.sales, ...snapshot.value.trend.purchase) * 1.16)
const pipelineMax = computed(() => Math.max(1, ...snapshot.value.pipeline.map((item) => item.count)))
const salesPoints = computed(() => trendCoordinates(snapshot.value.trend.sales, trendCeiling.value))
const purchasePoints = computed(() => trendCoordinates(snapshot.value.trend.purchase, trendCeiling.value))
const donutBackground = computed(() => {
  let start = 0
  const segments = snapshot.value.composition.map((item) => {
    const end = start + item.percent
    const segment = `${item.color} ${start}% ${end}%`
    start = end
    return segment
  })
  return `conic-gradient(${segments.join(', ')})`
})
</script>

<template>
  <section class="dashboard" aria-label="工作台可视化面板">
    <div class="dashboard-hero">
      <div>
        <p class="dashboard-kicker">NEXORA · OPERATIONS</p>
        <h2>关键业务，一眼看清</h2>
        <p>从销售、采购到库存与生产，在同一处查看业务运行状态。</p>
      </div>
      <!-- 显著标注数据来源，避免示例金额被误认为当前企业的实际经营结果。 -->
      <div class="dashboard-demo-note">
        <span class="dashboard-demo-badge"><span aria-hidden="true"></span>演示数据</span>
        <small>当前面板展示模拟样本<br />尚未接入实时统计</small>
      </div>
    </div>

    <div class="dashboard-toolbar">
      <div>
        <strong>经营概览</strong>
        <span>{{ snapshot.periodLabel }} · 模拟统计</span>
      </div>
      <div class="dashboard-periods" role="group" aria-label="演示数据时间范围">
        <AppButton
          type="button"
          :aria-pressed="period === '7d'"
          @click="period = '7d'"
          variant="plain"
          >近 7 天</AppButton
        >
        <AppButton
          type="button"
          :aria-pressed="period === '30d'"
          @click="period = '30d'"
          variant="plain"
          >近 30 天</AppButton
        >
      </div>
    </div>

    <div class="dashboard-metrics">
      <article
        v-for="metric in snapshot.metrics"
        :key="metric.label"
        class="dashboard-metric"
        :class="`dashboard-metric--${metric.tone}`"
      >
        <span class="dashboard-metric-label">{{ metric.label }}</span>
        <div class="dashboard-metric-value">
          <strong>{{ metric.value }}</strong
          ><span>{{ metric.unit }}</span>
        </div>
        <div class="dashboard-metric-foot">
          <span>{{ metric.change }}</span
          ><small>{{ metric.note }}</small>
        </div>
      </article>
    </div>

    <div class="dashboard-charts">
      <article class="dashboard-panel dashboard-trend-panel">
        <div class="dashboard-panel-head">
          <div>
            <span class="dashboard-panel-kicker">业务趋势</span>
            <h3>销售与采购走势</h3>
          </div>
          <div class="dashboard-legend">
            <span><i class="legend-sales"></i>销售</span
            ><span><i class="legend-purchase"></i>采购</span>
          </div>
        </div>
        <p class="dashboard-panel-caption">模拟金额变化 · 单位：千元</p>
        <div class="dashboard-trend-chart">
          <div class="dashboard-y-axis" aria-hidden="true">
            <span>{{ Math.round(trendCeiling) }}</span
            ><span>{{ Math.round(trendCeiling / 2) }}</span
            ><span>0</span>
          </div>
          <svg
            viewBox="0 0 640 215"
            role="img"
            :aria-label="`${snapshot.periodLabel}销售与采购模拟金额趋势`"
          >
            <defs>
              <linearGradient id="dashboard-sales-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="#35b8aa" stop-opacity=".22" />
                <stop offset="100%" stop-color="#35b8aa" stop-opacity="0" />
              </linearGradient>
            </defs>
            <g class="dashboard-chart-grid" aria-hidden="true">
              <line x1="28" y1="40" x2="612" y2="40" />
              <line x1="28" y1="115" x2="612" y2="115" />
              <line x1="28" y1="190" x2="612" y2="190" />
            </g>
            <path :d="trendArea(salesPoints)" fill="url(#dashboard-sales-fill)" />
            <polyline class="dashboard-line-sales" :points="trendLine(salesPoints)" />
            <polyline class="dashboard-line-purchase" :points="trendLine(purchasePoints)" />
            <circle
              v-for="(point, index) in salesPoints"
              :key="`sales-${index}`"
              :cx="point.x"
              :cy="point.y"
              r="4"
              class="dashboard-point-sales"
            />
            <circle
              v-for="(point, index) in purchasePoints"
              :key="`purchase-${index}`"
              :cx="point.x"
              :cy="point.y"
              r="3"
              class="dashboard-point-purchase"
            />
          </svg>
        </div>
        <div class="dashboard-x-axis" aria-hidden="true">
          <span v-for="label in snapshot.trend.labels" :key="label">{{ label }}</span>
        </div>
      </article>

      <article class="dashboard-panel dashboard-composition-panel">
        <div class="dashboard-panel-head">
          <div>
            <span class="dashboard-panel-kicker">业务分布</span>
            <h3>单据流转构成</h3>
          </div>
        </div>
        <p class="dashboard-panel-caption">按演示业务单据数量统计</p>
        <div class="dashboard-donut-wrap">
          <div
            class="dashboard-donut"
            :style="{ background: donutBackground }"
            role="img"
            aria-label="演示单据构成：销售出库、采购入库、生产完工和仓库调拨"
          >
            <div><strong>100%</strong><span>模拟样本</span></div>
          </div>
          <ul class="dashboard-composition-list">
            <li v-for="item in snapshot.composition" :key="item.label">
              <span><i :style="{ background: item.color }"></i>{{ item.label }}</span
              ><strong>{{ item.percent }}%</strong>
            </li>
          </ul>
        </div>
      </article>
    </div>

    <div class="dashboard-bottom">
      <article class="dashboard-panel">
        <div class="dashboard-panel-head">
          <div>
            <span class="dashboard-panel-kicker">处理进度</span>
            <h3>业务单据概览</h3>
          </div>
          <small>演示数量</small>
        </div>
        <div class="dashboard-pipeline">
          <div v-for="item in snapshot.pipeline" :key="item.label" class="dashboard-pipeline-row">
            <div>
              <span>{{ item.label }}</span
              ><strong>{{ item.count }} <small>单</small></strong>
            </div>
            <!-- 条长相对于本组最大单量计算，不把装饰长度误当成完成率。 -->
            <div class="dashboard-pipeline-track">
              <span
                :class="`tone-${item.tone}`"
                :style="{ width: `${(item.count / pipelineMax) * 100}%` }"
              ></span>
            </div>
          </div>
        </div>
      </article>
      <article class="dashboard-panel">
        <div class="dashboard-panel-head">
          <div>
            <span class="dashboard-panel-kicker">关注事项</span>
            <h3>待处理提醒</h3>
          </div>
          <small>演示内容</small>
        </div>
        <ul class="dashboard-reminders">
          <li v-for="item in snapshot.reminders" :key="item.title">
            <span
              class="dashboard-reminder-dot"
              :class="`tone-${item.tone}`"
              aria-hidden="true"
            ></span>
            <div>
              <strong>{{ item.title }}</strong
              ><small>{{ item.detail }}</small>
            </div>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

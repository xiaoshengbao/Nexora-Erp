import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dashboardMetrics, dashboardComposition, dashboardChange, formatDashboardMoney,
  trendArea,
  trendCoordinates,
  trendLine, trendTicks
} from '../src/renderer/src/views/workspace/home/dashboard-data.ts'

test('真实指标分别呈现无权限、零与缺价，库存不再伪造安全预警', () => {
  const summary=amount=>({amount,known_amount:'12.00',unpriced_count:amount===null?2:0,source_line_count:3})
  const result={finance:null,sales:null,purchase:null,production:null,inventory:null}
  assert.ok(dashboardMetrics(result).every(metric=>metric.value==='未授权'))
  const metrics=dashboardMetrics({...result,finance:{sales:{current:summary(null),previous:summary('20.00')},purchase:{current:summary('0.00'),previous:summary('0.00')}},
    sales:{draft:1,waiting:2},purchase:{draft:2,waiting:3},inventory:{positive_positions:3,stocked_materials:2}})
  assert.equal(metrics[0].value,'待定价');assert.match(metrics[0].note,/已定价部分 12.00/)
  assert.equal(metrics[1].value,'0.00');assert.equal(metrics[2].value,'8');assert.equal(metrics[3].value,'3')
  assert.doesNotMatch(JSON.stringify(metrics),/安全库存|演示|模拟/)
  assert.equal(dashboardComposition([{key:'shipment',count:0}])[0].percent,0)
  assert.equal(dashboardComposition([{key:'shipment',count:1},{key:'receipt',count:3}])[0].percent,25)
})

test('大额分位和负向净额不丢失；零、负数基期及缺价不生成伪增幅',()=>{
  const group=amount=>({amount})
  assert.equal(formatDashboardMoney('9007199254740993.01'),'9,007,199,254,740,993.01')
  assert.equal(formatDashboardMoney('-0.01'),'-0.01')
  assert.equal(dashboardChange(group('112.80'),group('100.00')),'+12.8%')
  assert.equal(dashboardChange(group('-50.00'),group('100.00')),'-150.0%')
  assert.match(dashboardChange(group('10.00'),group('0.00')),/暂不比较/)
  assert.match(dashboardChange(group(null),group('10.00')),/缺价/)
  const points=trendCoordinates([-10,0,10],10,-10)
  assert.deepEqual(points.map(point=>point.y),[190,115,40])
  assert.match(trendArea(points,115),/^M 28 115/)
  assert.deepEqual(trendCoordinates([0,0.001],0.001).map(point=>point.y),[190,40])
})

test('空趋势和单点趋势保持有效 SVG 坐标', () => {
  assert.deepEqual(trendCoordinates([], 0), [])
  assert.equal(trendLine([]), '')
  assert.equal(trendArea([]), '')
  const point = trendCoordinates([5], 0)
  assert.deepEqual(point, [{ x: 320, y: 40 }])
  assert.ok(!trendArea(point).includes('NaN'))
})

test('两条趋势共用纵轴，横轴从左到右且面积闭合', () => {
  const low = trendCoordinates([0, 10, 20], 40)
  const high = trendCoordinates([20, 30, 40], 40)
  assert.deepEqual(low.map((point) => point.x), [28, 320, 612])
  assert.ok(high[0].y < low[0].y)
  assert.match(trendLine(high), /^28,115 /)
  assert.match(trendArea(high), /^M 28 190 L /)
  assert.match(trendArea(high), / L 612 190 Z$/)
})

test('月趋势刻度对齐实际日期坐标，末两天不重叠',()=>{
  const dates=Array.from({length:30},(_,index)=>`2026-09-${String(index+1).padStart(2,'0')}`)
  const ticks=trendTicks(dates)
  assert.deepEqual(ticks.map(item=>item.label),['09-01','09-08','09-15','09-22','09-30'])
  assert.equal(ticks[1].x,28+7*584/29)
  assert.equal(ticks.at(-1).x,612)
  assert.equal(trendTicks(dates.slice(0,7)).length,7)
  assert.deepEqual(trendTicks([]),[])
})

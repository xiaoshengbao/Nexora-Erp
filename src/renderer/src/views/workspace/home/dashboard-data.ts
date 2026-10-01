import type {DashboardAmount, DashboardResult} from '../../../../../shared/dashboard-api'

export interface DashboardMetric {
  label: string; value: string; unit: string; change: string; note: string
  tone: 'teal'|'blue'|'amber'|'rose'
}
function cents(value: string): bigint {
  const negative=value.startsWith('-'), [whole,fraction='']=value.replace(/^-/,'').split('.')
  const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0').slice(0,2))
  return negative ? -result : result
}
// 展示不先转成浮点数，累计大额仍保留分位；曲线坐标才使用近似数值。
export function formatDashboardMoney(value:string|null):string {
  if(value===null)return '待定价'
  const amount=cents(value), absolute=amount<0n ? -amount : amount
  return `${amount<0n?'-':''}${(absolute/100n).toLocaleString('zh-CN')}.${String(absolute%100n).padStart(2,'0')}`
}
export function dashboardChange(current:DashboardAmount,previous:DashboardAmount):string {
  if(current.amount===null || previous.amount===null)return '缺价，暂不比较'
  const before=cents(previous.amount),after=cents(current.amount)
  if(before<=0n)return before===0n && after===0n ? '两期均无净额' : '上期净额非正，暂不比较'
  const change=after-before,absolute=change<0n ? -change : change
  const tenths=(absolute*1000n+before/2n)/before
  return `${change<0n?'-':change>0n?'+':''}${tenths/10n}.${tenths%10n}%`
}
export function dashboardMetrics(result:DashboardResult):DashboardMetric[] {
  const metrics:DashboardMetric[]=[]
  for(const [key,label,tone] of [['sales','销售业务净额','teal'],['purchase','采购业务净额','blue']] as const){
    const group=result.finance?.[key]
    metrics.push({label,value:group?formatDashboardMoney(group.current.amount):'未授权',unit:group?'元':'',
      change:group?dashboardChange(group.current,group.previous):'需财务查看权限',
      note:!group?'未读取金额':group.current.unpriced_count?`${group.current.unpriced_count} 行缺价 · 已定价部分 ${formatDashboardMoney(group.current.known_amount)} 元`:'较前一个等长期间',tone})
  }
  const pending=[result.sales,result.purchase].filter(item=>item!==null)
  metrics.push({label:'待处理订单',value:pending.length?String(pending.reduce((sum,item)=>sum+item.draft+item.waiting,0)):'未授权',
    unit:pending.length?'单':'',change:pending.length?'当前状态':'需采购或销售查看权限',
    note:'有权查看的采购与销售 · 草稿及未收发完订单',tone:'amber'})
  metrics.push({label:'有库存的仓库物料组合',value:result.inventory?String(result.inventory.positive_positions):'未授权',unit:result.inventory?'项':'',
    change:result.inventory?`${result.inventory.stocked_materials} 种物料`:'需库存查看权限',note:'当前数量大于零 · 不混加不同计量单位',tone:'rose'})
  return metrics
}
const colors:Record<string,string>={shipment:'#35b8aa',receipt:'#5f9de8',production_completion:'#eab867',transfer:'#a3a8e8'}
export function dashboardComposition(items:DashboardResult['composition']) {
  const total=items.reduce((sum,item)=>sum+item.count,0)
  return items.map(item=>({...item,percent:total?item.count/total*100:0,color:colors[item.key]}))
}
export function dashboardSourceLabel(type:string):string {
  const labels:Record<string,string>={shipment:'销售出库',shipment_reversal:'销售出库冲销',sales_return:'销售退货',sales_return_reversal:'销售退货冲销',
    receipt:'采购入库',receipt_reversal:'采购入库冲销',purchase_return:'采购退货',purchase_return_reversal:'采购退货冲销',after_sales_repair:'维修服务费',after_sales_repair_reversal:'维修服务费更正'}
  return labels[type]??type
}
export function trendCoordinates(values:readonly number[],maxValue:number,minValue=0):{x:number;y:number}[] {
  const floor=Math.min(0,minValue),ceiling=maxValue>floor?maxValue:floor+1
  return values.map((value,index)=>({x:values.length===1?320:28+index*584/(values.length-1),y:190-(Math.min(ceiling,Math.max(floor,value))-floor)/(ceiling-floor)*150}))
}
export function trendLine(points:readonly {x:number;y:number}[]):string {return points.map(point=>`${point.x},${point.y}`).join(' ')}
export function trendTicks(dates:readonly string[]):{label:string;x:number}[] {
  // 月视图末两天距离过近时省略倒数刻度，日期始终对齐真实数据坐标。
  const last=dates.length-1
  return dates.flatMap((date,index)=>index===0||index===last||(dates.length<=7||index%7===0&&last-index>=4)
    ? [{label:date.slice(5),x:last===0?320:28+index*584/last}] : [])
}
export function trendArea(points:readonly {x:number;y:number}[],baseline=190):string {
  if(!points.length)return ''
  return `M ${points[0].x} ${baseline} L ${points.map(point=>`${point.x} ${point.y}`).join(' L ')} L ${points[points.length-1].x} ${baseline} Z`
}

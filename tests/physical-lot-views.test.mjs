import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createSSRApp,h} from 'vue'
import {renderToString} from '@vue/server-renderer'
import {createPinia} from 'pinia'
import {createRouter,createMemoryHistory} from 'vue-router'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'

const storeModule=`import {defineStore} from 'pinia';import {ref} from 'vue';
export const usePiniaAppStore=defineStore('physical-lot-ui-test',()=>(()=>{
const lotOverview=ref(null),lotHistory=ref(null),lotLoading=ref(false),lotError=ref('');
const lotWarehouseId=ref(0),lotMaterialId=ref(0),warehouses=ref([{id:1,code:'MAIN',name:'主仓库'}]);
const materials=ref([{id:3,sku:'LOT-3',name:'试件'}]),busy=ref(false),connectionLost=ref(false),user=ref({id:1,permissions:['inventory.view']});
const ledgerQuery=ref({warehouse_id:null,material_id:null,from_date:'',to_date:'',source_type:null});
const allowed=ref(true);return {lotOverview,lotHistory,lotLoading,lotError,lotWarehouseId,lotMaterialId,
  warehouses,materials,busy,connectionLost,user,ledgerQuery,allowed,
  can(code){return code==='inventory.view'&&allowed.value},localTime:value=>value,
  loadPhysicalLots(){},loadPhysicalLotHistory(){},clearPhysicalLotHistory(){}};
})());`

test('批次页面显示历史未识别、未分配差额、来源流水及无权状态',async t=>{
  const server=await createServer({configFile:false,plugins:[{name:'physical-lot-view-fixture',enforce:'pre',resolveId(id,importer){
    if(importer?.includes('/views/workspace/warehouse/PhysicalLotsView') && id.endsWith('/store/app-store'))return '\0lot-view-store'
    if(id.endsWith('/WorkspaceTable.vue'))return '\0lot-view-table'
    if(id.endsWith('/WorkspaceSelect.vue'))return '\0lot-view-select'
  },load(id){if(id==='\0lot-view-store')return storeModule
    if(id==='\0lot-view-table')return `import {defineComponent,h} from 'vue';export default defineComponent({props:{data:Array},setup(props,{slots}){return ()=>h('section',[slots.filters?.(),slots.beforeTable?.(),...(props.data??[]).flatMap(row=>Object.entries(slots).filter(([key])=>key.startsWith('cell-')).map(([,slot])=>slot?.({row}))),slots.empty?.()])}})`
    if(id==='\0lot-view-select')return `import {defineComponent,h} from 'vue';export default defineComponent({setup(){return ()=>h('span')}})`
  }},vue()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'})
  t.after(()=>server.close())
  const {usePiniaAppStore}=await server.ssrLoadModule('\0lot-view-store')
  const pinia=createPinia(),store=usePiniaAppStore(pinia)
  const router=createRouter({history:createMemoryHistory(),routes:[
    {path:'/',component:{render:()=>null}},
    {path:'/workspace/inventory-ledger',component:{render:()=>null}}]})
  await router.push('/');await router.isReady()
  const {default:Component}=await server.ssrLoadModule('/src/renderer/src/views/workspace/warehouse/PhysicalLotsView.vue')
  const render=()=>renderToString(createSSRApp({render:()=>h(Component)}).use(pinia).use(router))
  const row={warehouse_id:1,warehouse_name:'主仓库',material_id:3,sku:'LOT-3',material_name:'试件',unit:'件',
    lot_id:7,lot_code:'LEGACY-W1-M3',source_kind:'legacy',supplier_lot:null,manufactured_on:null,expires_on:null,quantity:'2.000'}
  store.lotOverview={as_of:'2026-10-02 09:00:00',warehouse_id:null,material_id:null,rows:[row],
    differences:[{warehouse_id:1,warehouse_name:'主仓库',material_id:3,sku:'LOT-3',stock_quantity:'2.125',lot_quantity:'2.000',difference:'0.125'}],fully_allocated:false}
  const unallocated=await render()
  assert.match(unallocated,/历史未识别/)
  assert.match(unallocated,/未分配差额/)
  assert.match(unallocated,/0\.125/)
  assert.match(unallocated,/也不代表所有历史流水已追溯/)
  store.lotHistory={as_of:'2026-10-02 09:00:00',lot:{id:7,material_id:3,code:'LEGACY-W1-M3',source_kind:'legacy',
    supplier_lot:null,manufactured_on:null,expires_on:null,origin_movement_id:null,
    sku:'LOT-3',material_name:'试件',unit:'件'},
    openings:[{id:1,warehouse_id:1,warehouse_name:'主仓库',quantity:'2.000',checkpoint_movement_id:8,
      evidence:'无实物批次证据',created_at:'2026-10-02 09:00:00'}],
    movements:[{id:2,movement_id:9,warehouse_id:1,warehouse_name:'主仓库',quantity:'-0.125',
      source_type:'other_outbound',source_id:4,source_line_id:5,created_by_name:'admin',created_at:'2026-10-02 09:01:00',original_allocation_id:null}],
    balances:[{warehouse_id:1,warehouse_name:'主仓库',quantity:'1.875'}]}
  const traced=await render()
  assert.match(traced,/升级检查点流水 #8/)
  assert.match(traced,/库存流水 #9/)
  assert.match(traced,/无实物批次证据/)
  store.connectionLost=true
  assert.match(await render(),/旧批次余额与来源证据已失效/)
  store.allowed=false
  const denied=await render()
  assert.match(denied,/没有库存查看权限/)
  assert.doesNotMatch(denied,/未分配差额/)
})

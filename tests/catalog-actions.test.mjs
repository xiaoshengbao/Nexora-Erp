import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWarehouseActions } from '../src/renderer/src/store/modules/warehouse-actions.ts'
import { ref } from 'vue'
import { createCatalogActions } from '../src/renderer/src/store/modules/catalog-actions.ts'

test('基础资料写操作传递普通对象，保存失败保留编辑状态，绑定和解绑使用独立操作', async (t) => {
  const original = globalThis.window
  t.after(() => { globalThis.window = original })
  const calls = []
  let fail = false
  globalThis.window = { nexora: { async callApi(action, payload) {
    if (fail) throw new Error('conflict')
    calls.push([action, structuredClone(payload)])
  } } }
  const actions = createCatalogActions({ materialForm: ref({}), supplierForm: ref({}) }, async action => {
    try { await action() } catch { /* 与统一反馈入口一致，失败后保留表单。 */ }
  })
  assert.equal(await actions.saveMaterial({ sku: 'R', name: '电阻', unit: '件' }), true)
  assert.equal(await actions.saveSupplier({ name: '甲', version: 1, reason: '核对后修正' }, 3), true)
  const warehouses = createWarehouseActions({}, async action => { await action() })
  assert.equal(await warehouses.saveWarehouse({ code: 'E', name: '东仓', version: 2, reason: '更正仓库' }, 2), true)
  await actions.setSupplierMaterial(3, 4, true)
  await actions.setSupplierMaterial(3, 4, false)
  await actions.deleteMaterial(4)
  await actions.deleteSupplier(3, 1)
  await warehouses.deleteWarehouse(2, 2)
  assert.deepEqual(calls, [
    ['createMaterial', { sku: 'R', name: '电阻', unit: '件' }],
    ['updateSupplier', { name: '甲', version: 1, reason: '核对后修正', id: 3 }],
    ['updateWarehouse', { code: 'E', name: '东仓', version: 2, reason: '更正仓库', id: 2 }],
    ['bindSupplierMaterial', { supplierId: 3, materialId: 4 }],
    ['unbindSupplierMaterial', { supplierId: 3, materialId: 4 }],
    ['deleteMaterial', { id: 4 }],
    ['deleteSupplier', { id: 3, version: 1 }],
    ['deleteWarehouse', { id: 2, version: 2 }]
  ])
  fail = true
  assert.equal(await actions.saveSupplier({ name: '重复名称', version: 1, reason: '更正' }, 3), false)
  const blocked = createCatalogActions({ materialForm: ref({}), supplierForm: ref({}) }, async () => {})
  assert.equal(await blocked.saveMaterial({ sku: 'R', name: '电阻', unit: '件' }), false)
})

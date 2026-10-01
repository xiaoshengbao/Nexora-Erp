import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computed, effectScope, ref } from 'vue'
import { useLocalPagination } from '../src/renderer/src/composables/use-local-pagination.ts'

// 使用真实响应式资料验证搜索、删除和切页，确保展示分页不会改写共享名单。
test('本地分页保持完整名单，切页、调整条数和删除末页正确回退', () => {
  const scope = effectScope()
  const source = ref(Array.from({ length: 45 }, (_, index) => ({ id: index + 1 })))
  const state = scope.run(() => useLocalPagination(source, ref('')))
  try {
    assert.equal(state.total.value, 45)
    assert.equal(state.rows.value.length, 20)
    state.changePage(3, 20)
    assert.deepEqual(state.rows.value.map(row => row.id), [41, 42, 43, 44, 45])
    assert.equal(source.value.length, 45)
    source.value.splice(40)
    assert.equal(state.page.value, 2)
    assert.equal(state.rows.value[0].id, 21)
    state.changePage(4, 10)
    assert.equal(state.page.value, 1)
    assert.equal(state.rows.value.length, 10)
    state.changePage(999, 10)
    assert.equal(state.page.value, 4)
    source.value = []
    assert.equal(state.page.value, 1)
    assert.equal(state.total.value, 0)
    assert.deepEqual(state.rows.value, [])
  } finally { scope.stop() }
})

test('搜索从末页回到首页，总数跟随筛选结果，清空搜索仍从首页展示', () => {
  const scope = effectScope()
  const query = ref('')
  const source = ref(Array.from({ length: 45 }, (_, index) => ({ id: index + 1, name: `物料${index + 1}` })))
  const filtered = computed(() => source.value.filter(row => row.name.includes(query.value)))
  const state = scope.run(() => useLocalPagination(filtered, query))
  try {
    state.changePage(3, 20)
    query.value = '物料4'
    assert.equal(state.page.value, 1)
    assert.equal(state.total.value, 7)
    assert.equal(state.rows.value[0].id, 4)
    query.value = '不存在'
    assert.equal(state.total.value, 0)
    assert.deepEqual(state.rows.value, [])
    query.value = ''
    assert.equal(state.page.value, 1)
    assert.equal(state.total.value, 45)
  } finally { scope.stop() }
})

test('无效分页事件不改变当前页，非正页码回到首页', () => {
  const scope = effectScope()
  const state = scope.run(() => useLocalPagination(ref(Array.from({ length: 45 }, (_, id) => ({ id }))), ref('')))
  try {
    state.changePage(2, 20)
    for (const [page, size] of [[NaN, 20], [2, 0], [2, -1], [1.5, 20], [2, Infinity]]) {
      state.changePage(page, size)
      assert.equal(state.page.value, 2)
      assert.equal(state.pageSize.value, 20)
    }
    state.changePage(-1, 20)
    assert.equal(state.page.value, 1)
  } finally { scope.stop() }
})

import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'

// 已加载的资料只在展示时分页，保留完整 Pinia 名单供订单选项和供应商关联使用。
export function useLocalPagination<T>(source: Readonly<Ref<T[]>>, query: Readonly<Ref<string>>) {
  const page = ref(1)
  const pageSize = ref(20)
  const total = computed(() => source.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const rows = computed(() => source.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

  // 搜索回到第一页；删除末页记录后回退到有效页，避免出现有资料却显示空表的情况。
  watch(query, () => { page.value = 1 }, { flush: 'sync' })
  watch(pageCount, count => { page.value = Math.min(page.value, count) }, { flush: 'sync' })

  function changePage(targetPage: number, targetSize: number): void {
    // 忽略无效事件，防止非法页码或每页条数产生空切片。
    if (!Number.isInteger(targetPage) || !Number.isInteger(targetSize) || targetSize <= 0) return
    const resized = targetSize !== pageSize.value
    pageSize.value = targetSize
    page.value = resized ? 1 : Math.max(1, Math.min(targetPage, pageCount.value))
  }

  return { rows, total, page, pageSize, changePage }
}

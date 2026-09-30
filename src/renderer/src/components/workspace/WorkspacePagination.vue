<script setup lang="ts">
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../app/AppButton.vue'
// 下拉选择统一使用工作台组件，业务值与切换回调保持原有类型。
import WorkspaceSelect from './WorkspaceSelect.vue'
import { computed } from 'vue'

// 页码以服务端返回值为准；底部计数与操作控件在同一行垂直居中。
const props = defineProps<{ page: number; pageSize: number; total: number; disabled?: boolean }>()
const emit = defineEmits<{ change: [page: number, pageSize: number] }>()
const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const pages = computed(() => {
  const start = Math.max(1, Math.min(props.page - 2, pageCount.value - 4))
  return Array.from({ length: Math.min(5, pageCount.value) }, (_, index) => start + index)
})
function resize(size: number): void {
  // 公共选择组件直接返回数字，调整每页条数后仍从第一页查询。
  emit('change', 1, size)
}
</script>

<template>
  <nav class="workspace-pagination" aria-label="表格分页">
    <span class="pagination-total" role="status"
      >共 <strong>{{ total }}</strong> 条</span
    >
    <div class="pagination-controls">
      <label class="pagination-size"
        >每页<WorkspaceSelect
          :model-value="pageSize"
          :disabled="disabled"
          aria-label="每页条数"
          size="small"
          :filterable="false"
          @change="resize"
          :options="[
            ...[10, 20, 50, 100].map((size) => ({ label: (size + ' 条').trim(), value: size }))
          ]"
      /></label>
      <AppButton
        type="button"
        :disabled="disabled || page <= 1"
        aria-label="上一页"
        @click="emit('change', page - 1, pageSize)"
        variant="secondary"
        >上一页</AppButton
      >
      <AppButton
        v-for="number in pages"
        :key="number"
        type="button"
        :disabled="disabled"
        :aria-label="`第 ${number} 页`"
        :aria-current="number === page ? 'page' : undefined"
        @click="emit('change', number, pageSize)"
        class="page-number"
        :variant="number === page ? 'primary' : 'secondary'"
        >{{ number }}</AppButton
      >
      <AppButton
        type="button"
        :disabled="disabled || page >= pageCount"
        aria-label="下一页"
        @click="emit('change', page + 1, pageSize)"
        variant="secondary"
        >下一页</AppButton
      >
      <span class="pagination-position">{{ page }} / {{ pageCount }} 页</span>
    </div>
  </nav>
</template>

<style scoped>
/* 总数从搜索区移到底部；小屏允许换行，但保持每组控件居中对齐。 */
.workspace-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid #e4ebee;
  color: #718399;
  font-size: 13px;
}
.pagination-total {
  white-space: nowrap;
}
.pagination-total strong {
  color: #40566e;
  font-weight: 600;
}
.pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
.pagination-size {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 8px;
}
.pagination-size .workspace-select {
  width: 96px;
}
.pagination-controls button {
  min-height: 34px;
  padding: 6px 10px;
  font-size: 13px;
}
.page-number {
  min-width: 34px;
}
.pagination-position {
  margin-left: 4px;
  white-space: nowrap;
}
:root[data-theme='dark'] .workspace-pagination {
  border-color: #30445b;
  color: #9cb0c7;
}
:root[data-theme='dark'] .pagination-total strong {
  color: #dce8f5;
}
@media (max-width: 650px) {
  .pagination-controls {
    justify-content: flex-start;
  }
}
</style>

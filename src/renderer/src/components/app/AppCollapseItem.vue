<script setup lang="ts">
import { useId } from 'vue'
import { NCollapseItem } from 'naive-ui'
import AppButton from './AppButton.vue'

// Naive UI 负责展开状态和动画，公共按钮补上 Tab、Enter、空格与读屏语义。
withDefaults(defineProps<{
  name: string | number
  title: string
  disabled?: boolean
}>(), { disabled: false })
const contentId = useId()
</script>

<template>
  <!-- 与原生 details 一样保留已挂载内容，收起目录不会清掉内部展开状态与输入草稿。 -->
  <NCollapseItem :name="name" :disabled="disabled" display-directive="show">
    <template #header="{ collapsed }">
      <!-- 点击由 Naive UI 的标题区域统一接收，键盘触发的点击同样只切换一次。 -->
      <AppButton
        class="app-collapse-trigger"
        variant="plain"
        :disabled="disabled"
        :aria-expanded="!collapsed"
        :aria-controls="contentId"
      >{{ title }}</AppButton>
    </template>
    <div :id="contentId" role="region" :aria-label="title"><slot /></div>
  </NCollapseItem>
</template>

<style scoped>
/* 长中文标题在窄窗口换行，完整标题仍是可聚焦的点击区域。 */
.app-collapse-trigger {
  flex: 1;
  min-width: 0;
  padding: 3px 4px;
  justify-content: flex-start;
  text-align: left;
  white-space: normal;
  line-height: 1.5;
}
</style>

<script setup lang="ts">
// 公共界面文案随语言偏好即时更新，不影响输入草稿。
import { useSettingsStore } from '../../store/settings-store'
const { t } = useSettingsStore()

// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../app/AppButton.vue'
import { useAppStore } from '../../store/app-store'
import IconCloseLine from '~icons/ri/close-line'

// 标签栏只渲染当前会话已打开的路由；关闭规则由路由模块统一决定。
const { activeTab, openedTabs, navigateToRoute, closeOpenedRoute } =
  useAppStore()
</script>

<template>
  <nav class="workspace-tabs" :aria-label="t('已打开页面')">
    <div
      v-for="item in openedTabs"
      :key="item.key"
      class="workspace-tab"
      :class="{ active: activeTab === item.key }"
    >
      <AppButton
        type="button"
        :aria-current="activeTab === item.key ? 'page' : undefined"
        @click="navigateToRoute(item.key)"
        class="workspace-tab-link"
        variant="plain"
      >
        {{ t(item.label) }}
      </AppButton>
      <AppButton
        v-if="openedTabs.length > 1"
        type="button"
        :aria-label="t('关闭{page}', { page: t(item.label) })"
        @click="closeOpenedRoute(item.key)"
        class="workspace-tab-close"
        variant="plain"
      >
        <IconCloseLine aria-hidden="true" />
      </AppButton>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import IconSettings3Line from '~icons/ri/settings-3-line'
import AppButton from './AppButton.vue'
import { useSettingsStore } from '../../store/settings-store'

// 所有外壳共享入口状态，根组件只挂载一份设置抽屉。
const settings = useSettingsStore()
const { settingsOpen } = storeToRefs(settings)
const { t, openSettings } = settings
</script>

<template>
  <AppButton class="app-settings-button" type="button" variant="secondary" size="small" quaternary circle
    :aria-label="t('打开设置')" :title="t('打开设置')" aria-haspopup="dialog"
    aria-controls="app-settings-panel" :aria-expanded="settingsOpen" @click="openSettings">
    <template #icon><IconSettings3Line aria-hidden="true" /></template>
  </AppButton>
</template>

<style scoped>
/* 设置按钮必须排除原生窗口拖动，鼠标与键盘都能正常打开。 */
.app-settings-button { -webkit-app-region: no-drag; }
</style>

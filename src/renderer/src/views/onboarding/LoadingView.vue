<script setup lang="ts">
// 公共界面文案随语言偏好即时更新，不影响输入草稿。
import { useSettingsStore } from '../../store/settings-store'
const { t } = useSettingsStore()
</script>
<template>
  <section class="onboard-panel loading-panel">
    <div class="scan-orbit"></div>
    <h2>{{ t("正在检查上次连接…") }}</h2>
  </section>
</template>

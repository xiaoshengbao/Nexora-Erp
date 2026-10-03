<script setup lang="ts">
// 公共界面文案随语言偏好即时更新，不影响输入草稿。
import { useSettingsStore } from '../../store/settings-store'
const { t } = useSettingsStore()

import { computed } from 'vue'
import { useAppStore } from '../../store/app-store'
import { resolveFooterStatus } from '../../utils/footer-status'

const { screen, server, connectionLost, connectionNotice, error, notice, busy } = useAppStore()
const status = computed(() => resolveFooterStatus({
  screen: screen.value,
  server: server.value,
  connectionLost: connectionLost.value,
  connectionNotice: connectionNotice.value,
  error: error.value,
  notice: notice.value,
  busy: busy.value
}))
</script>

<template>
  <footer class="onboard-footer app-status-footer">
    <!-- 服务端身份固定在左边；尚未选择服务端时不借用客户端版本冒充服务端版本。 -->
    <span class="app-footer-server" :title="server ? `${server.name} · v${server.version}` : t('未选择服务端')">
      {{ server?.name || t('未选择服务端') }}<template v-if="server?.version"> · v{{ server.version }}</template>
    </span>
    <span
      class="onboard-footer-status"
      :class="`is-${status.tone}`"
      :role="status.tone === 'error' ? 'alert' : 'status'"
      :title="t(status.message)"
    >
      <span class="onboard-footer-status-text">{{ t(status.message) }}</span>
    </span>
  </footer>
</template>

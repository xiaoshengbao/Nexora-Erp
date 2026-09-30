<script setup lang="ts">
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../components/app/AppButton.vue'
import { useAppStore } from '../../store/app-store'
import IconErrorWarningLine from '~icons/ri/error-warning-line'

// 此页面只处理当前引导阶段的展示和输入，连接操作由共享状态管理。
const { busy, server, host, checkConnection, switchServer, restartLocalHost } =
  useAppStore()
</script>

<template>
  <section class="onboard-panel offline-panel">
    <span class="offline-symbol"><IconErrorWarningLine aria-hidden="true" /></span>
    <h2>{{ server?.name || '服务端' }} · 暂时无法连接</h2>
    <p>服务端可能未启动、网络不可达或证书发生变化。重新连接前请确认服务端身份。</p>
    <div class="onboard-actions">
      <AppButton type="button" :disabled="busy" @click="checkConnection" variant="primary">
        重试连接</AppButton
      ><AppButton
        v-if="host.configured && !host.running"
        type="button"
        :disabled="busy"
        @click="restartLocalHost"
        variant="secondary"
      >
        启动本机服务</AppButton
      ><AppButton type="button" @click="switchServer" variant="secondary"> 切换服务端 </AppButton>
    </div>
  </section>
</template>

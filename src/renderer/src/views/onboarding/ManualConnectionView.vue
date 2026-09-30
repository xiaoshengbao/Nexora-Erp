<script setup lang="ts">
// 输入框统一外观，必填、长度与数字范围仍由真实输入元素校验。
import AppInput from '../../components/app/AppInput.vue'
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../components/app/AppButton.vue'
import { useAppStore } from '../../store/app-store'
import IconArrowRightUpLine from '~icons/ri/arrow-right-up-line'
import IconHistoryLine from '~icons/ri/history-line'

// 此页面只处理当前引导阶段的展示和输入，连接操作由共享状态管理。
const {
  busy,
  server,
  recentServers,
  manualForm,
  host,
  go,
  connectManual,
  connectSaved
} = useAppStore()
</script>

<template>
  <section class="onboard-columns">
    <form class="onboard-panel onboard-form" @submit.prevent="connectManual">
      <div class="panel-heading">
        <span class="panel-icon"><IconArrowRightUpLine aria-hidden="true" /></span>
        <div>
          <h2>服务端地址</h2>
          <p>只支持本机和局域网地址，连接将使用 HTTPS。</p>
        </div>
      </div>
      <label
        >IP 地址或主机名<AppInput
          v-model.trim="manualForm.address"
          required
          placeholder="例如 192.168.1.100"
          autocomplete="off" /></label
      ><label
        >端口<AppInput v-model.number="manualForm.port" type="number" min="1" max="65535" required
      /></label>
      <div class="onboard-actions">
        <AppButton type="button" @click="go('welcome')" variant="secondary"> 返回首页</AppButton
        ><AppButton type="submit" :disabled="busy" variant="primary">
          {{ busy ? '正在检查…' : '检查并连接' }}
        </AppButton>
      </div>
    </form>
    <div class="onboard-panel">
      <div class="panel-heading">
        <span class="panel-icon"><IconHistoryLine aria-hidden="true" /></span>
        <div>
          <h2>最近连接</h2>
          <p>仅保存地址和已核对的证书，不保存密码。</p>
        </div>
      </div>
      <div v-if="!recentServers.length" class="onboard-empty">
        还没有连接记录。可以填写地址，或扫描局域网。
      </div>
      <AppButton
        v-for="entry in recentServers"
        :key="entry.id"
        type="button"
        :disabled="busy"
        @click="connectSaved(entry)"
        class="server-row"
        variant="plain"
      >
        <span
          ><strong>{{ entry.name }}</strong
          ><small>{{ entry.host }}:{{ entry.port }}</small></span
        ><span class="server-row-action">连接 →</span>
      </AppButton>
    </div>
  </section>
</template>

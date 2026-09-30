<script setup lang="ts">
// 身份确认使用统一勾选控件，勾选值仍决定连接入口是否可用。
import { NCheckbox } from 'naive-ui'
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../components/app/AppButton.vue'
import { useAppStore } from '../../store/app-store'

// 此页面只处理当前引导阶段的展示和输入，连接操作由共享状态管理。
const { busy, candidate, trustChecked, host, go, approveTrust } = useAppStore()
</script>

<template>
  <section v-if="candidate" class="onboard-panel trust-panel">
    <span class="trust-icon">◇</span>
    <h2>
      {{ candidate.changed ? '服务端证书已变化' : '首次连接，需要确认身份' }}
    </h2>
    <p>
      请到服务端电脑的“服务端已就绪”页面，核对以下完整 SHA-256
      指纹。不要只凭本页面显示的名称判断身份。
    </p>
    <div class="fingerprint">{{ candidate.fingerprint }}</div>
    <p class="muted">{{ candidate.name }} · {{ candidate.host }}:{{ candidate.port }}</p>
    <NCheckbox v-model:checked="trustChecked" class="trust-check">
      我已通过服务端电脑或可信渠道核对完整指纹
    </NCheckbox>
    <div class="onboard-actions">
      <AppButton type="button" @click="go('manual')" variant="secondary">取消</AppButton
      ><AppButton
        type="button"
        :disabled="!trustChecked || busy"
        @click="approveTrust"
        variant="primary"
      >
        确认身份并连接
      </AppButton>
    </div>
  </section>
</template>

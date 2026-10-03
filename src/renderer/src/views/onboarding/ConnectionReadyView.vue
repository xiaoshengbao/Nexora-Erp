<script setup lang="ts">
// 公共界面文案随语言偏好即时更新，不影响输入草稿。
import { useSettingsStore } from '../../store/settings-store'
const { t } = useSettingsStore()

// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../components/app/AppButton.vue'
import { useAppStore } from '../../store/app-store'
import IconServerLine from '~icons/ri/server-line'
import IconCheckboxCircleLine from '~icons/ri/checkbox-circle-line'

// 此页面只处理当前引导阶段的展示和输入，连接操作由共享状态管理。
const { server, host, go, switchServer } = useAppStore()
</script>

<template>
  <section v-if="server" class="onboard-columns ready-columns">
    <div class="onboard-panel ready-primary">
      <div class="ready-symbol">
        <IconCheckboxCircleLine aria-hidden="true" />
      </div>
      <p class="onboard-kicker">CONNECTION READY</p>
      <h2>{{ server.isLocal ? t('本机服务已启动') : t('连接已建立') }}</h2>
      <p>{{ t("使用服务端账号登录后，就可以进入 ERP 工作台。") }}</p>
      <div class="onboard-actions">
        <AppButton type="button" @click="go('login')" variant="primary">{{ t("进入登录 →") }}</AppButton
        ><AppButton type="button" @click="switchServer" variant="secondary">{{ t("切换服务端") }}</AppButton>
      </div>
    </div>
    <div class="onboard-panel">
      <div class="panel-heading">
        <span class="panel-icon"><IconServerLine aria-hidden="true" /></span>
        <div>
          <h2>{{ t("当前服务端") }}</h2>
          <p>{{ t("连接信息与身份核验") }}</p>
        </div>
      </div>
      <dl class="server-details">
        <div>
          <dt>{{ t("名称") }}</dt>
          <dd>{{ server.name }}</dd>
        </div>
        <div>
          <dt>{{ t("地址") }}</dt>
          <dd>{{ server.host }}:{{ server.port }}</dd>
        </div>
        <div>
          <dt>{{ t("版本") }}</dt>
          <dd>v{{ server.version }}</dd>
        </div>
        <div>
          <dt>{{ t("状态") }}</dt>
          <dd class="online">{{ t("运行中") }}</dd>
        </div>
      </dl>
      <template v-if="server.isLocal"
        ><p class="fingerprint-label">{{ t("请将此指纹提供给需要连接的团队成员核对：") }}</p>
        <div class="fingerprint compact">
          {{ server.fingerprint }}
        </div></template
      >
    </div>
  </section>
</template>

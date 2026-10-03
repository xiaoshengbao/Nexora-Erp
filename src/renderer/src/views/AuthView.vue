<script setup lang="ts">
// 公共界面文案随语言偏好即时更新，不影响输入草稿。
import { useSettingsStore } from '../store/settings-store'
const { t } = useSettingsStore()

// 输入框统一外观，必填、长度与数字范围仍由真实输入元素校验。
import AppInput from '../components/app/AppInput.vue'
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../components/app/AppButton.vue'
import { useAppStore } from '../store/app-store'

// 管理员初始化和正常登录共用凭据表单，提交分支由当前阶段判断。
const {
  screen,
  server,
  username,
  password,
  busy,
  connectionLost,
  authenticate,
  switchServer
} = useAppStore()
</script>

<template>
  <section class="card auth-card">
    <p class="eyebrow">{{ screen === 'setup' ? t('首次使用') : t('欢迎回来') }}</p>
    <h2>{{ screen === 'setup' ? t('创建首位管理员') : t('登录工作台') }}</h2>
    <p class="muted">
      {{
        screen === 'setup'
          ? t('管理员可以创建用户并分配角色。请设置至少 12 位的密码。')
          : t('使用 {server} 的账号访问采购、库存与用户权限。', { server: server?.name || t('当前服务端') })
      }}
    </p>
    <form @submit.prevent="authenticate">
      <label
        >{{ t("用户名") }}<AppInput
          v-model.trim="username"
          autocomplete="username"
          minlength="3"
          maxlength="40"
          required
          :placeholder="t('例如 admin')"
      /></label>
      <label
        >{{ t("密码") }}<AppInput
          v-model="password"
          type="password"
          :autocomplete="screen === 'setup' ? 'new-password' : 'current-password'"
          :minlength="screen === 'setup' ? 12 : undefined"
          required
          :placeholder="t('输入密码')"
      /></label>
      <AppButton type="submit" :disabled="busy || connectionLost" variant="primary">
        {{ busy ? t('请稍候…') : screen === 'setup' ? t('创建管理员') : t('登录') }}
      </AppButton>
    </form>
    <AppButton type="button" @click="switchServer" class="auth-switch" variant="text">{{ t("切换服务端") }}</AppButton>
  </section>
</template>

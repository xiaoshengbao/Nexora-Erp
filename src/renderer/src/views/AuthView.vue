<script setup lang="ts">
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
    <p class="eyebrow">{{ screen === 'setup' ? '首次使用' : '欢迎回来' }}</p>
    <h2>{{ screen === 'setup' ? '创建首位管理员' : '登录工作台' }}</h2>
    <p class="muted">
      {{
        screen === 'setup'
          ? '管理员可以创建用户并分配角色。请设置至少 12 位的密码。'
          : `使用 ${server?.name || '当前服务端'} 的账号访问采购、库存与用户权限。`
      }}
    </p>
    <form @submit.prevent="authenticate">
      <label
        >用户名<AppInput
          v-model.trim="username"
          autocomplete="username"
          minlength="3"
          maxlength="40"
          required
          placeholder="例如 admin"
      /></label>
      <label
        >密码<AppInput
          v-model="password"
          type="password"
          :autocomplete="screen === 'setup' ? 'new-password' : 'current-password'"
          :minlength="screen === 'setup' ? 12 : undefined"
          required
          placeholder="输入密码"
      /></label>
      <AppButton type="submit" :disabled="busy || connectionLost" variant="primary">
        {{ busy ? '请稍候…' : screen === 'setup' ? '创建管理员' : '登录' }}
      </AppButton>
    </form>
    <AppButton type="button" @click="switchServer" class="auth-switch" variant="text">
      切换服务端
    </AppButton>
  </section>
</template>

<script setup lang="ts">
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../components/app/AppButton.vue'
import { useAppStore } from '../../store/app-store'

// 此页面只处理当前引导阶段的展示和输入，连接操作由共享状态管理。
const { discoveries, scanSeconds, scanning, go, startScan, showResults } =
  useAppStore()
</script>

<template>
  <section class="onboard-panel scan-panel">
    <div class="scan-visual">
      <div class="scan-orbit"><span class="scan-core">N</span></div>
    </div>
    <div class="scan-copy">
      <p class="onboard-kicker">LIVE DISCOVERY</p>
      <h2>已扫描 {{ scanSeconds }} 秒</h2>
      <p>发现 {{ discoveries.length }} 个可用服务端。结果会随着网络变化更新。</p>
      <div class="scan-live">
        <span class="status-dot"></span>{{ scanning ? '正在发现' : '已暂停' }}
      </div>
    </div>
    <div class="onboard-actions scan-actions">
      <AppButton type="button" @click="go('welcome')" variant="secondary"> 返回首页</AppButton
      ><AppButton type="button" @click="showResults" variant="secondary"> 暂停并查看结果</AppButton
      ><AppButton type="button" @click="startScan" variant="primary"> 重新扫描 </AppButton>
    </div>
  </section>
</template>

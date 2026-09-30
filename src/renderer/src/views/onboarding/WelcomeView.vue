<script setup lang="ts">
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../components/app/AppButton.vue'
import { useAppStore } from '../../store/app-store'
import IconArrowRightUpLine from '~icons/ri/arrow-right-up-line'
import IconRadarLine from '~icons/ri/radar-line'
import IconServerLine from '~icons/ri/server-line'

// 此页面只处理当前引导阶段的展示和输入，连接操作由共享状态管理。
const { go, startScan } = useAppStore()
</script>

<template>
  <section class="choice-grid" aria-label="启动方式">
    <!-- 启动方式保留文字说明，Remix Icon 只作为辅助视觉标记。 -->
    <AppButton type="button" @click="go('manual')" class="choice-card" variant="plain">
      <span class="choice-index">01 / CONNECT</span
      ><span class="choice-symbol"><IconArrowRightUpLine aria-hidden="true" /></span
      ><strong>连接服务端</strong><span>知道地址时直接填写，也可以选择最近使用过的服务端。</span
      ><em>填写连接信息 <span aria-hidden="true">→</span></em>
    </AppButton>
    <AppButton type="button" @click="startScan" class="choice-card featured" variant="plain">
      <span class="choice-index">02 / DISCOVER</span
      ><span class="choice-symbol radar-symbol"><IconRadarLine aria-hidden="true" /></span
      ><strong>扫描局域网</strong><span>自动发现同一网络中的服务端，再核对身份并连接。</span
      ><em>开始扫描 <span aria-hidden="true">→</span></em>
    </AppButton>
    <AppButton type="button" @click="go('create')" class="choice-card" variant="plain">
      <span class="choice-index">03 / HOST</span
      ><span class="choice-symbol"><IconServerLine aria-hidden="true" /></span
      ><strong>新建服务端</strong><span>在这台电脑上创建服务端，供团队在局域网中使用。</span
      ><em>开始创建 <span aria-hidden="true">→</span></em>
    </AppButton>
  </section>
</template>

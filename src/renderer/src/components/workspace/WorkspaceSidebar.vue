<script setup lang="ts">
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../app/AppButton.vue'
import { useAppStore } from '../../store/app-store'
import { nexoraLogo } from '../../assets/brand'
import IconArrowDownSLine from '~icons/ri/arrow-down-s-line'
import SidebarAccountCard from './SidebarAccountCard.vue'

// 侧栏只负责导航展示，权限过滤和当前路由来自共享 store。
const {
  screen,
  server,
  activeTab,
  expandedGroupKey,
  user,
  visibleGroups,
  toggleRouteGroup,
  navigateToRoute
} = useAppStore()
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark"><img :src="nexoraLogo" alt="" /></span>
      <div>
        <strong>NEXORA</strong
        ><small>联光 ERP · {{ server?.isLocal ? '本机服务' : '团队工作台' }}</small>
      </div>
    </div>
    <div v-if="screen === 'app'" class="side-group">
      <div v-for="group in visibleGroups" :key="group.key" class="nav-group">
        <!-- 首页是固定入口，无须先展开分类才能找到可视化面板。 -->
        <AppButton
          v-if="group.key === 'home'"
          :class="{ active: activeTab === 'home' }"
          type="button"
          :aria-current="activeTab === 'home' ? 'page' : undefined"
          @click="navigateToRoute('home')"
          class="nav-item nav-home"
          variant="plain"
        >
          <component :is="group.routes[0].icon" class="nav-icon" aria-hidden="true" />
          {{ group.routes[0].label }}
        </AppButton>
        <template v-else>
          <AppButton
            :class="{
              current: group.routes.some((item) => item.key === activeTab)
            }"
            type="button"
            :aria-expanded="expandedGroupKey === group.key"
            :aria-controls="`route-group-${group.key}`"
            @click="toggleRouteGroup(group.key)"
            class="side-category"
            variant="plain"
          >
            <span class="category-label">
              <component :is="group.icon" class="nav-icon" aria-hidden="true" />
              {{ group.label }} </span
            ><IconArrowDownSLine
              class="category-chevron"
              :class="{ expanded: expandedGroupKey === group.key }"
              aria-hidden="true"
            />
          </AppButton>
          <div
            :id="`route-group-${group.key}`"
            class="nav-panel"
            :class="{ expanded: expandedGroupKey === group.key }"
            :aria-hidden="expandedGroupKey !== group.key"
            :inert="expandedGroupKey !== group.key ? true : undefined"
          >
            <div class="nav-list">
              <AppButton
                v-for="item in group.routes"
                :key="item.key"
                :class="{ active: activeTab === item.key }"
                type="button"
                :aria-current="activeTab === item.key ? 'page' : undefined"
                @click="navigateToRoute(item.key)"
                class="nav-item"
                variant="plain"
              >
                <component :is="item.icon" class="nav-icon" aria-hidden="true" />{{ item.label }}
              </AppButton>
            </div>
          </div>
        </template>
      </div>
    </div>
    <!-- 侧栏底部只放当前账号卡片；服务端身份由公共底栏展示。 -->
    <div v-if="screen === 'app' && user" class="sidebar-bottom">
      <SidebarAccountCard />
    </div>
  </aside>
</template>

<script setup lang="ts">
// 输入框统一外观，必填、长度与数字范围仍由真实输入元素校验。
import AppInput from '../../../components/app/AppInput.vue'
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../../components/app/AppButton.vue'
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '../../../store/app-store'
import { buildPermissionTree } from '../../../utils/permission-tree'

const { busy, permissions, permissionLabelDrafts, savePermissionLabel, loadPermissions, displayError } = useAppStore()
// 目录单独成页，仍复用服务端返回的模块、单据、操作三级关系。
const permissionModules = computed(() => buildPermissionTree(permissions.value))
const loading = ref(false)
const loadError = ref('')

async function retryLoad(): Promise<void> {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    await loadPermissions()
  } catch (cause) {
    loadError.value = displayError(cause)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // 登录时全局业务刷新失败后，目录页面仍可单独恢复自己的数据。
  if (permissions.value.length === 0) void retryLoad()
})
</script>

<template>
  <section class="stack">
    <div class="card">
      <!-- 页面说明已移到外部标题区，保留权限树与名称编辑。 -->
      <div class="permission-catalog">
        <p v-if="loading" class="muted">正在加载权限目录...</p>
        <div v-else-if="loadError && permissionModules.length === 0" role="alert">
          <p>权限目录加载失败：{{ loadError }}</p>
          <AppButton type="button" @click="retryLoad" variant="secondary" size="small"
            >重试</AppButton
          >
        </div>
        <p v-else-if="permissionModules.length === 0" class="muted">暂无权限项目。</p>
        <details
          v-for="module in permissionModules"
          :key="module.code"
          class="permission-catalog-group"
        >
          <summary>{{ module.label }}</summary>
          <details
            v-for="document in module.documents"
            :key="document.code"
            class="permission-catalog-document"
          >
            <summary>{{ document.label }}</summary>
            <form
              v-for="permission in document.permissions"
              :key="permission.code"
              class="permission-catalog-row"
              @submit.prevent="savePermissionLabel(permission.code)"
            >
              <small>{{ permission.code }}</small>
              <label>
                中文名称
                <AppInput
                  v-model.trim="permissionLabelDrafts[permission.code]"
                  required
                  maxlength="60"
                />
              </label>
              <AppButton
                type="submit"
                :disabled="
                  busy ||
                  !permissionLabelDrafts[permission.code] ||
                  permissionLabelDrafts[permission.code] === permission.label
                "
                variant="secondary"
                size="small"
                >保存名称</AppButton
              >
            </form>
          </details>
        </details>
      </div>
    </div>
  </section>
</template>

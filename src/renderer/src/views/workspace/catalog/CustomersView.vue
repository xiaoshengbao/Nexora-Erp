<script setup lang="ts">
// 输入框统一外观，必填、长度与数字范围仍由真实输入元素校验。
import AppInput from '../../../components/app/AppInput.vue'
// 页面按钮统一复用 Naive UI 封装，显式区分表单提交与普通操作。
import AppButton from '../../../components/app/AppButton.vue'
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { NModal } from 'naive-ui'
import WorkspaceTable from '../../../components/workspace/WorkspaceTable.vue'
import { usePiniaAppStore } from '../../../store/app-store'
import { matchesRecordQuery } from '../../../utils/workspace-records'
import { submitCreateDialog } from '../../../utils/create-dialog'

// 客户资料与订单共用服务端快照和草稿，切换页面无需另建业务状态。
const store = usePiniaAppStore()
const { busy, error, notice, connectionLost, customers, customerForm } = storeToRefs(store)
const { can, createCustomer } = store
const customerOpen = ref(false)
const customerQuery = ref('')
const customerColumns = [
  { key: 'id', title: '编号', width: '120' },
  { key: 'name', title: '客户名称' }
]
const filteredCustomers = computed(() =>
  customers.value.filter((item) => matchesRecordQuery(customerQuery.value, [item.id, item.name]))
)
async function submitCustomer(): Promise<void> {
  // 断线或权限变化时不提交；服务端拒绝保存后仍保留弹窗和输入内容。
  if (connectionLost.value || !can('customer.manage')) return
  await submitCreateDialog(createCustomer, { busy, error, notice }, customerOpen)
}
</script>

<template>
  <section class="stack">
    <!-- 主标题由工作台提供，客户列表独立于销售单据。 -->
    <WorkspaceTable
      :show-title="false"
      title="客户资料"
      :columns="customerColumns"
      :data="filteredCustomers"
      :min-table-width="480"
    >
      <template #actions>
        <AppButton
          v-if="can('customer.manage')"
          type="button"
          :disabled="busy || connectionLost"
          @click="customerOpen = true"
          variant="primary"
        >
          新增客户
        </AppButton>
      </template>
      <template #filters>
        <label>
          搜索客户
          <AppInput v-model="customerQuery" placeholder="输入编号或名称" />
        </label>
      </template>
      <template #beforeTable>
        <NModal
          v-if="can('customer.manage')"
          v-model:show="customerOpen"
          preset="card"
          title="新增客户"
          :mask-closable="!busy"
          :style="{ width: 'min(560px, calc(100vw - 32px))' }"
        >
          <form class="inline-form" @submit.prevent="submitCustomer">
            <label>
              客户名称
              <AppInput
                v-model.trim="customerForm.name"
                required
                maxlength="120"
                placeholder="输入客户名称"
              />
            </label>
            <AppButton type="submit" :disabled="busy || connectionLost" variant="primary"
              >添加客户</AppButton
            >
          </form>
        </NModal>
      </template>
      <template #empty>{{ customerQuery ? '没有匹配的客户。' : '暂无客户，请先新增。' }}</template>
    </WorkspaceTable>
  </section>
</template>

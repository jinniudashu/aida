<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NCard, NForm, NFormItem, NSelect, NInput, NButton, NSpace, useMessage } from 'naive-ui'
import { useProcessStore, useServiceStore } from '../stores'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', val: boolean): void }>()

const message = useMessage()
const processStore = useProcessStore()
const serviceStore = useServiceStore()

serviceStore.fetch()

const serviceId = ref<string | null>(null)
const entityType = ref('')
const entityId = ref('')
const operatorId = ref('')
const submitting = ref(false)

const serviceOptions = computed(() =>
  serviceStore.list
    .filter(s => s.manualStart)
    .map(s => ({ label: s.label || s.id, value: s.id }))
)

// Auto-fill entityType when service is selected
watch(serviceId, (id) => {
  if (!id) return
  const svc = serviceStore.list.find(s => s.id === id)
  if (svc?.entityType) entityType.value = svc.entityType
})

function close() {
  emit('update:show', false)
}

function reset() {
  serviceId.value = null
  entityType.value = ''
  entityId.value = ''
  operatorId.value = ''
}

async function handleSubmit() {
  if (!serviceId.value) return
  submitting.value = true
  try {
    await processStore.create({
      serviceId: serviceId.value,
      entityType: entityType.value || undefined,
      entityId: entityId.value || undefined,
      operatorId: operatorId.value || undefined,
    })
    message.success('Process created')
    reset()
    close()
  } catch (err: any) {
    message.error(err.message || 'Failed to create process')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <NModal :show="props.show" @update:show="emit('update:show', $event)">
    <NCard title="New Process" style="width: 480px" :bordered="false" closable @close="close">
      <NForm label-placement="left" label-width="100">
        <NFormItem label="Service" required>
          <NSelect
            v-model:value="serviceId"
            :options="serviceOptions"
            placeholder="Select a service"
            filterable
          />
        </NFormItem>
        <NFormItem label="Entity Type">
          <NInput v-model:value="entityType" placeholder="e.g. order, customer" />
        </NFormItem>
        <NFormItem label="Entity ID">
          <NInput v-model:value="entityId" placeholder="e.g. ord-1001" />
        </NFormItem>
        <NFormItem label="Operator ID">
          <NInput v-model:value="operatorId" placeholder="e.g. user-123" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="close">Cancel</NButton>
        <NButton type="primary" :loading="submitting" :disabled="!serviceId" @click="handleSubmit">
          Create
        </NButton>
      </NSpace>
    </NCard>
  </NModal>
</template>

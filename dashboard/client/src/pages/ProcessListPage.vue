<script setup lang="ts">
import { ref, onMounted, watch, h } from 'vue'
import { useRouter } from 'vue-router'
import { NDataTable, NSelect, NTag, NPagination, NSpin, NButton } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useProcessStore, useServiceStore } from '../stores'
import { ALL_STATES, STATE_TAG_TYPE, formatDate } from '../utils'
import type { ProcessDef } from '../api'
import CreateProcessModal from '../components/CreateProcessModal.vue'

const router = useRouter()
const processStore = useProcessStore()
const serviceStore = useServiceStore()

const filterState = ref<string | null>(null)
const filterServiceId = ref<string | null>(null)
const page = ref(1)
const pageSize = 20
const showCreateModal = ref(false)

onMounted(() => {
  serviceStore.fetch()
  fetchData()
})

watch([filterState, filterServiceId, page], () => fetchData())

function fetchData() {
  const filter: Record<string, string | undefined> = {
    limit: String(pageSize),
    offset: String((page.value - 1) * pageSize),
  }
  if (filterState.value) filter.state = filterState.value
  if (filterServiceId.value) filter.serviceId = filterServiceId.value
  processStore.fetchList(filter)
}

const stateOptions = ALL_STATES.map(s => ({ label: s, value: s }))
const serviceOptions = () => serviceStore.list.map(s => ({ label: s.label || s.id, value: s.id }))

const columns: DataTableColumns<ProcessDef> = [
  { title: 'PID', key: 'pid', width: 80 },
  { title: 'Name', key: 'name', render: (r) => r.name ?? '-' },
  { title: 'Service', key: 'serviceId' },
  {
    title: 'State', key: 'state', width: 120,
    render: (r) => h(NTag, { type: STATE_TAG_TYPE[r.state] ?? 'default', size: 'small' }, () => r.state),
  },
  { title: 'Entity', key: 'entity', render: (r) => r.entityType ? `${r.entityType}/${r.entityId}` : '-' },
  { title: 'Created', key: 'createdAt', render: (r) => formatDate(r.createdAt), width: 180 },
]

function handleRowClick(row: ProcessDef) {
  router.push(`/processes/${row.id}`)
}
</script>

<template>
  <div>
    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center">
      <NSelect
        v-model:value="filterState"
        :options="stateOptions"
        placeholder="All States"
        clearable
        style="width: 160px"
      />
      <NSelect
        v-model:value="filterServiceId"
        :options="serviceOptions()"
        placeholder="All Services"
        clearable
        style="width: 200px"
      />
      <NButton type="primary" @click="showCreateModal = true">New Process</NButton>
    </div>

    <NSpin :show="processStore.loading">
      <NDataTable
        :columns="columns"
        :data="processStore.list"
        :bordered="false"
        :row-props="(row: ProcessDef) => ({ style: 'cursor: pointer', onClick: () => handleRowClick(row) })"
      />
    </NSpin>

    <div style="display: flex; justify-content: flex-end; margin-top: 16px">
      <NPagination
        v-model:page="page"
        :page-size="pageSize"
        :item-count="processStore.list.length < pageSize ? (page - 1) * pageSize + processStore.list.length : page * pageSize + 1"
      />
    </div>

    <CreateProcessModal v-model:show="showCreateModal" />
  </div>
</template>

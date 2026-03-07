<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, h } from 'vue'
import { NDataTable, NSelect, NTag, NSpin, NPagination } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useAgentLogStore } from '../stores'
import { formatDate, STATE_TAG_TYPE } from '../utils'
import type { AgentLogEntry } from '../api'

const store = useAgentLogStore()
let unsub: (() => void) | null = null

const filterAction = ref<string | null>(null)
const page = ref(1)
const pageSize = 50

const actionOptions = [
  { label: 'created', value: 'created' },
  { label: 'state_changed', value: 'state_changed' },
  { label: 'completed', value: 'completed' },
  { label: 'failed', value: 'failed' },
]

onMounted(() => {
  unsub = store.subscribe()
})
onUnmounted(() => { unsub?.() })

watch([filterAction, page], () => {
  store.fetch({
    action: filterAction.value ?? undefined,
    limit: String(pageSize),
    offset: String((page.value - 1) * pageSize),
  })
})

const columns: DataTableColumns<AgentLogEntry> = [
  { title: 'Time', key: 'timestamp', width: 180, render: (r) => formatDate(r.timestamp) },
  { title: 'Action', key: 'action', width: 130,
    render: (r) => {
      const typeMap: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
        created: 'info', state_changed: 'default', completed: 'success', failed: 'error',
      }
      return h(NTag, { type: typeMap[r.action] ?? 'default', size: 'small' }, () => r.action)
    },
  },
  { title: 'Task', key: 'taskName', render: (r) => r.taskName ?? r.taskId.slice(0, 8) + '...' },
  { title: 'Service', key: 'serviceId', render: (r) => r.serviceId ?? '-' },
  {
    title: 'Transition', key: 'transition', width: 200,
    render: (r) => {
      if (!r.fromState && !r.toState) return '-'
      const parts = []
      if (r.fromState) parts.push(h(NTag, { type: STATE_TAG_TYPE[r.fromState] ?? 'default', size: 'tiny' }, () => r.fromState))
      if (r.fromState && r.toState) parts.push(' \u2192 ')
      if (r.toState) parts.push(h(NTag, { type: STATE_TAG_TYPE[r.toState] ?? 'default', size: 'tiny' }, () => r.toState))
      return h('span', { style: 'display: inline-flex; align-items: center; gap: 4px' }, parts)
    },
  },
  { title: 'Reason', key: 'reason', ellipsis: { tooltip: true }, render: (r) => r.reason ?? '-' },
  { title: 'Entity', key: 'entity', render: (r) => r.entityType ? `${r.entityType}/${r.entityId}` : '-' },
]
</script>

<template>
  <div>
    <h2 style="margin-top: 0">Agent Log</h2>
    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center">
      <NSelect
        v-model:value="filterAction"
        :options="actionOptions"
        placeholder="All Actions"
        clearable
        style="width: 180px"
      />
    </div>

    <NSpin :show="store.loading">
      <NDataTable
        :columns="columns"
        :data="store.entries"
        :bordered="false"
        :max-height="600"
        :row-key="(r: AgentLogEntry) => r.id"
      />
    </NSpin>

    <div style="display: flex; justify-content: flex-end; margin-top: 16px">
      <NPagination
        v-model:page="page"
        :page-size="pageSize"
        :item-count="store.entries.length < pageSize ? (page - 1) * pageSize + store.entries.length : page * pageSize + 1"
      />
    </div>
  </div>
</template>

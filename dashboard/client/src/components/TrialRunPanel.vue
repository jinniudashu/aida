<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NDataTable, NTag, NButton, NSpace, NStatistic, NGrid, NGridItem, NAlert } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useTrialRunStore } from '../stores'
import { STATE_TAG_TYPE, formatDuration, formatDate } from '../utils'
import type { ProcessDef } from '../api'

const trialStore = useTrialRunStore()

const columns: DataTableColumns<ProcessDef> = [
  { title: 'PID', key: 'pid', width: 70 },
  { title: 'Service', key: 'serviceId', ellipsis: { tooltip: true },
    render: (row) => row.name || row.serviceId },
  { title: 'Executor', key: 'executorType' as any, width: 90,
    render: (row) => (row as any).executorType ?? '-' },
  { title: 'State', key: 'state', width: 120,
    render: (row) => {
      const tagType = STATE_TAG_TYPE[row.state] ?? 'default'
      return h(NTag, { type: tagType, size: 'small' }, { default: () => row.state })
    }},
  { title: 'Duration', key: 'duration', width: 100,
    render: (row) => formatDuration(row.startTime, row.endTime) },
  { title: 'Created', key: 'createdAt', width: 160,
    render: (row) => formatDate(row.createdAt) },
  { title: 'Action', key: 'action', width: 150,
    render: (row) => {
      if (row.state === 'TERMINATED' || row.state === 'ERROR') return '-'
      return h(NButton, {
        size: 'small',
        type: 'primary',
        loading: trialStore.loading,
        onClick: () => trialStore.simulateComplete(row.id),
      }, { default: () => 'Simulate Complete' })
    }},
]

import { h } from 'vue'

// Enrich processes with executorType from service store
import { useServiceStore } from '../stores'
const serviceStore = useServiceStore()

const enrichedProcesses = computed(() => {
  const svcMap = new Map(serviceStore.list.map(s => [s.id, s]))
  return trialStore.allProcesses.map(p => {
    const svc = svcMap.get(p.serviceId)
    return { ...p, executorType: svc?.executorType ?? '-', name: svc?.label ?? p.serviceId }
  })
})

const isComplete = computed(() => {
  const procs = trialStore.allProcesses
  if (procs.length <= 1) return false // only root or empty
  // All non-root processes must be TERMINATED or ERROR
  return procs.slice(1).every(p => p.state === 'TERMINATED' || p.state === 'ERROR')
})

const report = computed(() => {
  if (!isComplete.value) return null
  const procs = trialStore.allProcesses
  const byState: Record<string, number> = {}
  for (const p of procs) {
    byState[p.state] = (byState[p.state] || 0) + 1
  }
  const succeeded = byState['TERMINATED'] || 0
  const failed = byState['ERROR'] || 0
  const totalDuration = formatDuration(trialStore.startedAt ?? undefined)
  return { total: procs.length, succeeded, failed, byState, totalDuration }
})
</script>

<template>
  <NCard title="Trial Run" size="small" style="margin-top: 16px">
    <NAlert v-if="trialStore.error" type="error" :title="trialStore.error" style="margin-bottom: 12px" />

    <NDataTable
      :columns="columns"
      :data="enrichedProcesses"
      :row-key="(row: ProcessDef) => row.id"
      size="small"
      :bordered="false"
      :max-height="320"
      :scroll-x="800"
    />

    <template v-if="report">
      <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e0e0e6">
        <h4 style="margin: 0 0 12px 0">Execution Report</h4>
        <NGrid :cols="4" :x-gap="12">
          <NGridItem>
            <NStatistic label="Total Processes" :value="report.total" />
          </NGridItem>
          <NGridItem>
            <NStatistic label="Succeeded" :value="report.succeeded">
              <template #suffix>
                <span style="color: #18a058">/ {{ report.total }}</span>
              </template>
            </NStatistic>
          </NGridItem>
          <NGridItem>
            <NStatistic label="Failed" :value="report.failed" />
          </NGridItem>
          <NGridItem>
            <NStatistic label="Total Duration" :value="report.totalDuration" />
          </NGridItem>
        </NGrid>
      </div>
    </template>
  </NCard>
</template>

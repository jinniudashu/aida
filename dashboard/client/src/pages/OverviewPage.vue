<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { NGrid, NGi, NCard, NStatistic, NDataTable, NTag, NSpin, NRadioGroup, NRadioButton, NAlert, NSpace, NProgress, NEmpty, NBadge } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useOverviewStore, useAlertStore, useGovernanceStore, useBusinessGoalsStore, useApprovalsStore } from '../stores'
import { formatDate } from '../utils'
import type { RecentChange } from '../api'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent])

const store = useOverviewStore()
const alertStore = useAlertStore()
const govStore = useGovernanceStore()
const goalsStore = useBusinessGoalsStore()
const approvalsStore = useApprovalsStore()
const interval = ref<'hour' | 'day' | 'week'>('day')

let unsubs: Array<(() => void) | null> = []
onMounted(() => {
  unsubs.push(store.subscribe())
  unsubs.push(alertStore.subscribe())
  unsubs.push(govStore.subscribe())
  unsubs.push(goalsStore.subscribe())
  unsubs.push(approvalsStore.subscribe('pending'))
  store.fetchTimeSeries(interval.value)
})
onUnmounted(() => { unsubs.forEach(u => u?.()) })

function alertType(severity: string): 'error' | 'warning' | 'info' {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'info'
}

watch(interval, () => store.fetchTimeSeries(interval.value))

const changeCols: DataTableColumns<RecentChange> = [
  { title: 'Entity Type', key: 'dossier.entityType', render: (r) => r.dossier.entityType },
  { title: 'Entity ID', key: 'dossier.entityId', render: (r) => r.dossier.entityId },
  { title: 'Version', key: 'version', width: 80 },
  { title: 'Committed By', key: 'committedBy', render: (r) => r.committedBy ?? '-' },
  { title: 'Time', key: 'versionCreatedAt', render: (r) => formatDate(r.versionCreatedAt), width: 180 },
]

const byStateEntries = computed(() => Object.entries(store.data?.processes.byState ?? {}))
const byTypeEntries = computed(() => Object.entries(store.data?.entities.byType ?? {}))

// Circuit breaker display
const cbState = computed(() => govStore.status?.circuitBreaker?.state ?? 'NORMAL')
const cbTagType = computed(() => {
  const s = cbState.value
  if (s === 'DISCONNECTED') return 'error'
  if (s === 'RESTRICTED') return 'error'
  if (s === 'WARNING') return 'warning'
  return 'success'
})

// Active tasks (OPEN + IN_PROGRESS)
const activeTasks = computed(() => {
  const byState = store.data?.processes.byState ?? {}
  return (byState['OPEN'] ?? 0) + (byState['IN_PROGRESS'] ?? 0) + (byState['BLOCKED'] ?? 0)
})

const chartOption = computed(() => {
  const ts = store.timeseries
  const created = ts.created ?? []
  const completed = ts.completed ?? []
  const errors = ts.errors ?? []
  const allBuckets = [...new Set([...created, ...completed, ...errors].map(p => p.bucket))].sort()

  function toMap(arr: { bucket: string; count: number }[]) {
    const m = new Map<string, number>()
    for (const p of arr) m.set(p.bucket, p.count)
    return m
  }
  const cMap = toMap(created), dMap = toMap(completed), eMap = toMap(errors)

  return {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['Created', 'Completed', 'Errors'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category' as const, data: allBuckets },
    yAxis: { type: 'value' as const, minInterval: 1 },
    series: [
      { name: 'Created', type: 'line' as const, data: allBuckets.map(b => cMap.get(b) ?? 0), smooth: true },
      { name: 'Completed', type: 'line' as const, data: allBuckets.map(b => dMap.get(b) ?? 0), smooth: true },
      { name: 'Errors', type: 'line' as const, data: allBuckets.map(b => eMap.get(b) ?? 0), smooth: true, itemStyle: { color: '#e88080' } },
    ],
  }
})
</script>

<template>
  <NSpin :show="store.loading && !store.data">
    <template v-if="store.data">
      <!-- Alerts -->
      <NSpace v-if="alertStore.alerts.length > 0" vertical style="margin-bottom: 16px">
        <NAlert
          v-for="alert in alertStore.alerts"
          :key="alert.id"
          :type="alertType(alert.severity)"
          :title="alert.type === 'baseline' ? 'Baseline Anomaly' : 'Threshold Alert'"
          style="margin-bottom: 4px"
        >
          {{ alert.message }}
        </NAlert>
      </NSpace>

      <!-- Three Panels: Current State / Goals / Next Steps -->
      <NGrid :x-gap="16" :y-gap="16" :cols="3" style="margin-bottom: 24px">
        <!-- Panel 1: Current State (现状) -->
        <NGi>
          <NCard title="Current State">
            <div style="display: flex; gap: 16px; margin-bottom: 12px">
              <NStatistic label="Entities" :value="store.data.entities.totalCount" />
              <NStatistic label="Active Tasks" :value="activeTasks" />
              <NStatistic label="Errors" :value="store.data.processes.errorCount" />
            </div>
            <div style="margin-bottom: 8px">
              <NTag v-for="[type, count] in byTypeEntries" :key="type" size="small" style="margin: 2px">
                {{ type }}: {{ count }}
              </NTag>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e0e0e6">
              <span style="font-size: 12px; color: #666">Governance:</span>
              <NTag :type="cbTagType" size="small">{{ cbState }}</NTag>
              <span v-if="govStore.status?.constraintCount" style="font-size: 12px; color: #999">
                {{ govStore.status.constraintCount }} constraint{{ govStore.status.constraintCount > 1 ? 's' : '' }}
              </span>
              <NBadge v-if="(govStore.status?.recentViolations?.length ?? 0) > 0"
                :value="govStore.status?.recentViolations?.length"
                :max="9"
                type="warning"
                style="margin-left: auto"
              />
            </div>
          </NCard>
        </NGi>

        <!-- Panel 2: Goals (目标) -->
        <NGi>
          <NCard title="Goals">
            <template v-if="goalsStore.goals.length > 0">
              <div v-for="goal in goalsStore.goals" :key="goal.planId" style="margin-bottom: 12px">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px">
                  <span style="font-weight: 500; font-size: 13px">{{ goal.name }}</span>
                  <span style="font-size: 12px; color: #999">{{ goal.processStats.completionRate }}%</span>
                </div>
                <NProgress
                  type="line"
                  :percentage="goal.processStats.completionRate"
                  :height="8"
                  :show-indicator="false"
                  :color="goal.processStats.completionRate >= 100 ? '#18a058' : '#2080f0'"
                />
                <div style="font-size: 11px; color: #999; margin-top: 2px">
                  {{ goal.items.filter(i => i.status === 'done' || i.status === 'completed').length }}/{{ goal.items.length }} items
                  <span v-if="goal.periodicItems.length > 0"> · {{ goal.periodicItems.length }} recurring</span>
                </div>
              </div>
            </template>
            <NEmpty v-else description="No action plans yet" size="small" />
          </NCard>
        </NGi>

        <!-- Panel 3: Next Steps (下一步) -->
        <NGi>
          <NCard title="Next Steps">
            <!-- Pending tasks -->
            <div v-if="byStateEntries.length > 0" style="margin-bottom: 8px">
              <div style="font-size: 12px; color: #666; margin-bottom: 4px">Task Queue</div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap">
                <NTag v-for="[state, count] in byStateEntries" :key="state" size="small"
                  :type="state === 'FAILED' ? 'error' : state === 'BLOCKED' ? 'warning' : state === 'COMPLETED' ? 'success' : 'default'">
                  {{ state }}: {{ count }}
                </NTag>
              </div>
            </div>
            <!-- Pending governance approvals -->
            <div v-if="approvalsStore.items.length > 0" style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #e0e0e6">
              <div style="font-size: 12px; color: #666; margin-bottom: 4px">
                Pending Approvals
                <NBadge :value="approvalsStore.items.length" :max="9" type="warning" style="margin-left: 4px" />
              </div>
              <div v-for="item in approvalsStore.items.slice(0, 3)" :key="item.approvalId"
                style="font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f0f0f0">
                {{ item.question }}
              </div>
              <div v-if="approvalsStore.items.length > 3" style="font-size: 11px; color: #999; margin-top: 4px">
                +{{ approvalsStore.items.length - 3 }} more...
              </div>
            </div>
            <!-- Governance violations -->
            <div v-if="(govStore.status?.recentViolations?.length ?? 0) > 0" style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #e0e0e6">
              <div style="font-size: 12px; color: #666; margin-bottom: 4px">Recent Violations</div>
              <div v-for="v in govStore.status?.recentViolations?.slice(0, 3)" :key="v.id"
                style="font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f0f0f0">
                <NTag :type="v.severity === 'CRITICAL' ? 'error' : v.severity === 'HIGH' ? 'warning' : 'default'" size="tiny" style="margin-right: 4px">
                  {{ v.severity }}
                </NTag>
                {{ v.message }}
              </div>
            </div>
            <NEmpty v-if="activeTasks === 0 && approvalsStore.items.length === 0 && (govStore.status?.recentViolations?.length ?? 0) === 0"
              description="All clear" size="small" />
          </NCard>
        </NGi>
      </NGrid>

      <!-- Activity Chart -->
      <NCard title="Process Activity" style="margin-bottom: 24px">
        <template #header-extra>
          <NRadioGroup v-model:value="interval" size="small">
            <NRadioButton value="hour">Hour</NRadioButton>
            <NRadioButton value="day">Day</NRadioButton>
            <NRadioButton value="week">Week</NRadioButton>
          </NRadioGroup>
        </template>
        <VChart :option="chartOption" style="height: 300px" autoresize />
      </NCard>

      <!-- Recent Changes -->
      <NCard title="Recent Changes">
        <NDataTable
          :columns="changeCols"
          :data="store.data.entities.recentChanges"
          :bordered="false"
          size="small"
        />
      </NCard>
    </template>
  </NSpin>
</template>

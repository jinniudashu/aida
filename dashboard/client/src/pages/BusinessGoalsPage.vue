<script setup lang="ts">
import { onMounted, onUnmounted, h } from 'vue'
import { NCard, NProgress, NTag, NDataTable, NSpin, NEmpty } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useBusinessGoalsStore } from '../stores'
import { formatDate } from '../utils'
import type { BusinessGoalItem, PeriodicItem } from '../api'

const store = useBusinessGoalsStore()
let unsub: (() => void) | null = null

onMounted(() => { unsub = store.subscribe() })
onUnmounted(() => { unsub?.() })

const itemColumns: DataTableColumns<BusinessGoalItem> = [
  { title: 'Item', key: 'name' },
  {
    title: 'Status', key: 'status', width: 120,
    render: (r) => {
      const typeMap: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
        pending: 'default', 'in-progress': 'info', done: 'success', completed: 'success', overdue: 'error',
      }
      return h(NTag, { type: typeMap[r.status] ?? 'default', size: 'small' }, () => r.status)
    },
  },
  { title: 'Due', key: 'dueDate', width: 160, render: (r) => r.dueDate ? formatDate(r.dueDate) : '-' },
  { title: 'Priority', key: 'priority', width: 100, render: (r) => r.priority ?? '-' },
]

const periodicColumns: DataTableColumns<PeriodicItem> = [
  { title: 'Item', key: 'name' },
  { title: 'Schedule', key: 'cron', width: 140, render: (r) => r.cron ?? '-' },
  { title: 'Last Run', key: 'lastRun', width: 160, render: (r) => r.lastRun ? formatDate(r.lastRun) : '-' },
]
</script>

<template>
  <div>
    <h2 style="margin-top: 0">Business Goals</h2>

    <NSpin :show="store.loading">
      <NEmpty v-if="store.goals.length === 0 && !store.loading" description="No action plans found" />

      <div style="display: flex; flex-direction: column; gap: 16px">
        <NCard v-for="goal in store.goals" :key="goal.planId" :title="String(goal.name)" size="small">
          <template #header-extra>
            <span style="color: #999; font-size: 12px">Updated {{ formatDate(goal.updatedAt) }}</span>
          </template>

          <p v-if="goal.description" style="margin-top: 0; color: #666">{{ goal.description }}</p>

          <!-- Progress bar -->
          <div style="margin-bottom: 16px">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px">
              <span>Completion</span>
              <span>{{ goal.processStats.completionRate }}% ({{ goal.processStats.byState['COMPLETED'] ?? 0 }}/{{ goal.processStats.total }})</span>
            </div>
            <NProgress
              type="line"
              :percentage="goal.processStats.completionRate"
              :status="goal.processStats.completionRate === 100 ? 'success' : 'default'"
            />
          </div>

          <!-- State breakdown -->
          <div v-if="goal.processStats.total > 0" style="display: flex; gap: 8px; margin-bottom: 16px">
            <NTag v-for="(count, state) in goal.processStats.byState" :key="state" size="small">
              {{ state }}: {{ count }}
            </NTag>
          </div>

          <!-- One-off items -->
          <div v-if="goal.items.length > 0">
            <h4 style="margin: 8px 0">Items</h4>
            <NDataTable :columns="itemColumns" :data="goal.items" :bordered="false" size="small" />
          </div>

          <!-- Periodic items -->
          <div v-if="goal.periodicItems.length > 0">
            <h4 style="margin: 8px 0">Recurring Tasks</h4>
            <NDataTable :columns="periodicColumns" :data="goal.periodicItems" :bordered="false" size="small" />
          </div>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>

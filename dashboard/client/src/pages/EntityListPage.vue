<script setup lang="ts">
import { ref, computed, onMounted, watch, h } from 'vue'
import { useRouter } from 'vue-router'
import { NDataTable, NSelect, NTag, NSpin } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useEntityStore, useServiceStore } from '../stores'
import { formatDate } from '../utils'
import type { DossierSearchResult } from '../api'

const router = useRouter()
const entityStore = useEntityStore()
const serviceStore = useServiceStore()

const filterEntityType = ref<string | null>(null)
const filterLifecycle = ref<string | null>(null)

onMounted(() => {
  serviceStore.fetch()
  fetchData()
})

watch([filterEntityType, filterLifecycle], () => fetchData())

function fetchData() {
  const filter: Record<string, string | undefined> = {}
  if (filterEntityType.value) filter.entityType = filterEntityType.value
  if (filterLifecycle.value) filter.lifecycle = filterLifecycle.value
  entityStore.fetchList(filter)
}

const entityTypeOptions = () => {
  const types = new Set(serviceStore.list.map(s => s.entityType).filter(Boolean))
  return [...types].map(t => ({ label: t!, value: t! }))
}

const lifecycleOptions = [
  { label: 'DRAFT', value: 'DRAFT' },
  { label: 'ACTIVE', value: 'ACTIVE' },
  { label: 'ARCHIVED', value: 'ARCHIVED' },
]

const lifecycleTagType: Record<string, 'default' | 'success' | 'warning'> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  ARCHIVED: 'warning',
}

function extractDataKeys(list: DossierSearchResult[]): string[] {
  const keySet = new Set<string>()
  for (const item of list) {
    if (item.data && typeof item.data === 'object') {
      for (const key of Object.keys(item.data)) {
        if (!key.startsWith('_')) keySet.add(key)
      }
    }
  }
  return [...keySet]
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const columns = computed<DataTableColumns<DossierSearchResult>>(() => {
  const cols: DataTableColumns<DossierSearchResult> = []

  if (!filterEntityType.value) {
    cols.push({ title: 'Entity Type', key: 'dossier.entityType', render: (r) => r.dossier.entityType })
  }

  cols.push({ title: 'Entity ID', key: 'dossier.entityId', render: (r) => r.dossier.entityId })

  if (filterEntityType.value && entityStore.list.length > 0) {
    const dataKeys = extractDataKeys(entityStore.list)
    for (const key of dataKeys) {
      cols.push({
        title: key,
        key: `data.${key}`,
        render: (r) => formatCellValue(r.data[key]),
        ellipsis: { tooltip: true },
      })
    }
  }

  cols.push(
    {
      title: 'Lifecycle', key: 'dossier.lifecycle', width: 110,
      render: (r) => h(NTag, { type: lifecycleTagType[r.dossier.lifecycle] ?? 'default', size: 'small' }, () => r.dossier.lifecycle),
    },
    { title: 'Version', key: 'dossier.currentVersion', render: (r) => String(r.dossier.currentVersion), width: 80 },
    { title: 'Updated', key: 'dossier.updatedAt', render: (r) => formatDate(r.dossier.updatedAt), width: 180 },
  )

  return cols
})

function handleRowClick(row: DossierSearchResult) {
  router.push(`/entities/${row.dossier.id}`)
}
</script>

<template>
  <div>
    <div style="display: flex; gap: 12px; margin-bottom: 16px">
      <NSelect
        v-model:value="filterEntityType"
        :options="entityTypeOptions()"
        placeholder="All Entity Types"
        clearable
        style="width: 200px"
      />
      <NSelect
        v-model:value="filterLifecycle"
        :options="lifecycleOptions"
        placeholder="All Lifecycles"
        clearable
        style="width: 160px"
      />
    </div>

    <NSpin :show="entityStore.loading">
      <NDataTable
        :columns="columns"
        :data="entityStore.list"
        :bordered="false"
        :row-props="(row: DossierSearchResult) => ({ style: 'cursor: pointer', onClick: () => handleRowClick(row) })"
      />
    </NSpin>
  </div>
</template>

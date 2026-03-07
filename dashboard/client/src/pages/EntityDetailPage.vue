<script setup lang="ts">
import { onMounted, computed, h, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NCard, NDescriptions, NDescriptionsItem, NTag, NCode, NDataTable, NSpin, NTimeline, NTimelineItem, NRadioGroup, NRadioButton } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useEntityStore } from '../stores'
import { STATE_TAG_TYPE, formatDate } from '../utils'
import type { DossierVersion, ProcessDef } from '../api'

const route = useRoute()
const router = useRouter()
const entityStore = useEntityStore()

const entityId = computed(() => route.params.id as string)

onMounted(() => entityStore.fetchDetail(entityId.value))

const entity = computed(() => entityStore.detail)

const dataJson = computed(() => {
  return entity.value ? JSON.stringify(entity.value.data, null, 2) : '{}'
})

const lifecycleTagType: Record<string, 'default' | 'success' | 'warning'> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  ARCHIVED: 'warning',
}

const viewMode = ref<'timeline' | 'table'>('timeline')

const sortedVersions = computed(() => {
  if (!entity.value) return []
  return [...entity.value.versions].sort((a, b) => b.version - a.version)
})

const versionCols: DataTableColumns<DossierVersion> = [
  { title: 'Version', key: 'version', width: 80 },
  { title: 'Committed By', key: 'committedBy', render: (r) => r.committedBy ?? '-' },
  { title: 'Message', key: 'commitMessage', render: (r) => r.commitMessage ?? '-' },
  { title: 'Created', key: 'createdAt', render: (r) => formatDate(r.createdAt), width: 180 },
]

const processCols: DataTableColumns<ProcessDef> = [
  { title: 'PID', key: 'pid', width: 80 },
  {
    title: 'State', key: 'state', width: 120,
    render: (r) => h(NTag, { type: STATE_TAG_TYPE[r.state] ?? 'default', size: 'small' }, () => r.state),
  },
  { title: 'Service', key: 'serviceId' },
  { title: 'Created', key: 'createdAt', render: (r) => formatDate(r.createdAt), width: 180 },
]

function goToProcess(row: ProcessDef) {
  router.push(`/processes/${row.id}`)
}

function formatPatch(patch: Record<string, unknown> | undefined): Array<{ key: string; value: string }> {
  if (!patch) return []
  return Object.entries(patch).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
  }))
}
</script>

<template>
  <NSpin :show="entityStore.loading">
    <template v-if="entity">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">
        <h2 style="margin: 0">{{ entity.dossier.entityType }} / {{ entity.dossier.entityId }}</h2>
        <NTag :type="lifecycleTagType[entity.dossier.lifecycle] ?? 'default'" size="large">
          {{ entity.dossier.lifecycle }}
        </NTag>
      </div>

      <NCard title="Dossier Info" style="margin-bottom: 16px">
        <NDescriptions label-placement="left" :column="2" bordered>
          <NDescriptionsItem label="ID">{{ entity.dossier.id }}</NDescriptionsItem>
          <NDescriptionsItem label="Version">{{ entity.dossier.currentVersion }}</NDescriptionsItem>
          <NDescriptionsItem label="Created">{{ formatDate(entity.dossier.createdAt) }}</NDescriptionsItem>
          <NDescriptionsItem label="Updated">{{ formatDate(entity.dossier.updatedAt) }}</NDescriptionsItem>
        </NDescriptions>
      </NCard>

      <NCard title="Current Data" style="margin-bottom: 16px">
        <NCode :code="dataJson" language="json" />
      </NCard>

      <NCard title="Version History" style="margin-bottom: 16px">
        <template #header-extra>
          <NRadioGroup v-model:value="viewMode" size="small">
            <NRadioButton value="timeline">Timeline</NRadioButton>
            <NRadioButton value="table">Table</NRadioButton>
          </NRadioGroup>
        </template>

        <template v-if="viewMode === 'timeline'">
          <NTimeline>
            <NTimelineItem
              v-for="ver in sortedVersions"
              :key="ver.version"
              :type="ver.version === entity.dossier.currentVersion ? 'success' : 'default'"
              :title="`v${ver.version}`"
              :time="formatDate(ver.createdAt)"
            >
              <div style="margin-bottom: 4px">
                <NTag v-if="ver.committedBy" size="small" type="info">{{ ver.committedBy }}</NTag>
                <span v-if="ver.commitMessage" style="margin-left: 8px; color: #666">{{ ver.commitMessage }}</span>
              </div>
              <div v-if="ver.patch && Object.keys(ver.patch).length > 0" style="margin-top: 4px">
                <div
                  v-for="field in formatPatch(ver.patch)"
                  :key="field.key"
                  style="font-size: 12px; font-family: monospace; padding: 2px 6px; background: #f5f5f5; border-radius: 3px; margin-bottom: 2px"
                >
                  <span style="color: #18a058; font-weight: 500">{{ field.key }}</span>: <span style="color: #333">{{ field.value }}</span>
                </div>
              </div>
            </NTimelineItem>
          </NTimeline>
        </template>

        <template v-else>
          <NDataTable
            :columns="versionCols"
            :data="entity.versions"
            :bordered="false"
            size="small"
          />
        </template>
      </NCard>

      <NCard title="Related Processes">
        <NDataTable
          :columns="processCols"
          :data="entity.relatedProcesses"
          :bordered="false"
          size="small"
          :row-props="(row: ProcessDef) => ({ style: 'cursor: pointer', onClick: () => goToProcess(row) })"
        />
      </NCard>
    </template>
  </NSpin>
</template>

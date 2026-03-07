<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NCard, NDescriptions, NDescriptionsItem, NTag, NButton, NDropdown, NCode, NTree, NSpin, NTabs, NTabPane, useMessage } from 'naive-ui'
import type { TreeOption, DropdownOption } from 'naive-ui'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { TreeChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useProcessStore } from '../stores'
import { VALID_TRANSITIONS, STATE_TAG_TYPE, formatDate } from '../utils'
import { STATE_COLORS } from '../constants'
import type { ProcessTreeNode } from '../api'

use([CanvasRenderer, TreeChart, TooltipComponent])

const route = useRoute()
const router = useRouter()
const processStore = useProcessStore()
const message = useMessage()

const processId = computed(() => route.params.id as string)

onMounted(() => processStore.fetchDetail(processId.value))

const proc = computed(() => processStore.detail?.process)
const contextJson = computed(() => {
  const snap = processStore.detail?.contextSnapshot
  return snap ? JSON.stringify(snap, null, 2) : 'No context snapshot'
})

const transitions = computed<DropdownOption[]>(() => {
  const state = proc.value?.state ?? ''
  return (VALID_TRANSITIONS[state] ?? []).map(s => ({ label: s, key: s }))
})

async function handleTransition(newState: string) {
  try {
    await processStore.transition(processId.value, newState)
    message.success(`Transitioned to ${newState}`)
  } catch (err: any) {
    message.error(err.message)
  }
}

function mapTree(node: ProcessTreeNode): TreeOption {
  return {
    key: node.process.id,
    label: `PID ${node.process.pid} — ${node.process.serviceId} [${node.process.state}]`,
    children: node.children.map(mapTree),
  }
}

const treeData = computed<TreeOption[]>(() => {
  const tree = processStore.detail?.tree
  return tree ? [mapTree(tree)] : []
})

function goToProcess(keys: string[]) {
  if (keys[0] && keys[0] !== processId.value) {
    router.push(`/processes/${keys[0]}`)
  }
}

// --- ECharts tree mapping ---

function mapTreeForECharts(node: ProcessTreeNode): Record<string, unknown> {
  return {
    name: `PID ${node.process.pid}`,
    value: node.process.id,
    itemStyle: { color: STATE_COLORS[node.process.state] ?? '#999', borderColor: '#333' },
    label: {
      formatter: `PID ${node.process.pid}\n${node.process.serviceId}\n[${node.process.state}]`,
      fontSize: 10,
      lineHeight: 14,
    },
    tooltip: { formatter: `<b>PID ${node.process.pid}</b><br/>Service: ${node.process.serviceId}<br/>State: ${node.process.state}` },
    children: node.children.map(mapTreeForECharts),
  }
}

const echartsTreeOption = computed(() => {
  const tree = processStore.detail?.tree
  if (!tree) return {}
  return {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'tree',
      data: [mapTreeForECharts(tree)],
      orient: 'TB',
      symbol: 'roundRect',
      symbolSize: [100, 50],
      expandAndCollapse: true,
      initialTreeDepth: -1,
      label: { position: 'inside', verticalAlign: 'middle', fontSize: 10 },
      leaves: { label: { position: 'inside' } },
      animationDuration: 400,
    }],
  }
})

function handleTreeClick(params: any) {
  const id = params.data?.value
  if (id && id !== processId.value) {
    router.push(`/processes/${id}`)
  }
}
</script>

<template>
  <NSpin :show="processStore.loading">
    <template v-if="proc">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">
        <h2 style="margin: 0">{{ proc.name || `Process ${proc.pid}` }}</h2>
        <NTag :type="STATE_TAG_TYPE[proc.state]" size="large">{{ proc.state }}</NTag>
      </div>

      <NCard title="Info" style="margin-bottom: 16px">
        <NDescriptions label-placement="left" :column="2" bordered>
          <NDescriptionsItem label="ID">{{ proc.id }}</NDescriptionsItem>
          <NDescriptionsItem label="PID">{{ proc.pid }}</NDescriptionsItem>
          <NDescriptionsItem label="Service">{{ proc.serviceId }}</NDescriptionsItem>
          <NDescriptionsItem label="Priority">{{ proc.priority }}</NDescriptionsItem>
          <NDescriptionsItem label="Entity Type">{{ proc.entityType ?? '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="Entity ID">{{ proc.entityId ?? '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="Operator">{{ proc.operatorId ?? '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="Creator">{{ proc.creatorId ?? '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="Created">{{ formatDate(proc.createdAt) }}</NDescriptionsItem>
          <NDescriptionsItem label="Updated">{{ formatDate(proc.updatedAt) }}</NDescriptionsItem>
          <NDescriptionsItem label="Start Time">{{ formatDate(proc.startTime) }}</NDescriptionsItem>
          <NDescriptionsItem label="End Time">{{ formatDate(proc.endTime) }}</NDescriptionsItem>
        </NDescriptions>
      </NCard>

      <NCard title="State Transition" style="margin-bottom: 16px" v-if="transitions.length > 0">
        <NDropdown :options="transitions" @select="handleTransition">
          <NButton type="primary">Transition State</NButton>
        </NDropdown>
      </NCard>

      <NCard title="Context Snapshot" style="margin-bottom: 16px">
        <NCode :code="contextJson" language="json" />
      </NCard>

      <NCard title="Process Tree" v-if="treeData.length > 0">
        <NTabs type="line" default-value="visual">
          <NTabPane name="visual" tab="Visual">
            <VChart
              :option="echartsTreeOption"
              style="height: 400px"
              autoresize
              @click="handleTreeClick"
            />
          </NTabPane>
          <NTabPane name="text" tab="Text">
            <NTree
              :data="treeData"
              block-line
              default-expand-all
              selectable
              @update:selected-keys="goToProcess"
            />
          </NTabPane>
        </NTabs>
      </NCard>
    </template>
  </NSpin>
</template>

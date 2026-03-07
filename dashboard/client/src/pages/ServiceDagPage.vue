<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NSelect, NSpin, NRadioGroup, NRadioButton, NButton, NSpace, NModal, NForm, NFormItem, NInput, useMessage } from 'naive-ui'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import dagre from '@dagrejs/dagre'
import { useDagStore, useServiceStore, useTrialRunStore } from '../stores'
import { STATE_COLORS, STATE_PRIORITY } from '../constants'
import TrialRunPanel from '../components/TrialRunPanel.vue'

use([CanvasRenderer, GraphChart, TooltipComponent, LegendComponent])

const router = useRouter()
const message = useMessage()
const dagStore = useDagStore()
const serviceStore = useServiceStore()
const trialStore = useTrialRunStore()

const selectedPipeline = ref<string | null>(null)
const direction = ref<'LR' | 'TB'>('LR')

// Trial run modal state
const showTrialModal = ref(false)
const trialServiceId = ref<string | null>(null)
const trialEntityType = ref('')
const trialEntityId = ref('')

let unsub: (() => void) | null = null
let trialUnsub: (() => void) | null = null
onMounted(async () => {
  await serviceStore.fetch()
  unsub = dagStore.subscribe(selectedPipeline.value ?? undefined)
})
onUnmounted(() => {
  unsub?.()
  trialUnsub?.()
})

watch(selectedPipeline, (val) => {
  unsub?.()
  unsub = dagStore.subscribe(val ?? undefined)
})

// SSE subscription for trial run
watch(() => trialStore.active, (active) => {
  trialUnsub?.()
  trialUnsub = null
  if (active) trialUnsub = trialStore.subscribe()
})

const trialServiceOptions = computed(() =>
  serviceStore.list
    .filter(s => s.serviceType === 'composite' && s.manualStart)
    .map(s => ({ label: s.label || s.id, value: s.id }))
)

// Auto-fill entityType when trial service is selected
watch(trialServiceId, (id) => {
  if (!id) return
  const svc = serviceStore.list.find(s => s.id === id)
  if (svc?.entityType) trialEntityType.value = svc.entityType
})

async function startTrialRun() {
  if (!trialServiceId.value) return
  try {
    await trialStore.start({
      serviceId: trialServiceId.value,
      entityType: trialEntityType.value || undefined,
      entityId: trialEntityId.value || undefined,
    })
    showTrialModal.value = false
    message.success('Trial run started')
  } catch (err: any) {
    message.error(err.message || 'Failed to start trial run')
  }
}

function stopTrialRun() {
  trialStore.reset()
  trialServiceId.value = null
  trialEntityType.value = ''
  trialEntityId.value = ''
}

const pipelineOptions = computed(() => {
  const composites = serviceStore.list.filter(s => s.serviceType === 'composite')
  return [
    { label: 'All Pipelines', value: '__all__' },
    ...composites.map(s => ({ label: s.label, value: s.id })),
  ]
})

function handlePipelineChange(val: string) {
  selectedPipeline.value = val === '__all__' ? null : val
}

const EXECUTOR_COLORS: Record<string, string> = {
  system: '#5470c6',
  agent: '#ee6666',
  manual: '#91cc75',
}

/** Estimate label width: CJK chars ~14px, ASCII ~8px */
function estimateLabelWidth(label: string): number {
  let w = 0
  for (const ch of label) {
    w += ch.charCodeAt(0) > 0x7f ? 14 : 8
  }
  return Math.max(w + 24, 60)
}

const NODE_HEIGHT = 40

/** Get the highest-priority state from a service's activity map */
function getTopState(stateMap: Record<string, number>): { state: string; total: number } {
  let topState = ''
  let topPriority = -1
  let total = 0
  for (const [state, count] of Object.entries(stateMap)) {
    total += count
    const p = STATE_PRIORITY[state] ?? 0
    if (p > topPriority) {
      topPriority = p
      topState = state
    }
  }
  return { state: topState, total }
}

/** Core layout computation — shared by chartOption and chartStyle */
const layoutResult = computed(() => {
  const rules = dagStore.rules
  if (!rules.length) return null

  // Collect unique service nodes
  const nodeMap = new Map<string, { id: string; label: string; serviceType: string; executorType: string }>()
  for (const r of rules) {
    if (r.serviceId && !nodeMap.has(r.serviceId)) {
      nodeMap.set(r.serviceId, { id: r.serviceId, label: r.serviceLabel || r.serviceId, serviceType: r.serviceType, executorType: r.executorType })
    }
    if (r.operandServiceId && !nodeMap.has(r.operandServiceId)) {
      nodeMap.set(r.operandServiceId, { id: r.operandServiceId, label: r.operandServiceLabel || r.operandServiceId, serviceType: r.operandServiceType, executorType: r.operandExecutorType })
    }
  }

  // Build dagre graph
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction.value, nodesep: 80, ranksep: 160, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodeMap.values()) {
    g.setNode(n.id, { width: estimateLabelWidth(n.label), height: NODE_HEIGHT })
  }

  // Deduplicate edges, merge labels
  const edgeGroupMap = new Map<string, { source: string; target: string; labels: string[]; hasNonDet: boolean }>()
  for (const r of rules) {
    if (r.serviceId && r.operandServiceId) {
      const key = `${r.serviceId}->${r.operandServiceId}`
      if (!edgeGroupMap.has(key)) {
        edgeGroupMap.set(key, { source: r.serviceId, target: r.operandServiceId, labels: [], hasNonDet: false })
        g.setEdge(r.serviceId, r.operandServiceId)
      }
      const group = edgeGroupMap.get(key)!
      if (r.eventLabel) group.labels.push(r.eventLabel)
      if (r.evaluationMode === 'non_deterministic') group.hasNonDet = true
    }
  }

  dagre.layout(g)

  const graphInfo = g.graph() as { width: number; height: number }
  return { g, nodeMap, edgeGroupMap, graphWidth: graphInfo.width, graphHeight: graphInfo.height }
})

/** Dynamic chart container size based on dagre output */
const chartStyle = computed(() => {
  if (!layoutResult.value) return { width: '100%', height: '400px' }
  const { graphWidth, graphHeight } = layoutResult.value
  // Ensure minimum dimensions, add padding for legend/tooltip
  const w = Math.max(graphWidth + 80, 600)
  const h = Math.max(graphHeight + 120, 400)
  return { width: w + 'px', height: h + 'px' }
})

const chartOption = computed(() => {
  const lr = layoutResult.value
  if (!lr) return {}

  const { g, nodeMap, edgeGroupMap } = lr
  const act = dagStore.activity

  const nodes = [...nodeMap.values()].map(n => {
    const pos = g.node(n.id)
    const isComposite = n.serviceType === 'composite'
    const svcActivity = act[n.id]

    // Base style
    let borderColor = isComposite ? '#333' : '#ccc'
    let borderWidth = isComposite ? 3 : 1
    let shadowBlur = 0
    let shadowColor = 'transparent'
    let displayLabel = n.label

    if (svcActivity) {
      const { state: topState, total } = getTopState(svcActivity)
      borderColor = STATE_COLORS[topState] ?? borderColor
      borderWidth = 3
      displayLabel = `${n.label} (${total})`

      // RUNNING glow effect
      if (topState === 'RUNNING') {
        shadowBlur = 15
        shadowColor = STATE_COLORS.RUNNING
      }
    }

    return {
      id: n.id,
      name: displayLabel,
      x: pos.x,
      y: pos.y,
      symbol: 'roundRect',
      symbolSize: [estimateLabelWidth(displayLabel), NODE_HEIGHT],
      itemStyle: {
        color: EXECUTOR_COLORS[n.executorType] ?? '#999',
        borderWidth,
        borderColor,
        borderRadius: 4,
        shadowBlur,
        shadowColor,
      },
      category: n.executorType,
      // Store extra data for tooltip
      serviceId: n.id,
      executorType: n.executorType,
      activity: svcActivity ?? null,
      label: { show: true, fontSize: 12, color: '#fff', fontWeight: isComposite ? 'bold' as const : 'normal' as const },
    }
  })

  const edges = [...edgeGroupMap.values()].map(eg => {
    const combinedLabel = eg.labels.join(' / ')
    return {
      source: eg.source,
      target: eg.target,
      label: {
        show: !!combinedLabel,
        formatter: combinedLabel,
        fontSize: 10,
        color: '#666',
        backgroundColor: 'rgba(255,255,255,0.85)',
        padding: [2, 4],
        borderRadius: 2,
      },
      lineStyle: {
        type: eg.hasNonDet ? 'dashed' as const : 'solid' as const,
        color: eg.hasNonDet ? '#ee6666' : '#999',
        width: eg.hasNonDet ? 2.5 : 1.5,
      },
    }
  })

  const categories = [
    { name: 'system' },
    { name: 'agent' },
    { name: 'manual' },
  ]

  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        if (p.dataType === 'node') {
          const d = p.data
          let tip = `<b>${p.name}</b><br/>ID: ${d.serviceId}<br/>Type: ${d.executorType}`
          if (d.activity) {
            tip += '<br/><br/>Active processes:'
            for (const [state, count] of Object.entries(d.activity as Record<string, number>)) {
              tip += `<br/>&nbsp;&nbsp;${state}: ${count}`
            }
          }
          return tip
        }
        if (p.dataType === 'edge') {
          const style = p.data.lineStyle?.type === 'dashed' ? ' (LLM)' : ''
          return `${p.data.label?.formatter ?? ''}${style}`
        }
        return ''
      },
    },
    legend: {
      data: categories.map(c => c.name),
      top: 10,
    },
    series: [{
      type: 'graph',
      layout: 'none',
      roam: true,
      scaleLimit: { min: 0.3, max: 3 },
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: 10,
      categories,
      data: nodes,
      links: edges,
      emphasis: { focus: 'adjacency' },
      lineStyle: { color: '#999', width: 1.5 },
    }],
  }
})

function handleChartClick(params: any) {
  if (params.dataType === 'node') {
    router.push({ path: '/processes', query: { serviceId: params.data.serviceId } })
  }
}
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap">
      <h2 style="margin: 0">Flow Topology</h2>
      <NSelect
        :value="selectedPipeline ?? '__all__'"
        :options="pipelineOptions"
        style="width: 280px"
        @update:value="handlePipelineChange"
      />
      <NRadioGroup v-model:value="direction" size="small">
        <NRadioButton value="LR">LR</NRadioButton>
        <NRadioButton value="TB">TB</NRadioButton>
      </NRadioGroup>
      <div style="margin-left: auto">
        <NSpace>
          <NButton v-if="!trialStore.active" type="primary" @click="showTrialModal = true">
            Trial Run
          </NButton>
          <NButton v-if="trialStore.active" type="warning" @click="stopTrialRun">
            Stop Trial
          </NButton>
        </NSpace>
      </div>
    </div>
    <NSpin :show="dagStore.loading">
      <NCard>
        <div style="overflow: auto">
          <VChart
            :option="chartOption"
            :style="chartStyle"
            autoresize
            @click="handleChartClick"
          />
        </div>
      </NCard>
    </NSpin>

    <TrialRunPanel v-if="trialStore.active" />

    <!-- Trial Run Launch Modal -->
    <NModal v-model:show="showTrialModal">
      <NCard title="Start Trial Run" style="width: 480px" :bordered="false" closable @close="showTrialModal = false">
        <NForm label-placement="left" label-width="100">
          <NFormItem label="Pipeline" required>
            <NSelect
              v-model:value="trialServiceId"
              :options="trialServiceOptions"
              placeholder="Select a composite service"
              filterable
            />
          </NFormItem>
          <NFormItem label="Entity Type">
            <NInput v-model:value="trialEntityType" placeholder="e.g. order" />
          </NFormItem>
          <NFormItem label="Entity ID">
            <NInput v-model:value="trialEntityId" placeholder="e.g. trial-001" />
          </NFormItem>
        </NForm>
        <NSpace justify="end">
          <NButton @click="showTrialModal = false">Cancel</NButton>
          <NButton type="primary" :disabled="!trialServiceId" :loading="trialStore.loading" @click="startTrialRun">
            Start
          </NButton>
        </NSpace>
      </NCard>
    </NModal>
  </div>
</template>

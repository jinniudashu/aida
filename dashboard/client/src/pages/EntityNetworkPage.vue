<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NSelect, NSwitch, NSpin } from 'naive-ui'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useEntityNetworkStore } from '../stores'

use([CanvasRenderer, GraphChart, TooltipComponent, LegendComponent])

const router = useRouter()
const store = useEntityNetworkStore()

const selectedType = ref<string | null>(null)
const showEdgeLabels = ref(true)

let unsub: (() => void) | null = null
onMounted(() => { unsub = store.subscribe(selectedType.value ?? undefined) })
onUnmounted(() => { unsub?.() })

watch(selectedType, (val) => {
  unsub?.()
  unsub = store.subscribe(val ?? undefined)
})

const typeOptions = computed(() => [
  { label: 'All Types', value: '__all__' },
  { label: 'Order', value: 'order' },
  { label: 'Customer', value: 'customer' },
])

function handleTypeChange(val: string) {
  selectedType.value = val === '__all__' ? null : val
}

const TYPE_COLORS: Record<string, string> = {
  order: '#5470c6',
  customer: '#91cc75',
}

const chartOption = computed(() => {
  const net = store.network
  if (!net || !net.nodes.length) return {}

  // Collect unique entity types for categories
  const types = [...new Set(net.nodes.map(n => n.entityType))]
  const categories = types.map(t => ({ name: t }))
  const typeIndex = new Map(types.map((t, i) => [t, i]))

  const nodes = net.nodes.map(n => ({
    id: n.id,
    name: n.entityId,
    symbolSize: 40,
    category: typeIndex.get(n.entityType) ?? 0,
    itemStyle: { color: TYPE_COLORS[n.entityType] ?? '#999' },
    label: { show: true, fontSize: 11 },
    entityType: n.entityType,
    lifecycle: n.lifecycle,
  }))

  const edges = net.edges.map(e => ({
    source: e.source,
    target: e.target,
    label: {
      show: showEdgeLabels.value,
      formatter: e.relation,
      fontSize: 9,
    },
    lineStyle: {
      type: e.relation === 'process' ? ('dashed' as const) : ('solid' as const),
      curveness: 0.1,
    },
  }))

  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        if (p.dataType === 'node') return `<b>${p.name}</b><br/>Type: ${p.data.entityType}<br/>Lifecycle: ${p.data.lifecycle}`
        if (p.dataType === 'edge') return `${p.data.label?.formatter ?? ''}`
        return ''
      },
    },
    legend: {
      data: types,
      top: 10,
    },
    series: [{
      type: 'graph',
      layout: 'force',
      roam: true,
      draggable: true,
      force: { repulsion: 250, edgeLength: 120 },
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: 8,
      categories,
      data: nodes,
      links: edges,
      emphasis: { focus: 'adjacency' },
      lineStyle: { color: '#aaa', width: 1.5 },
    }],
  }
})

function handleChartClick(params: any) {
  if (params.dataType === 'node') {
    router.push(`/entities/${params.data.id}`)
  }
}
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">
      <h2 style="margin: 0">Entity Network</h2>
      <NSelect
        :value="selectedType ?? '__all__'"
        :options="typeOptions"
        style="width: 200px"
        @update:value="handleTypeChange"
      />
      <span style="margin-left: auto; display: flex; align-items: center; gap: 6px">
        <span style="font-size: 13px">Edge labels</span>
        <NSwitch v-model:value="showEdgeLabels" />
      </span>
    </div>
    <NSpin :show="store.loading && !store.network">
      <NCard>
        <VChart
          :option="chartOption"
          style="height: 600px"
          autoresize
          @click="handleChartClick"
        />
      </NCard>
    </NSpin>
  </div>
</template>

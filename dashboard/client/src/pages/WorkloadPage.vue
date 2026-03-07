<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NGrid, NGi, NTag, NSpin } from 'naive-ui'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { CustomChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useWorkloadStore } from '../stores'
import { STATE_TAG_TYPE } from '../utils'
import { STATE_COLORS } from '../constants'

use([CanvasRenderer, CustomChart, GridComponent, TooltipComponent, DataZoomComponent])

const router = useRouter()
const store = useWorkloadStore()

let unsub: (() => void) | null = null
onMounted(() => { unsub = store.subscribe() })
onUnmounted(() => { unsub?.() })

const chartOption = computed(() => {
  if (!store.data) return {}
  const { operators, timeline } = store.data
  if (!timeline.length) return {}

  // Operator names for Y-axis categories
  const opLabels = operators.map(o => o.label)
  const opIdToIndex = new Map(operators.map((o, i) => [o.operatorId, i]))

  // Determine time range
  const now = Date.now()
  let minTime = now
  let maxTime = now
  for (const p of timeline) {
    const st = p.startTime ? new Date(p.startTime).getTime() : new Date(p.createdAt).getTime()
    const et = p.endTime ? new Date(p.endTime).getTime() : now
    if (st < minTime) minTime = st
    if (et > maxTime) maxTime = et
  }

  // Prepare data for custom series
  const data = timeline
    .filter(p => opIdToIndex.has(p.operatorId))
    .map(p => {
      const catIdx = opIdToIndex.get(p.operatorId)!
      const st = p.startTime ? new Date(p.startTime).getTime() : new Date(p.createdAt).getTime()
      const et = p.endTime ? new Date(p.endTime).getTime() : now
      return {
        value: [st, et, catIdx],
        itemStyle: { color: STATE_COLORS[p.state] ?? '#999' },
        processId: p.id,
        pid: p.pid,
        state: p.state,
        serviceId: p.serviceId,
      }
    })

  return {
    tooltip: {
      formatter: (p: any) => {
        const d = p.data
        if (!d) return ''
        return `PID ${d.pid}<br/>Service: ${d.serviceId}<br/>State: ${d.state}<br/>${new Date(d.value[0]).toLocaleString()} — ${new Date(d.value[1]).toLocaleString()}`
      },
    },
    grid: { left: 120, right: 40, top: 20, bottom: 60 },
    xAxis: {
      type: 'time' as const,
      min: minTime,
      max: maxTime,
    },
    yAxis: {
      type: 'category' as const,
      data: opLabels,
      axisTick: { show: false },
    },
    dataZoom: [{
      type: 'slider' as const,
      xAxisIndex: 0,
      filterMode: 'weakFilter' as const,
      height: 20,
      bottom: 5,
    }],
    series: [{
      type: 'custom',
      renderItem: (params: any, api: any) => {
        const catIdx = api.value(2)
        const st = api.coord([api.value(0), catIdx])
        const et = api.coord([api.value(1), catIdx])
        const barHeight = 16
        return {
          type: 'rect',
          shape: {
            x: st[0],
            y: st[1] - barHeight / 2,
            width: Math.max(et[0] - st[0], 3),
            height: barHeight,
          },
          style: api.style(),
        }
      },
      encode: { x: [0, 1], y: 2 },
      data,
    }],
  }
})

function handleChartClick(params: any) {
  const processId = params.data?.processId
  if (processId) router.push(`/processes/${processId}`)
}
</script>

<template>
  <div>
    <h2 style="margin: 0 0 16px 0">Operator Workload</h2>

    <NSpin :show="store.loading && !store.data">
      <template v-if="store.data">
        <NGrid :x-gap="16" :y-gap="16" :cols="4" style="margin-bottom: 24px">
          <NGi v-for="op in store.data.operators" :key="op.operatorId">
            <NCard :title="op.label" size="small">
              <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px">
                <span style="font-size: 24px; font-weight: bold">{{ op.total }}</span>
                <span style="color: #999; font-size: 12px">total</span>
                <span v-if="op.active > 0" style="color: #18a058; font-size: 12px; margin-left: auto">{{ op.active }} active</span>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px">
                <NTag
                  v-for="(count, state) in op.byState"
                  :key="state"
                  :type="STATE_TAG_TYPE[state as string]"
                  size="small"
                >
                  {{ state }}: {{ count }}
                </NTag>
              </div>
            </NCard>
          </NGi>
        </NGrid>

        <NCard title="Swimlane Timeline">
          <VChart
            :option="chartOption"
            style="height: 350px"
            autoresize
            @click="handleChartClick"
          />
        </NCard>
      </template>
    </NSpin>
  </div>
</template>

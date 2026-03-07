<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NGrid, NGi, NCard, NTag, NSelect, NScrollbar, NBadge, NSpin, NButton, useMessage } from 'naive-ui'
import { useProcessStore, useServiceStore } from '../stores'
import { ALL_STATES, STATE_TAG_TYPE, VALID_TRANSITIONS, formatDate, formatDuration } from '../utils'
import type { ProcessDef } from '../api'
import CreateProcessModal from '../components/CreateProcessModal.vue'

const router = useRouter()
const message = useMessage()
const processStore = useProcessStore()
const serviceStore = useServiceStore()

const filterServiceId = ref<string | null>(null)
const filterEntityType = ref<string | null>(null)
const showCreateModal = ref(false)

// Drag-and-drop state
const dragData = ref<{ processId: string; fromState: string } | null>(null)
const dropTargetState = ref<string | null>(null)

function onDragStart(e: DragEvent, proc: ProcessDef) {
  dragData.value = { processId: proc.id, fromState: proc.state }
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragEnd() {
  dragData.value = null
  dropTargetState.value = null
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
}

function onDragEnter(state: string) {
  dropTargetState.value = state
}

function onDragLeave(e: DragEvent, state: string) {
  const related = e.relatedTarget as HTMLElement | null
  const currentTarget = e.currentTarget as HTMLElement
  if (!related || !currentTarget.contains(related)) {
    if (dropTargetState.value === state) dropTargetState.value = null
  }
}

async function onDrop(targetState: string) {
  dropTargetState.value = null
  if (!dragData.value) return
  const { processId, fromState } = dragData.value
  dragData.value = null

  if (fromState === targetState) return

  const allowed = VALID_TRANSITIONS[fromState] ?? []
  if (!allowed.includes(targetState)) {
    message.error(`Cannot transition from ${fromState} to ${targetState}`)
    return
  }

  try {
    await processStore.transition(processId, targetState)
    message.success(`Process transitioned to ${targetState}`)
  } catch (err: any) {
    message.error(err.message || 'Transition failed')
  }
}

let unsub: (() => void) | null = null

function startSubscribe() {
  unsub?.()
  const filter: { serviceId?: string; entityType?: string } = {}
  if (filterServiceId.value) filter.serviceId = filterServiceId.value
  if (filterEntityType.value) filter.entityType = filterEntityType.value
  unsub = processStore.subscribeKanban(filter)
}

onMounted(() => {
  serviceStore.fetch()
  startSubscribe()
})
onUnmounted(() => { unsub?.() })

watch([filterServiceId, filterEntityType], () => startSubscribe())

const serviceOptions = () => serviceStore.list.map(s => ({ label: s.label || s.id, value: s.id }))
const entityTypeOptions = () => {
  const types = new Set(serviceStore.list.map(s => s.entityType).filter(Boolean))
  return [...types].map(t => ({ label: t!, value: t! }))
}

function columnForState(state: string) {
  return processStore.kanban.find(c => c.state === state) ?? { state, processes: [], count: 0 }
}

function goToProcess(id: string) {
  router.push(`/processes/${id}`)
}
</script>

<template>
  <div>
    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center">
      <NSelect
        v-model:value="filterServiceId"
        :options="serviceOptions()"
        placeholder="All Services"
        clearable
        style="width: 200px"
      />
      <NSelect
        v-model:value="filterEntityType"
        :options="entityTypeOptions()"
        placeholder="All Entity Types"
        clearable
        style="width: 200px"
      />
      <NButton type="primary" @click="showCreateModal = true">New Process</NButton>
    </div>

    <NSpin :show="processStore.loading && processStore.kanban.length === 0">
      <NGrid :x-gap="8" :cols="7" style="min-height: 400px">
        <NGi v-for="state in ALL_STATES" :key="state">
          <NCard
            size="small"
            :style="{
              height: '100%',
              border: dropTargetState === state ? '2px solid #18a058' : undefined,
              transition: 'border 0.15s',
            }"
            @dragover="onDragOver"
            @dragenter="onDragEnter(state)"
            @dragleave="(e: DragEvent) => onDragLeave(e, state)"
            @drop="onDrop(state)"
          >
            <template #header>
              <div style="display: flex; align-items: center; justify-content: space-between">
                <NTag :type="STATE_TAG_TYPE[state]" size="small">{{ state }}</NTag>
                <NBadge :value="columnForState(state).count" />
              </div>
            </template>
            <NScrollbar style="max-height: 70vh">
              <NCard
                v-for="proc in columnForState(state).processes"
                :key="proc.id"
                size="small"
                hoverable
                draggable="true"
                :style="{ marginBottom: '8px', cursor: dragData ? 'grabbing' : 'grab' }"
                @click="goToProcess(proc.id)"
                @dragstart="(e: DragEvent) => onDragStart(e, proc)"
                @dragend="onDragEnd"
              >
                <div style="font-size: 12px; font-weight: 500">[PID-{{ proc.pid }}] {{ proc.name || proc.serviceId }}</div>
                <div v-if="proc.entityType" style="font-size: 11px; color: #888">
                  {{ proc.entityType }}/{{ proc.entityId }}
                </div>
                <div v-if="proc.operatorLabel" style="font-size: 11px; color: #666">
                  👤 {{ proc.operatorLabel }}
                </div>
                <div style="font-size: 11px; color: #888">
                  ⏱ {{ formatDuration(proc.startTime, proc.endTime) }}
                </div>
                <div style="font-size: 10px; color: #bbb; margin-top: 4px">
                  {{ proc.serviceId }}
                </div>
              </NCard>
            </NScrollbar>
          </NCard>
        </NGi>
      </NGrid>
    </NSpin>

    <CreateProcessModal v-model:show="showCreateModal" />
  </div>
</template>

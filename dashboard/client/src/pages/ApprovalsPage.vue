<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, h } from 'vue'
import { NDataTable, NSelect, NTag, NSpin, NButton, NModal, NInput, NSpace, NEmpty } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useApprovalsStore } from '../stores'
import { formatDate } from '../utils'
import type { ApprovalItem } from '../api'

const store = useApprovalsStore()
let unsub: (() => void) | null = null

const filterStatus = ref<string>('pending')
const showDecisionModal = ref(false)
const selectedApproval = ref<ApprovalItem | null>(null)
const decisionReason = ref('')

onMounted(() => { unsub = store.subscribe(filterStatus.value) })
onUnmounted(() => { unsub?.() })

watch(filterStatus, () => store.fetch(filterStatus.value))

const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'All', value: 'all' },
]

function openDecision(row: ApprovalItem) {
  selectedApproval.value = row
  decisionReason.value = ''
  showDecisionModal.value = true
}

async function submitDecision(decision: 'approved' | 'rejected') {
  if (!selectedApproval.value) return
  await store.decide(selectedApproval.value.approvalId, {
    decision,
    reason: decisionReason.value || undefined,
  })
  showDecisionModal.value = false
  selectedApproval.value = null
}

const columns: DataTableColumns<ApprovalItem> = [
  {
    title: 'Status', key: 'status', width: 100,
    render: (r) => {
      const typeMap: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
        pending: 'warning', approved: 'success', rejected: 'error',
      }
      return h(NTag, { type: typeMap[r.status] ?? 'default', size: 'small' }, () => r.status)
    },
  },
  { title: 'Question', key: 'question', ellipsis: { tooltip: true } },
  { title: 'Service', key: 'serviceId', width: 160, render: (r) => r.serviceId ?? '-' },
  { title: 'Requested By', key: 'requestedBy', width: 140, render: (r) => r.requestedBy ?? '-' },
  { title: 'Requested At', key: 'requestedAt', width: 180, render: (r) => formatDate(r.requestedAt) },
  { title: 'Decided By', key: 'decidedBy', width: 140, render: (r) => r.decidedBy ?? '-' },
  {
    title: 'Action', key: 'action', width: 100,
    render: (r) => {
      if (r.status !== 'pending') return '-'
      return h(NButton, { size: 'small', type: 'primary', onClick: () => openDecision(r) }, () => 'Decide')
    },
  },
]
</script>

<template>
  <div>
    <h2 style="margin-top: 0">Approvals</h2>
    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center">
      <NSelect
        v-model:value="filterStatus"
        :options="statusOptions"
        style="width: 160px"
      />
    </div>

    <NSpin :show="store.loading">
      <NEmpty v-if="store.items.length === 0 && !store.loading" description="No approval requests" />
      <NDataTable
        v-else
        :columns="columns"
        :data="store.items"
        :bordered="false"
        :row-key="(r: ApprovalItem) => r.id"
      />
    </NSpin>

    <NModal v-model:show="showDecisionModal" preset="card" title="Approval Decision" style="width: 500px">
      <div v-if="selectedApproval">
        <p><strong>Question:</strong> {{ selectedApproval.question }}</p>
        <p v-if="selectedApproval.context"><strong>Context:</strong> {{ selectedApproval.context }}</p>
        <p v-if="selectedApproval.serviceId"><strong>Service:</strong> {{ selectedApproval.serviceId }}</p>

        <NInput
          v-model:value="decisionReason"
          type="textarea"
          placeholder="Reason for your decision (optional)"
          :rows="3"
          style="margin: 16px 0"
        />

        <NSpace justify="end">
          <NButton type="error" @click="submitDecision('rejected')">Reject</NButton>
          <NButton type="success" @click="submitDecision('approved')">Approve</NButton>
        </NSpace>
      </div>
    </NModal>
  </div>
</template>

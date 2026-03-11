<script setup lang="ts">
import { ref, onMounted, onUnmounted, h, computed } from 'vue'
import { NDataTable, NTag, NSpin, NButton, NModal, NSpace, NEmpty, NCard, NStatistic, NGrid, NGi, NAlert, NDescriptions, NDescriptionsItem, NPopconfirm } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useManagementStore } from '../stores'
import { formatDate } from '../utils'
import type { ManagementConstraint, ManagementViolation, ManagementApproval } from '../api'

const store = useManagementStore()
let unsub: (() => void) | null = null

onMounted(() => { unsub = store.subscribe() })
onUnmounted(() => { unsub?.() })

// --- Circuit Breaker ---

const cbStateType = computed<'default' | 'success' | 'warning' | 'error' | 'info'>(() => {
  const s = store.status?.circuitBreaker.state
  if (s === 'NORMAL') return 'success'
  if (s === 'WARNING') return 'warning'
  if (s === 'RESTRICTED' || s === 'DISCONNECTED') return 'error'
  return 'default'
})

// --- Approval decision modal ---

const showDecisionModal = ref(false)
const selectedApproval = ref<ManagementApproval | null>(null)
const executionResult = ref<Record<string, unknown> | null>(null)
const showResultModal = ref(false)

function openDecision(row: ManagementApproval) {
  selectedApproval.value = row
  showDecisionModal.value = true
}

async function submitDecision(decision: 'APPROVED' | 'REJECTED') {
  if (!selectedApproval.value) return
  const result = await store.decideApproval(selectedApproval.value.id, decision)
  showDecisionModal.value = false
  selectedApproval.value = null

  if (decision === 'APPROVED' && result.executionResult) {
    executionResult.value = result.executionResult
    showResultModal.value = true
  }
}

// --- Constraint columns ---

const constraintColumns: DataTableColumns<ManagementConstraint> = [
  { title: 'ID', key: 'id', width: 180 },
  { title: 'Policy', key: 'policyId', width: 140 },
  { title: 'Label', key: 'label', ellipsis: { tooltip: true } },
  {
    title: 'Severity', key: 'severity', width: 100,
    render: (r) => {
      const type = r.severity === 'CRITICAL' ? 'error' : r.severity === 'HIGH' ? 'warning' : 'info'
      return h(NTag, { type, size: 'small' }, () => r.severity)
    },
  },
  {
    title: 'Action', key: 'onViolation', width: 160,
    render: (r) => h(NTag, { type: r.onViolation === 'BLOCK' ? 'error' : 'warning', size: 'small' }, () => r.onViolation),
  },
  { title: 'Condition', key: 'condition', width: 200, ellipsis: { tooltip: true } },
  {
    title: 'Scope', key: 'scope', width: 200,
    render: (r) => {
      const parts: string[] = []
      parts.push(r.scope.tools.join(', '))
      if (r.scope.entityTypes?.length) parts.push(`entity: ${r.scope.entityTypes.join(', ')}`)
      if (r.scope.dataFields?.length) parts.push(`fields: ${r.scope.dataFields.join(', ')}`)
      return parts.join(' | ')
    },
  },
]

// --- Violation columns ---

const violationColumns: DataTableColumns<ManagementViolation> = [
  {
    title: 'Severity', key: 'severity', width: 100,
    render: (r) => {
      const type = r.severity === 'CRITICAL' ? 'error' : r.severity === 'HIGH' ? 'warning' : 'info'
      return h(NTag, { type, size: 'small' }, () => r.severity)
    },
  },
  { title: 'Constraint', key: 'constraintId', width: 180 },
  { title: 'Tool', key: 'tool', width: 160 },
  { title: 'Entity', key: 'entity', width: 160, render: (r) => r.entityType && r.entityId ? `${r.entityType}/${r.entityId}` : '-' },
  { title: 'Message', key: 'message', ellipsis: { tooltip: true } },
  {
    title: 'Verdict', key: 'verdict', width: 140,
    render: (r) => {
      if (!r.verdict) return '-'
      const type = r.verdict === 'BLOCK' ? 'error' : 'warning'
      return h(NTag, { type, size: 'small' }, () => r.verdict)
    },
  },
  { title: 'Time', key: 'createdAt', width: 180, render: (r) => formatDate(r.createdAt) },
]

// --- Approval columns ---

const approvalColumns: DataTableColumns<ManagementApproval> = [
  {
    title: 'Status', key: 'status', width: 100,
    render: (r) => {
      const type = r.status === 'PENDING' ? 'warning' : r.status === 'APPROVED' ? 'success' : 'error'
      return h(NTag, { type, size: 'small' }, () => r.status)
    },
  },
  { title: 'Constraint', key: 'constraintId', width: 180 },
  { title: 'Tool', key: 'tool', width: 160 },
  { title: 'Entity', key: 'entity', width: 160, render: (r) => r.entityType && r.entityId ? `${r.entityType}/${r.entityId}` : '-' },
  { title: 'Message', key: 'message', ellipsis: { tooltip: true } },
  { title: 'Created', key: 'createdAt', width: 170, render: (r) => formatDate(r.createdAt) },
  { title: 'Expires', key: 'expiresAt', width: 170, render: (r) => formatDate(r.expiresAt) },
  {
    title: 'Action', key: 'action', width: 100,
    render: (r) => {
      if (r.status !== 'PENDING') return r.approvedBy ?? '-'
      return h(NButton, { size: 'small', type: 'primary', onClick: () => openDecision(r) }, () => 'Decide')
    },
  },
]
</script>

<template>
  <div>
    <h2 style="margin-top: 0">Management</h2>

    <NSpin :show="store.loading">
      <!-- Panel 1: Circuit Breaker -->
      <NCard title="Circuit Breaker" size="small" style="margin-bottom: 16px">
        <NGrid :cols="4" :x-gap="16">
          <NGi>
            <NStatistic label="State">
              <NTag :type="cbStateType" size="large">
                {{ store.status?.circuitBreaker.state ?? 'UNKNOWN' }}
              </NTag>
            </NStatistic>
          </NGi>
          <NGi>
            <NStatistic label="Active Constraints" :value="store.status?.constraintCount ?? 0" />
          </NGi>
          <NGi>
            <NStatistic label="Pending Approvals" :value="store.approvals.length" />
          </NGi>
          <NGi>
            <NStatistic label="Last State Change">
              <span style="font-size: 14px">{{ formatDate(store.status?.circuitBreaker.lastStateChange) }}</span>
            </NStatistic>
          </NGi>
        </NGrid>

        <NAlert
          v-if="store.status?.circuitBreaker.state === 'RESTRICTED' || store.status?.circuitBreaker.state === 'DISCONNECTED'"
          type="error"
          style="margin-top: 12px"
        >
          Agent write operations are {{ store.status?.circuitBreaker.state === 'DISCONNECTED' ? 'fully blocked' : 'restricted' }}.
          <NPopconfirm @positive-click="store.resetCircuitBreaker()">
            <template #trigger>
              <NButton size="small" type="warning" style="margin-left: 12px">Reset to NORMAL</NButton>
            </template>
            Reset the circuit breaker to NORMAL? This re-enables all agent write operations.
          </NPopconfirm>
        </NAlert>
      </NCard>

      <!-- Panel 2: Constraints -->
      <NCard title="Constraints" size="small" style="margin-bottom: 16px">
        <NEmpty v-if="store.constraints.length === 0" description="No constraints loaded" />
        <NDataTable
          v-else
          :columns="constraintColumns"
          :data="store.constraints"
          :bordered="false"
          :row-key="(r: ManagementConstraint) => r.id"
          size="small"
          :max-height="300"
        />
      </NCard>

      <!-- Panel 3: Management Approvals -->
      <NCard title="Management Approvals" size="small" style="margin-bottom: 16px">
        <NEmpty v-if="store.approvals.length === 0" description="No pending management approvals" />
        <NDataTable
          v-else
          :columns="approvalColumns"
          :data="store.approvals"
          :bordered="false"
          :row-key="(r: ManagementApproval) => r.id"
          size="small"
          :max-height="300"
        />
      </NCard>

      <!-- Panel 4: Violation History -->
      <NCard title="Violation History" size="small">
        <NEmpty v-if="store.violations.length === 0" description="No violations recorded" />
        <NDataTable
          v-else
          :columns="violationColumns"
          :data="store.violations"
          :bordered="false"
          :row-key="(r: ManagementViolation) => r.id"
          size="small"
          :max-height="400"
        />
      </NCard>
    </NSpin>

    <!-- Decision modal -->
    <NModal v-model:show="showDecisionModal" preset="card" title="Management Approval Decision" style="width: 600px">
      <div v-if="selectedApproval">
        <NDescriptions bordered :column="1" size="small">
          <NDescriptionsItem label="Constraint">{{ selectedApproval.constraintId }}</NDescriptionsItem>
          <NDescriptionsItem label="Tool">{{ selectedApproval.tool }}</NDescriptionsItem>
          <NDescriptionsItem label="Entity">
            {{ selectedApproval.entityType && selectedApproval.entityId
              ? `${selectedApproval.entityType}/${selectedApproval.entityId}`
              : '-' }}
          </NDescriptionsItem>
          <NDescriptionsItem label="Message">{{ selectedApproval.message }}</NDescriptionsItem>
          <NDescriptionsItem label="Tool Input">
            <pre style="margin: 0; font-size: 12px; white-space: pre-wrap">{{ JSON.stringify(selectedApproval.toolInput, null, 2) }}</pre>
          </NDescriptionsItem>
          <NDescriptionsItem label="Expires">{{ formatDate(selectedApproval.expiresAt) }}</NDescriptionsItem>
        </NDescriptions>

        <NSpace justify="end" style="margin-top: 16px">
          <NButton type="error" @click="submitDecision('REJECTED')">Reject</NButton>
          <NButton type="success" @click="submitDecision('APPROVED')">Approve</NButton>
        </NSpace>
      </div>
    </NModal>

    <!-- Execution result modal (shown after approval) -->
    <NModal v-model:show="showResultModal" preset="card" title="Operation Executed" style="width: 500px">
      <NAlert v-if="executionResult?.success" type="success" style="margin-bottom: 12px">
        The approved operation was executed successfully.
      </NAlert>
      <NAlert v-else type="error" style="margin-bottom: 12px">
        The approved operation failed to execute.
      </NAlert>
      <pre style="font-size: 12px; white-space: pre-wrap; background: #f5f5f5; padding: 12px; border-radius: 4px">{{ JSON.stringify(executionResult, null, 2) }}</pre>
    </NModal>
  </div>
</template>

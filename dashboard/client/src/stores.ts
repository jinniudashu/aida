import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from './api'
import { sse } from './sse'
import type { DashboardOverview, KanbanColumn, ProcessDef, ProcessDetail, DossierSearchResult, EntityDetail, ServiceDef, TimeSeriesPoint, RuleEdge, OperatorWorkload, EntityNetwork, Alert, ServiceActivity, ProcessTreeNode, AgentLogEntry, BusinessGoal, ApprovalItem, ManagementStatus, ManagementConstraint, ManagementViolation, ManagementApproval } from './api'

function debounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

export const useOverviewStore = defineStore('overview', () => {
  const data = ref<DashboardOverview | null>(null)
  const loading = ref(false)
  const timeseries = ref<Record<string, TimeSeriesPoint[]>>({})

  async function fetch() {
    loading.value = true
    try { data.value = await api.getOverview() } finally { loading.value = false }
  }

  async function fetchTimeSeries(interval: string = 'day') {
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    const [created, completed, errors] = await Promise.all([
      api.getTimeSeries('dashboard.process.created', interval, from, to),
      api.getTimeSeries('process.completed', interval, from, to),
      api.getTimeSeries('process.error', interval, from, to),
    ])
    timeseries.value = { created, completed, errors }
  }

  function subscribe() {
    fetch()
    const debouncedFetch = debounce(fetch, 200)
    const unsubs = [
      sse.on('process:created', debouncedFetch),
      sse.on('process:state_changed', debouncedFetch),
      sse.on('process:completed', debouncedFetch),
      sse.on('process:error', debouncedFetch),
      sse.on('dossier:committed', debouncedFetch),
      sse.on('management:violation', debouncedFetch),
      sse.on('management:circuit_breaker_changed', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { data, loading, timeseries, fetch, fetchTimeSeries, subscribe }
})

export const useProcessStore = defineStore('process', () => {
  const kanban = ref<KanbanColumn[]>([])
  const list = ref<ProcessDef[]>([])
  const detail = ref<ProcessDetail | null>(null)
  const loading = ref(false)

  async function fetchKanban(filter?: { serviceId?: string; entityType?: string }) {
    loading.value = true
    try { kanban.value = await api.getKanban(filter) } finally { loading.value = false }
  }

  async function fetchList(filter?: Record<string, string | undefined>) {
    loading.value = true
    try { list.value = await api.getProcesses(filter) } finally { loading.value = false }
  }

  async function fetchDetail(id: string) {
    loading.value = true
    try { detail.value = await api.getProcess(id) } finally { loading.value = false }
  }

  async function transition(id: string, newState: string) {
    await api.transitionProcess(id, newState)
    await fetchDetail(id)
  }

  async function create(params: { serviceId: string; entityType?: string; entityId?: string; operatorId?: string }) {
    return api.createProcess(params)
  }

  function subscribeKanban(filter?: { serviceId?: string; entityType?: string }) {
    fetchKanban(filter)
    const debouncedFetch = debounce(() => fetchKanban(filter), 200)
    const unsubs = [
      sse.on('process:created', debouncedFetch),
      sse.on('process:state_changed', debouncedFetch),
      sse.on('process:completed', debouncedFetch),
      sse.on('process:error', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  function subscribeDetail(processId: string) {
    fetchDetail(processId)
    const debouncedFetch = debounce(() => fetchDetail(processId), 200)
    const unsubs = [
      sse.on('process:state_changed', debouncedFetch),
      sse.on('process:completed', debouncedFetch),
      sse.on('process:error', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { kanban, list, detail, loading, fetchKanban, fetchList, fetchDetail, transition, create, subscribeKanban, subscribeDetail }
})

export const useEntityStore = defineStore('entity', () => {
  const list = ref<DossierSearchResult[]>([])
  const detail = ref<EntityDetail | null>(null)
  const loading = ref(false)

  async function fetchList(filter?: Record<string, string | undefined>) {
    loading.value = true
    try { list.value = await api.getEntities(filter) } finally { loading.value = false }
  }

  async function fetchDetail(id: string) {
    loading.value = true
    try { detail.value = await api.getEntity(id) } finally { loading.value = false }
  }

  function subscribeList(filter?: Record<string, string | undefined>) {
    fetchList(filter)
    const debouncedFetch = debounce(() => fetchList(filter), 200)
    const unsubs = [
      sse.on('dossier:committed', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { list, detail, loading, fetchList, fetchDetail, subscribeList }
})

export const useServiceStore = defineStore('service', () => {
  const list = ref<ServiceDef[]>([])
  const loaded = ref(false)

  async function fetch() {
    if (loaded.value) return
    list.value = await api.getServices()
    loaded.value = true
  }

  return { list, loaded, fetch }
})

export const useAlertStore = defineStore('alert', () => {
  const alerts = ref<Alert[]>([])
  const loading = ref(false)

  async function fetch() {
    loading.value = true
    try { alerts.value = await api.getAlerts() } finally { loading.value = false }
  }

  function subscribe() {
    fetch()
    const debouncedFetch = debounce(fetch, 500)
    const unsubs = [
      sse.on('process:error', debouncedFetch),
      sse.on('process:state_changed', debouncedFetch),
      sse.on('dossier:committed', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { alerts, loading, fetch, subscribe }
})

// --- Phase 3 stores ---

export const useDagStore = defineStore('dag', () => {
  const rules = ref<RuleEdge[]>([])
  const activity = ref<ServiceActivity>({})
  const loading = ref(false)

  async function fetchRules(targetServiceId?: string) {
    loading.value = true
    try { rules.value = await api.getRules(targetServiceId) } finally { loading.value = false }
  }

  async function fetchActivity() {
    try { activity.value = await api.getServiceActivity() } catch { /* ignore */ }
  }

  function subscribe(targetServiceId?: string) {
    fetchRules(targetServiceId)
    fetchActivity()
    const debouncedFetchActivity = debounce(fetchActivity, 200)
    const unsubs = [
      sse.on('process:created', debouncedFetchActivity),
      sse.on('process:state_changed', debouncedFetchActivity),
      sse.on('process:completed', debouncedFetchActivity),
      sse.on('process:error', debouncedFetchActivity),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { rules, activity, loading, fetchRules, fetchActivity, subscribe }
})

export const useWorkloadStore = defineStore('workload', () => {
  const data = ref<OperatorWorkload | null>(null)
  const loading = ref(false)

  async function fetch() {
    loading.value = true
    try { data.value = await api.getOperatorWorkload() } finally { loading.value = false }
  }

  function subscribe() {
    fetch()
    const debouncedFetch = debounce(fetch, 200)
    const unsubs = [
      sse.on('process:created', debouncedFetch),
      sse.on('process:state_changed', debouncedFetch),
      sse.on('process:completed', debouncedFetch),
      sse.on('process:error', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { data, loading, fetch, subscribe }
})

export const useEntityNetworkStore = defineStore('entityNetwork', () => {
  const network = ref<EntityNetwork | null>(null)
  const loading = ref(false)

  async function fetch(entityType?: string) {
    loading.value = true
    try { network.value = await api.getEntityNetwork(entityType) } finally { loading.value = false }
  }

  function subscribe(entityType?: string) {
    fetch(entityType)
    const debouncedFetch = debounce(() => fetch(entityType), 200)
    const unsubs = [
      sse.on('dossier:committed', debouncedFetch),
      sse.on('process:created', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { network, loading, fetch, subscribe }
})

// --- Phase C stores ---

export const useAgentLogStore = defineStore('agentLog', () => {
  const entries = ref<AgentLogEntry[]>([])
  const loading = ref(false)

  async function fetch(filter?: { taskId?: string; action?: string; limit?: string; offset?: string }) {
    loading.value = true
    try { entries.value = await api.getAgentLog(filter) } finally { loading.value = false }
  }

  function subscribe(filter?: { taskId?: string; action?: string }) {
    fetch(filter)
    const debouncedFetch = debounce(() => fetch(filter), 200)
    const unsubs = [
      sse.on('process:created', debouncedFetch),
      sse.on('process:state_changed', debouncedFetch),
      sse.on('process:completed', debouncedFetch),
      sse.on('process:error', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { entries, loading, fetch, subscribe }
})

export const useBusinessGoalsStore = defineStore('businessGoals', () => {
  const goals = ref<BusinessGoal[]>([])
  const loading = ref(false)

  async function fetch() {
    loading.value = true
    try { goals.value = await api.getBusinessGoals() } finally { loading.value = false }
  }

  function subscribe() {
    fetch()
    const debouncedFetch = debounce(fetch, 200)
    const unsubs = [
      sse.on('dossier:committed', debouncedFetch),
      sse.on('process:completed', debouncedFetch),
      sse.on('process:error', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { goals, loading, fetch, subscribe }
})

export const useApprovalsStore = defineStore('approvals', () => {
  const items = ref<ApprovalItem[]>([])
  const loading = ref(false)

  async function fetch(status?: string) {
    loading.value = true
    try { items.value = await api.getApprovals(status) } finally { loading.value = false }
  }

  async function decide(approvalId: string, params: { decision: 'approved' | 'rejected'; decidedBy?: string; reason?: string }) {
    await api.decideApproval(approvalId, params)
    await fetch()
  }

  function subscribe(status?: string) {
    fetch(status)
    const debouncedFetch = debounce(() => fetch(status), 200)
    const unsubs = [
      sse.on('dossier:committed', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { items, loading, fetch, decide, subscribe }
})

// --- Management store ---

export const useManagementStore = defineStore('management', () => {
  const status = ref<ManagementStatus | null>(null)
  const constraints = ref<ManagementConstraint[]>([])
  const violations = ref<ManagementViolation[]>([])
  const approvals = ref<ManagementApproval[]>([])
  const loading = ref(false)

  async function fetch() {
    loading.value = true
    try {
      const [s, c, v, a] = await Promise.all([
        api.getManagementStatus(),
        api.getManagementConstraints(),
        api.getManagementViolations('100'),
        api.getManagementApprovals(),
      ])
      status.value = s
      constraints.value = c
      violations.value = v
      approvals.value = a
    } finally { loading.value = false }
  }

  async function decideApproval(id: string, decision: 'APPROVED' | 'REJECTED', decidedBy?: string) {
    const result = await api.decideManagementApproval(id, { decision, decidedBy })
    await fetch()
    return result
  }

  async function resetCircuitBreaker() {
    await api.resetCircuitBreaker()
    await fetch()
  }

  function subscribe() {
    fetch()
    const debouncedFetch = debounce(fetch, 300)
    const unsubs = [
      sse.on('management:violation', debouncedFetch),
      sse.on('management:approval_created', debouncedFetch),
      sse.on('management:approval_decided', debouncedFetch),
      sse.on('management:circuit_breaker_changed', debouncedFetch),
    ]
    return () => unsubs.forEach(u => u())
  }

  return { status, constraints, violations, approvals, loading, fetch, decideApproval, resetCircuitBreaker, subscribe }
})

// --- Trial Run store ---

function flattenTree(node: ProcessTreeNode, out: ProcessDef[] = []): ProcessDef[] {
  out.push(node.process)
  for (const child of node.children) flattenTree(child, out)
  return out
}

export const useTrialRunStore = defineStore('trialRun', () => {
  const active = ref(false)
  const rootProcessId = ref<string | null>(null)
  const rootServiceId = ref<string | null>(null)
  const tree = ref<ProcessTreeNode | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const startedAt = ref<string | null>(null)

  const allProcesses = computed(() => tree.value ? flattenTree(tree.value) : [])

  async function start(params: { serviceId: string; entityType?: string; entityId?: string }) {
    loading.value = true
    error.value = null
    try {
      const process = await api.createProcess({
        serviceId: params.serviceId,
        entityType: params.entityType,
        entityId: params.entityId,
      })
      rootProcessId.value = process.id
      rootServiceId.value = params.serviceId
      startedAt.value = new Date().toISOString()
      active.value = true
      await refreshTree()
    } catch (err: any) {
      error.value = err.message || 'Failed to start trial run'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function simulateComplete(processId: string) {
    loading.value = true
    error.value = null
    try {
      const result = await api.simulateComplete(processId)
      if (result.tree) tree.value = result.tree
      else await refreshTree()
    } catch (err: any) {
      error.value = err.message || 'Simulate failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function refreshTree() {
    if (!rootProcessId.value) return
    try {
      tree.value = await api.getProcessTree(rootProcessId.value)
    } catch { /* ignore */ }
  }

  function subscribe() {
    const debouncedRefresh = debounce(refreshTree, 200)
    const unsubs = [
      sse.on('process:created', debouncedRefresh),
      sse.on('process:state_changed', debouncedRefresh),
      sse.on('process:completed', debouncedRefresh),
      sse.on('process:error', debouncedRefresh),
    ]
    return () => unsubs.forEach(u => u())
  }

  function reset() {
    active.value = false
    rootProcessId.value = null
    rootServiceId.value = null
    tree.value = null
    loading.value = false
    error.value = null
    startedAt.value = null
  }

  return { active, rootProcessId, rootServiceId, tree, loading, error, startedAt, allProcesses, start, simulateComplete, refreshTree, subscribe, reset }
})

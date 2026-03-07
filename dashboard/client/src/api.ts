// --- Types (mirroring bps-engine, but not importing node-dependent code) ---

export interface DashboardOverview {
  entities: {
    totalCount: number
    byType: Record<string, number>
    byLifecycle: Record<string, number>
    recentChanges: RecentChange[]
  }
  processes: {
    totalCount: number
    byState: Record<string, number>
    activeCount: number
    errorCount: number
  }
  services: {
    totalCount: number
    byExecutorType: Record<string, number>
  }
}

export interface RecentChange {
  dossier: DossierDef
  data: Record<string, unknown>
  patch?: Record<string, unknown>
  committedBy?: string
  commitMessage?: string
  version: number
  versionCreatedAt: string
}

export interface DossierDef {
  id: string
  entityType: string
  entityId: string
  lifecycle: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface DossierVersion {
  id: string
  dossierId: string
  version: number
  data: Record<string, unknown>
  patch?: Record<string, unknown>
  committedBy?: string
  commitMessage?: string
  createdAt: string
}

export interface DossierSearchResult {
  dossier: DossierDef
  data: Record<string, unknown>
}

export interface ProcessDef {
  id: string
  pid: number
  name?: string
  parentId?: string
  previousId?: string
  serviceId: string
  state: string
  priority: number
  entityType?: string
  entityId?: string
  operatorId?: string
  operatorLabel?: string
  creatorId?: string
  programEntrypoint?: string
  startTime?: string
  endTime?: string
  createdAt: string
  updatedAt: string
}

export interface ProcessDetail {
  process: ProcessDef
  contextSnapshot: unknown | null
  tree: ProcessTreeNode | null
}

export interface ProcessTreeNode {
  process: ProcessDef
  children: ProcessTreeNode[]
}

export interface KanbanColumn {
  state: string
  processes: ProcessDef[]
  count: number
}

export interface ServiceDef {
  id: string
  label: string
  name?: string
  status: string
  serviceType: string
  executorType: string
  entityType?: string
  manualStart: boolean
  createdAt: string
  updatedAt: string
}

export interface EntityDetail {
  dossier: DossierDef
  data: Record<string, unknown>
  versions: DossierVersion[]
  relatedProcesses: ProcessDef[]
}

export interface TimeSeriesPoint {
  bucket: string
  count: number
  dimensions?: Record<string, unknown>
}

// --- Phase 3 types ---

export interface RuleEdge {
  id: string
  label: string
  targetServiceId: string
  order: number
  serviceId: string
  serviceLabel: string
  serviceType: string
  executorType: string
  eventId: string
  eventLabel: string
  eventExpression: string
  instructionId: string
  sysCall: string | null
  evaluationMode: string
  operandServiceId: string
  operandServiceLabel: string
  operandServiceType: string
  operandExecutorType: string
}

export interface OperatorSummary {
  operatorId: string
  label: string
  byState: Record<string, number>
  total: number
  active: number
}

export interface TimelineProcess {
  id: string
  pid: number
  serviceId: string
  state: string
  operatorId: string
  startTime: string | null
  endTime: string | null
  createdAt: string
  entityType: string | null
  entityId: string | null
}

export interface OperatorWorkload {
  operators: OperatorSummary[]
  timeline: TimelineProcess[]
}

export interface EntityNetworkNode {
  id: string
  entityType: string
  entityId: string
  lifecycle: string
}

export interface EntityNetworkEdge {
  source: string
  target: string
  relation: string
}

export interface EntityNetwork {
  nodes: EntityNetworkNode[]
  edges: EntityNetworkEdge[]
}

export interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  type: string
  message: string
}

export type ServiceActivity = Record<string, Record<string, number>>

export interface SimulateCompleteResult {
  process: ProcessDef
  tree: ProcessTreeNode | null
}

// --- Phase C types ---

export interface AgentLogEntry {
  id: string
  taskId: string
  taskName: string | null
  serviceId: string | null
  entityType: string | null
  entityId: string | null
  action: string
  fromState: string | null
  toState: string | null
  details: Record<string, unknown> | null
  reason: string | null
  timestamp: string
}

export interface BusinessGoalItem {
  name: string
  status: string
  dueDate: string | null
  priority: string | null
}

export interface PeriodicItem {
  name: string
  cron: string | null
  lastRun: string | null
  nextRun: string | null
}

export interface BusinessGoal {
  planId: string
  dossierId: string
  name: string
  description: string | null
  items: BusinessGoalItem[]
  periodicItems: PeriodicItem[]
  processStats: {
    total: number
    byState: Record<string, number>
    completionRate: number
  }
  updatedAt: string
}

export interface ApprovalItem {
  id: string
  approvalId: string
  status: string
  question: string
  context: unknown
  taskId: string | null
  serviceId: string | null
  requestedBy: string | null
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  decision: string | null
  updatedAt: string
}

// --- Governance types ---

export interface GovernanceStatus {
  circuitBreaker: {
    state: string
    lastStateChange: string
  }
  constraintCount: number
  pendingApprovalCount: number
  recentViolations: GovernanceViolation[]
}

export interface GovernanceViolation {
  id: string
  constraintId: string
  policyId: string
  severity: string
  tool: string
  entityType?: string | null
  entityId?: string | null
  verdict?: string
  condition?: string
  message: string
  circuitBreakerState?: string
  createdAt: string
}

export interface GovernanceConstraint {
  id: string
  policyId: string
  label: string
  scope: { tools: string[]; entityTypes?: string[]; dataFields?: string[] }
  condition: string
  onViolation: string
  severity: string
  approver: string | null
  message: string
}

export interface GovernanceApproval {
  id: string
  constraintId: string
  tool: string
  toolInput: Record<string, unknown>
  entityType: string | null
  entityId: string | null
  message: string
  status: string
  approvedBy: string | null
  decidedAt: string | null
  createdAt: string
  expiresAt: string
}

// --- Fetch helpers ---

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// --- API functions ---

export const api = {
  getOverview: () => get<DashboardOverview>('/api/overview'),
  getKanban: (filter?: { serviceId?: string; entityType?: string }) =>
    get<KanbanColumn[]>('/api/kanban', filter),
  getProcesses: (filter?: Record<string, string | undefined>) =>
    get<ProcessDef[]>('/api/processes', filter),
  getProcess: (id: string) => get<ProcessDetail>(`/api/processes/${id}`),
  getProcessTree: (id: string) => get<ProcessTreeNode>(`/api/processes/${id}/tree`),
  getEntities: (filter?: Record<string, string | undefined>) =>
    get<DossierSearchResult[]>('/api/entities', filter),
  getEntity: (id: string) => get<EntityDetail>(`/api/entities/${id}`),
  getServices: (filter?: Record<string, string | undefined>) =>
    get<ServiceDef[]>('/api/services', filter),
  getTimeSeries: (metric: string, interval: string, from: string, to: string) =>
    get<TimeSeriesPoint[]>('/api/stats/timeseries', { metric, interval, from, to }),
  createProcess: (params: { serviceId: string; entityType?: string; entityId?: string; operatorId?: string }) =>
    post<ProcessDef>('/api/processes', params),
  transitionProcess: (id: string, newState: string) =>
    post<ProcessDef>(`/api/processes/${id}/transition`, { newState }),
  createEntity: (entityType: string, entityId: string, data: Record<string, unknown>, opts?: { committedBy?: string; message?: string }) =>
    post<{ dossier: DossierDef; version: DossierVersion }>(`/api/entities/${entityType}/${entityId}`, { data, ...opts }),
  getAlerts: () => get<Alert[]>('/api/alerts'),
  // Phase 3
  getRules: (targetServiceId?: string) =>
    get<RuleEdge[]>('/api/rules', { targetServiceId }),
  getOperatorWorkload: () =>
    get<OperatorWorkload>('/api/operators/workload'),
  getEntityNetwork: (entityType?: string) =>
    get<EntityNetwork>('/api/entity-network', { entityType }),
  getServiceActivity: () =>
    get<ServiceActivity>('/api/services/activity'),
  simulateComplete: (id: string) =>
    post<SimulateCompleteResult>(`/api/processes/${id}/simulate-complete`, {}),
  // Phase C
  getAgentLog: (filter?: { taskId?: string; action?: string; limit?: string; offset?: string }) =>
    get<AgentLogEntry[]>('/api/agent-log', filter),
  getBusinessGoals: () =>
    get<BusinessGoal[]>('/api/business-goals'),
  getApprovals: (status?: string) =>
    get<ApprovalItem[]>('/api/approvals', { status }),
  decideApproval: (approvalId: string, params: { decision: 'approved' | 'rejected'; decidedBy?: string; reason?: string }) =>
    post<{ success: boolean; approvalId: string; decision: string }>(`/api/approvals/${approvalId}/decide`, params),
  // Governance
  getGovernanceStatus: () =>
    get<GovernanceStatus>('/api/governance/status'),
  getGovernanceViolations: (limit?: string) =>
    get<GovernanceViolation[]>('/api/governance/violations', { limit }),
  getGovernanceConstraints: () =>
    get<GovernanceConstraint[]>('/api/governance/constraints'),
  getGovernanceApprovals: () =>
    get<GovernanceApproval[]>('/api/governance/approvals'),
  decideGovernanceApproval: (id: string, params: { decision: 'APPROVED' | 'REJECTED'; decidedBy?: string }) =>
    post<{ success: boolean; id: string; decision: string; executionResult?: Record<string, unknown> | null }>(`/api/governance/approvals/${id}/decide`, params),
  resetCircuitBreaker: () =>
    post<{ success: boolean; state: string }>('/api/governance/circuit-breaker/reset', {}),
}

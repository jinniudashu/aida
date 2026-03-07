/** Governance layer type definitions */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ViolationAction = 'BLOCK' | 'REQUIRE_APPROVAL';
export type Verdict = 'PASS' | 'BLOCK' | 'REQUIRE_APPROVAL';
export type CircuitBreakerState = 'NORMAL' | 'WARNING' | 'RESTRICTED' | 'DISCONNECTED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'TIMEOUT';

export interface ConstraintScope {
  tools: string[];
  entityTypes?: string[];
  dataFields?: string[];
}

export interface ConstraintDef {
  id: string;
  policyId: string;
  label: string;
  scope: ConstraintScope;
  condition: string;
  onViolation: ViolationAction;
  severity: Severity;
  approver?: string;
  message: string;
}

export interface PolicyDef {
  id: string;
  label: string;
  constraints: Omit<ConstraintDef, 'policyId'>[];
}

export interface CircuitBreakerThreshold {
  severity: Severity;
  maxViolations: number;
  window: string;
  action: CircuitBreakerState;
}

export interface CircuitBreakerConfig {
  thresholds: CircuitBreakerThreshold[];
  cooldown?: string;
  notify?: string[];
}

export interface GovernanceConfig {
  version: string;
  policies: PolicyDef[];
  circuitBreaker?: CircuitBreakerConfig;
}

export interface ConstraintCheck {
  constraintId: string;
  policyId: string;
  passed: boolean;
  severity: Severity;
  message?: string;
}

export interface ActionGateResult {
  verdict: Verdict;
  checks: ConstraintCheck[];
  circuitBreakerState: CircuitBreakerState;
}

export interface ViolationRecord {
  id: string;
  constraintId: string;
  policyId: string;
  severity: Severity;
  tool: string;
  entityType?: string;
  entityId?: string;
  verdict: string;
  condition: string;
  evalContext: Record<string, unknown>;
  message: string;
  circuitBreakerState: CircuitBreakerState;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  constraintId: string;
  tool: string;
  toolInput: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  message: string;
  status: ApprovalStatus;
  approvedBy?: string;
  decidedAt?: string;
  createdAt: string;
  expiresAt: string;
}

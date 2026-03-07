import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { now } from '../schema/common.js';
import type {
  ConstraintDef,
  CircuitBreakerState,
  Severity,
  ViolationRecord,
  ApprovalRequest,
  ApprovalStatus,
} from './types.js';

const GOVERNANCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS bps_governance_constraints (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  label TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  condition TEXT NOT NULL,
  on_violation TEXT NOT NULL,
  severity TEXT NOT NULL,
  approver TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_governance_violations (
  id TEXT PRIMARY KEY,
  constraint_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  tool TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  verdict TEXT NOT NULL,
  condition TEXT NOT NULL,
  eval_context TEXT NOT NULL,
  message TEXT NOT NULL,
  circuit_breaker_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_governance_circuit_breaker (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  state TEXT NOT NULL DEFAULT 'NORMAL',
  last_state_change TEXT NOT NULL,
  violation_count_critical INTEGER NOT NULL DEFAULT 0,
  violation_count_high INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_governance_approvals (
  id TEXT PRIMARY KEY,
  constraint_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  tool_input TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gov_violations_time
  ON bps_governance_violations(created_at);
CREATE INDEX IF NOT EXISTS idx_gov_violations_severity
  ON bps_governance_violations(severity, created_at);
CREATE INDEX IF NOT EXISTS idx_gov_approvals_status
  ON bps_governance_approvals(status);
`;

export class GovernanceStore extends EventEmitter {
  private insertConstraintStmt: StatementSync;
  private listConstraintsStmt: StatementSync;
  private clearConstraintsStmt: StatementSync;
  private insertViolationStmt: StatementSync;
  private recentViolationsStmt: StatementSync;
  private countViolationsBySeverityStmt: StatementSync;
  private getCbStmt: StatementSync;
  private upsertCbStmt: StatementSync;
  private insertApprovalStmt: StatementSync;
  private getApprovalStmt: StatementSync;
  private pendingApprovalsStmt: StatementSync;
  private updateApprovalStmt: StatementSync;

  constructor(private db: DatabaseSync) {
    super();
    db.exec(GOVERNANCE_SCHEMA);

    this.insertConstraintStmt = db.prepare(`
      INSERT OR REPLACE INTO bps_governance_constraints
        (id, policy_id, label, scope_json, condition, on_violation, severity, approver, message, created_at, updated_at)
      VALUES (@id, @policyId, @label, @scopeJson, @condition, @onViolation, @severity, @approver, @message, @createdAt, @updatedAt)
    `);

    this.listConstraintsStmt = db.prepare(
      `SELECT * FROM bps_governance_constraints ORDER BY policy_id, id`
    );

    this.clearConstraintsStmt = db.prepare(
      `DELETE FROM bps_governance_constraints`
    );

    this.insertViolationStmt = db.prepare(`
      INSERT INTO bps_governance_violations
        (id, constraint_id, policy_id, severity, tool, entity_type, entity_id,
         verdict, condition, eval_context, message, circuit_breaker_state, created_at)
      VALUES (@id, @constraintId, @policyId, @severity, @tool, @entityType, @entityId,
              @verdict, @condition, @evalContext, @message, @circuitBreakerState, @createdAt)
    `);

    this.recentViolationsStmt = db.prepare(
      `SELECT * FROM bps_governance_violations ORDER BY created_at DESC LIMIT ?`
    );

    this.countViolationsBySeverityStmt = db.prepare(
      `SELECT COUNT(*) as count FROM bps_governance_violations
       WHERE severity = ? AND created_at >= ?`
    );

    this.getCbStmt = db.prepare(
      `SELECT * FROM bps_governance_circuit_breaker WHERE id = 'singleton'`
    );

    this.upsertCbStmt = db.prepare(`
      INSERT OR REPLACE INTO bps_governance_circuit_breaker
        (id, state, last_state_change, violation_count_critical, violation_count_high, window_start, updated_at)
      VALUES ('singleton', @state, @lastStateChange, @violationCountCritical, @violationCountHigh, @windowStart, @updatedAt)
    `);

    this.insertApprovalStmt = db.prepare(`
      INSERT INTO bps_governance_approvals
        (id, constraint_id, tool, tool_input, entity_type, entity_id, message, status, created_at, expires_at)
      VALUES (@id, @constraintId, @tool, @toolInput, @entityType, @entityId, @message, @status, @createdAt, @expiresAt)
    `);

    this.getApprovalStmt = db.prepare(
      `SELECT * FROM bps_governance_approvals WHERE id = ?`
    );

    this.pendingApprovalsStmt = db.prepare(
      `SELECT * FROM bps_governance_approvals WHERE status = 'PENDING' ORDER BY created_at ASC`
    );

    this.updateApprovalStmt = db.prepare(`
      UPDATE bps_governance_approvals
      SET status = @status, approved_by = @approvedBy, decided_at = @decidedAt
      WHERE id = @id
    `);
  }

  // ——— Constraints ———

  loadConstraints(constraints: ConstraintDef[]): number {
    const timestamp = now();
    this.clearConstraintsStmt.run();
    for (const c of constraints) {
      this.insertConstraintStmt.run({
        id: c.id,
        policyId: c.policyId,
        label: c.label,
        scopeJson: JSON.stringify(c.scope),
        condition: c.condition,
        onViolation: c.onViolation,
        severity: c.severity,
        approver: c.approver ?? null,
        message: c.message,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    return constraints.length;
  }

  listConstraints(): ConstraintDef[] {
    const rows = this.listConstraintsStmt.all() as Record<string, unknown>[];
    return rows.map(r => this.rowToConstraint(r));
  }

  // ——— Violations ———

  recordViolation(v: Omit<ViolationRecord, 'id' | 'createdAt'>): ViolationRecord {
    const id = uuid();
    const createdAt = now();
    this.insertViolationStmt.run({
      id,
      constraintId: v.constraintId,
      policyId: v.policyId,
      severity: v.severity,
      tool: v.tool,
      entityType: v.entityType ?? null,
      entityId: v.entityId ?? null,
      verdict: v.verdict,
      condition: v.condition,
      evalContext: JSON.stringify(v.evalContext),
      message: v.message,
      circuitBreakerState: v.circuitBreakerState,
      createdAt,
    });
    const record: ViolationRecord = { ...v, id, createdAt };
    this.emit('governance:violation', record);
    return record;
  }

  getRecentViolations(limit = 20): ViolationRecord[] {
    const rows = this.recentViolationsStmt.all(limit) as Record<string, unknown>[];
    return rows.map(r => this.rowToViolation(r));
  }

  countViolationsSince(severity: Severity, since: string): number {
    const row = this.countViolationsBySeverityStmt.get(severity, since) as Record<string, unknown>;
    return row.count as number;
  }

  // ——— Circuit Breaker ———

  getCircuitBreakerState(): { state: CircuitBreakerState; lastStateChange: string } {
    const row = this.getCbStmt.get() as Record<string, unknown> | undefined;
    if (!row) {
      return { state: 'NORMAL', lastStateChange: now() };
    }
    return {
      state: row.state as CircuitBreakerState,
      lastStateChange: row.last_state_change as string,
    };
  }

  updateCircuitBreaker(state: CircuitBreakerState, counts: {
    critical: number;
    high: number;
    windowStart: string;
  }): void {
    const timestamp = now();
    this.upsertCbStmt.run({
      state,
      lastStateChange: timestamp,
      violationCountCritical: counts.critical,
      violationCountHigh: counts.high,
      windowStart: counts.windowStart,
      updatedAt: timestamp,
    });
    this.emit('governance:circuit_breaker_changed', { state, lastStateChange: timestamp });
  }

  resetCircuitBreaker(): void {
    this.updateCircuitBreaker('NORMAL', {
      critical: 0,
      high: 0,
      windowStart: now(),
    });
  }

  // ——— Approvals ———

  createApproval(req: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt'>): ApprovalRequest {
    const id = uuid();
    const createdAt = now();
    this.insertApprovalStmt.run({
      id,
      constraintId: req.constraintId,
      tool: req.tool,
      toolInput: JSON.stringify(req.toolInput),
      entityType: req.entityType ?? null,
      entityId: req.entityId ?? null,
      message: req.message,
      status: 'PENDING',
      createdAt,
      expiresAt: req.expiresAt,
    });
    const approval: ApprovalRequest = { ...req, id, status: 'PENDING', createdAt };
    this.emit('governance:approval_created', approval);
    return approval;
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = this.getApprovalStmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToApproval(row) : null;
  }

  getPendingApprovals(): ApprovalRequest[] {
    const rows = this.pendingApprovalsStmt.all() as Record<string, unknown>[];
    return rows.map(r => this.rowToApproval(r));
  }

  decideApproval(id: string, status: 'APPROVED' | 'REJECTED', approvedBy?: string): void {
    const decidedAt = now();
    this.updateApprovalStmt.run({
      id,
      status,
      approvedBy: approvedBy ?? null,
      decidedAt,
    });
    this.emit('governance:approval_decided', { id, status, approvedBy: approvedBy ?? null, decidedAt });
  }

  // ——— Row mappers ———

  private rowToConstraint(row: Record<string, unknown>): ConstraintDef {
    return {
      id: row.id as string,
      policyId: row.policy_id as string,
      label: row.label as string,
      scope: JSON.parse(row.scope_json as string),
      condition: row.condition as string,
      onViolation: row.on_violation as ConstraintDef['onViolation'],
      severity: row.severity as Severity,
      approver: row.approver as string | undefined,
      message: row.message as string,
    };
  }

  private rowToViolation(row: Record<string, unknown>): ViolationRecord {
    return {
      id: row.id as string,
      constraintId: row.constraint_id as string,
      policyId: row.policy_id as string,
      severity: row.severity as Severity,
      tool: row.tool as string,
      entityType: row.entity_type as string | undefined,
      entityId: row.entity_id as string | undefined,
      verdict: row.verdict as string,
      condition: row.condition as string,
      evalContext: JSON.parse(row.eval_context as string),
      message: row.message as string,
      circuitBreakerState: row.circuit_breaker_state as CircuitBreakerState,
      createdAt: row.created_at as string,
    };
  }

  private rowToApproval(row: Record<string, unknown>): ApprovalRequest {
    return {
      id: row.id as string,
      constraintId: row.constraint_id as string,
      tool: row.tool as string,
      toolInput: JSON.parse(row.tool_input as string),
      entityType: row.entity_type as string | undefined,
      entityId: row.entity_id as string | undefined,
      message: row.message as string,
      status: row.status as ApprovalStatus,
      approvedBy: row.approved_by as string | undefined,
      decidedAt: row.decided_at as string | undefined,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string,
    };
  }
}

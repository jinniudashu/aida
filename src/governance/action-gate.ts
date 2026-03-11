import { Parser } from 'expr-eval';
import type { GovernanceStore } from './governance-store.js';
import type {
  ConstraintDef,
  ConstraintCheck,
  ActionGateResult,
  CircuitBreakerState,
  CircuitBreakerConfig,
  Verdict,
} from './types.js';
import { GATED_WRITE_TOOLS } from './constants.js';

/** Tools that are subject to governance checks (write operations) */
const GATED_TOOLS = new Set<string>(GATED_WRITE_TOOLS);

/** Default circuit breaker config if not specified */
const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  thresholds: [
    { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
    { severity: 'HIGH', maxViolations: 5, window: '1h', action: 'RESTRICTED' },
    { severity: 'HIGH', maxViolations: 2, window: '1h', action: 'WARNING' },
  ],
  cooldown: '30m',
};

export class ActionGate {
  private parser = new Parser();
  private cbConfig: CircuitBreakerConfig;

  constructor(
    private store: GovernanceStore,
    cbConfig?: CircuitBreakerConfig,
  ) {
    this.cbConfig = cbConfig ?? DEFAULT_CB_CONFIG;
  }

  /** Check whether a tool call is allowed */
  check(toolName: string, input: Record<string, unknown>): ActionGateResult {
    // Read-only tools always pass
    if (!GATED_TOOLS.has(toolName)) {
      return {
        verdict: 'PASS',
        checks: [],
        circuitBreakerState: this.store.getCircuitBreakerState().state,
      };
    }

    // Try cooldown auto-recovery before evaluating constraints
    this.tryCooldownRecovery();

    const cbState = this.store.getCircuitBreakerState().state;

    // DISCONNECTED or RESTRICTED: block all write operations immediately
    if (cbState === 'DISCONNECTED' || cbState === 'RESTRICTED') {
      return {
        verdict: 'BLOCK',
        checks: [{
          constraintId: '_circuit_breaker',
          policyId: '_system',
          passed: false,
          severity: 'CRITICAL',
          message: cbState === 'DISCONNECTED'
            ? 'Agent has been disconnected by circuit breaker. Only human intervention can restore access.'
            : 'Agent is in RESTRICTED mode. All write operations are blocked.',
        }],
        circuitBreakerState: cbState,
      };
    }

    // Find applicable constraints
    const constraints = this.store.listConstraints();
    const applicable = this.findApplicable(constraints, toolName, input);

    if (applicable.length === 0) {
      return { verdict: 'PASS', checks: [], circuitBreakerState: cbState };
    }

    // Build evaluation context
    const evalCtx = this.buildEvalContext(toolName, input);

    // Evaluate each constraint
    const checks: ConstraintCheck[] = [];
    for (const constraint of applicable) {
      const check = this.evaluateConstraint(constraint, evalCtx);
      checks.push(check);
    }

    // Record violations
    const failedChecks = checks.filter(c => !c.passed);
    for (const check of failedChecks) {
      const constraint = applicable.find(c => c.id === check.constraintId)!;
      this.store.recordViolation({
        constraintId: check.constraintId,
        policyId: check.policyId,
        severity: check.severity,
        tool: toolName,
        entityType: input.entityType as string | undefined,
        entityId: input.entityId as string | undefined,
        verdict: constraint.onViolation,
        condition: constraint.condition,
        evalContext: evalCtx,
        message: check.message ?? '',
        circuitBreakerState: cbState,
      });
    }

    // Update circuit breaker after recording violations
    const newCbState = failedChecks.length > 0
      ? this.updateCircuitBreaker()
      : cbState;

    // Determine verdict
    const verdict = this.determineVerdict(checks, applicable, newCbState);

    return { verdict, checks, circuitBreakerState: newCbState };
  }

  /** Create an approval request for REQUIRE_APPROVAL verdicts */
  createApprovalRequest(
    toolName: string,
    input: Record<string, unknown>,
    result: ActionGateResult,
  ): string {
    const failedCheck = result.checks.find(c => !c.passed);
    if (!failedCheck) throw new Error('No failed checks to create approval for');

    const approval = this.store.createApproval({
      constraintId: failedCheck.constraintId,
      tool: toolName,
      toolInput: input,
      entityType: input.entityType as string | undefined,
      entityId: input.entityId as string | undefined,
      message: failedCheck.message ?? 'Approval required',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4h default
    });

    return approval.id;
  }

  // ——— Private ———

  private findApplicable(
    constraints: ConstraintDef[],
    toolName: string,
    input: Record<string, unknown>,
  ): ConstraintDef[] {
    return constraints.filter(c => {
      // 1. Tool must match
      if (!c.scope.tools.includes(toolName)) return false;

      // 2. entityType must match (if specified)
      if (c.scope.entityTypes && c.scope.entityTypes.length > 0) {
        const entityType = input.entityType as string | undefined;
        if (!entityType || !c.scope.entityTypes.includes(entityType)) return false;
      }

      // 3. dataFields must have overlap with patch (if specified)
      if (c.scope.dataFields && c.scope.dataFields.length > 0) {
        const data = input.data as Record<string, unknown> | undefined;
        if (!data) return false;
        const patchKeys = Object.keys(data);
        const hasOverlap = c.scope.dataFields.some(f => patchKeys.includes(f));
        if (!hasOverlap) return false;
      }

      return true;
    });
  }

  private buildEvalContext(
    toolName: string,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const now = new Date();
    const ctx: Record<string, unknown> = {
      tool: toolName,
      entityType: input.entityType ?? '',
      entityId: input.entityId ?? '',
      hour: now.getHours(),
      weekday: now.getDay(),
      minute: now.getMinutes(),
      date: now.toISOString().split('T')[0],
      lifecycle: 'ACTIVE',
      currentVersion: 0,
    };

    // Flatten data fields (the patch being written)
    const data = input.data as Record<string, unknown> | undefined;
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        // Only flatten primitives to avoid expr-eval issues
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          ctx[key] = value;
        }
      }
      ctx._patch = data;
    }

    // Flatten other input fields
    if (input.name !== undefined) ctx.name = input.name;
    if (input.state !== undefined) ctx.state = input.state;

    // Tool-specific context enrichment for non-entity tools
    if (toolName === 'bps_load_blueprint') {
      ctx.persist = input.persist !== false;
      ctx.hasYaml = typeof input.yaml === 'string';
    }
    if (toolName === 'bps_register_agent') {
      if (input.id !== undefined) ctx.agentId = input.id;
      if (input.toolsProfile !== undefined) ctx.toolsProfile = input.toolsProfile;
    }
    if (toolName === 'bps_load_governance') {
      ctx.inlineYaml = typeof input.yaml === 'string';
    }

    return ctx;
  }

  private evaluateConstraint(constraint: ConstraintDef, ctx: Record<string, unknown>): ConstraintCheck {
    try {
      const expr = this.parser.parse(constraint.condition);
      // Build a safe context with only primitive values for expr-eval
      const safeCtx: Record<string, number | string | boolean> = {};
      for (const [key, value] of Object.entries(ctx)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          safeCtx[key] = value;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = expr.evaluate(safeCtx as any);
      const passed = Boolean(result);

      return {
        constraintId: constraint.id,
        policyId: constraint.policyId,
        passed,
        severity: constraint.severity,
        message: passed ? undefined : this.interpolateMessage(constraint.message, ctx),
      };
    } catch (err) {
      // If expression fails to evaluate, treat as BLOCK (fail-closed)
      return {
        constraintId: constraint.id,
        policyId: constraint.policyId,
        passed: false,
        severity: constraint.severity,
        message: `Constraint evaluation error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private interpolateMessage(template: string, ctx: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (_match, key) => {
      const value = ctx[key];
      return value !== undefined ? String(value) : `{${key}}`;
    });
  }

  private determineVerdict(
    checks: ConstraintCheck[],
    constraints: ConstraintDef[],
    cbState: CircuitBreakerState,
  ): Verdict {
    // Circuit breaker overrides
    if (cbState === 'DISCONNECTED' || cbState === 'RESTRICTED') {
      return 'BLOCK';
    }

    const failedChecks = checks.filter(c => !c.passed);
    if (failedChecks.length === 0) return 'PASS';

    // If any failed constraint is BLOCK, overall verdict is BLOCK
    for (const check of failedChecks) {
      const constraint = constraints.find(c => c.id === check.constraintId);
      if (constraint?.onViolation === 'BLOCK') return 'BLOCK';
    }

    // Otherwise REQUIRE_APPROVAL
    return 'REQUIRE_APPROVAL';
  }

  /** Downgrade order for cooldown recovery */
  private static readonly CB_DOWNGRADE: Record<string, CircuitBreakerState> = {
    DISCONNECTED: 'RESTRICTED',
    RESTRICTED: 'WARNING',
    WARNING: 'NORMAL',
  };

  /** Track recent state transitions for oscillation detection */
  private stateTransitionCount = 0;
  private stateTransitionWindowStart = Date.now();

  /**
   * If cooldown is configured and enough time has passed since the last state change
   * with no new violations in the window, auto-downgrade the circuit breaker one level.
   */
  private tryCooldownRecovery(): void {
    const cooldownStr = this.cbConfig.cooldown;
    if (!cooldownStr) return;

    const { state, lastStateChange } = this.store.getCircuitBreakerState();
    if (state === 'NORMAL') return;

    const cooldownMs = parseWindowDuration(cooldownStr);
    const elapsed = Date.now() - new Date(lastStateChange).getTime();
    if (elapsed < cooldownMs) return;

    // Check for new violations in the window since the last state change
    const criticalCount = this.store.countViolationsSince('CRITICAL', lastStateChange);
    const highCount = this.store.countViolationsSince('HIGH', lastStateChange);
    if (criticalCount > 0 || highCount > 0) return;

    // Oscillation detection: if >3 transitions in 1h, lock state
    const now = Date.now();
    if (now - this.stateTransitionWindowStart > 60 * 60 * 1000) {
      this.stateTransitionCount = 0;
      this.stateTransitionWindowStart = now;
    }
    this.stateTransitionCount++;
    if (this.stateTransitionCount > 3) {
      this.store.emit('governance:oscillation_detected', { state, transitionCount: this.stateTransitionCount });
      return; // Lock — don't downgrade
    }

    const newState = ActionGate.CB_DOWNGRADE[state] ?? 'NORMAL';
    this.store.updateCircuitBreaker(newState, {
      critical: 0,
      high: 0,
      windowStart: new Date().toISOString(),
    });
    this.store.emit('governance:cooldown_recovery', { from: state, to: newState });
  }

  private updateCircuitBreaker(): CircuitBreakerState {
    const windowMs = parseWindowDuration(
      this.cbConfig.thresholds[0]?.window ?? '1h'
    );
    const windowStart = new Date(Date.now() - windowMs).toISOString();

    const criticalCount = this.store.countViolationsSince('CRITICAL', windowStart);
    const highCount = this.store.countViolationsSince('HIGH', windowStart);

    // Check thresholds in order of severity (most severe first)
    const sorted = [...this.cbConfig.thresholds].sort((a, b) => {
      const order: Record<string, number> = { DISCONNECTED: 0, RESTRICTED: 1, WARNING: 2 };
      return (order[a.action] ?? 3) - (order[b.action] ?? 3);
    });

    let newState: CircuitBreakerState = 'NORMAL';

    for (const threshold of sorted) {
      const count = threshold.severity === 'CRITICAL' ? criticalCount : highCount;
      if (count >= threshold.maxViolations) {
        newState = threshold.action;
        break;
      }
    }

    this.store.updateCircuitBreaker(newState, {
      critical: criticalCount,
      high: highCount,
      windowStart,
    });

    return newState;
  }
}

/** Parse duration strings like "1h", "30m", "2h" into milliseconds */
function parseWindowDuration(duration: string): number {
  const match = duration.match(/^(\d+)(h|m|s)$/);
  if (!match) return 60 * 60 * 1000; // default 1h
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return 60 * 60 * 1000;
  }
}

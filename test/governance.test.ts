import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryDatabase } from '../src/store/db.js';
import { GovernanceStore } from '../src/governance/governance-store.js';
import { ActionGate } from '../src/governance/action-gate.js';
import { loadGovernanceFromString } from '../src/governance/governance-loader.js';
import type { ConstraintDef, CircuitBreakerConfig } from '../src/governance/types.js';

// ——— GovernanceStore ———

describe('GovernanceStore', () => {
  let store: GovernanceStore;

  beforeEach(() => {
    const db = createMemoryDatabase();
    store = new GovernanceStore(db);
  });

  it('should load and list constraints', () => {
    const constraints: ConstraintDef[] = [
      {
        id: 'budget-cap',
        policyId: 'financial',
        label: 'Budget cap',
        scope: { tools: ['bps_update_entity'], entityTypes: ['expense'] },
        condition: 'amount <= 10000',
        onViolation: 'BLOCK',
        severity: 'CRITICAL',
        message: 'Amount {amount} exceeds budget cap',
      },
      {
        id: 'approval-needed',
        policyId: 'financial',
        label: 'Large expense approval',
        scope: { tools: ['bps_update_entity'], entityTypes: ['expense'] },
        condition: 'amount <= 5000',
        onViolation: 'REQUIRE_APPROVAL',
        severity: 'HIGH',
        approver: 'owner',
        message: 'Amount {amount} requires approval',
      },
    ];
    const count = store.loadConstraints(constraints);
    expect(count).toBe(2);

    const loaded = store.listConstraints();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe('approval-needed');
    expect(loaded[1].id).toBe('budget-cap');
    expect(loaded[0].scope.tools).toEqual(['bps_update_entity']);
  });

  it('should clear and reload constraints', () => {
    store.loadConstraints([{
      id: 'c1', policyId: 'p1', label: 'C1',
      scope: { tools: ['bps_update_entity'] },
      condition: 'true', onViolation: 'BLOCK', severity: 'LOW', message: 'msg',
    }]);
    expect(store.listConstraints()).toHaveLength(1);

    store.loadConstraints([{
      id: 'c2', policyId: 'p2', label: 'C2',
      scope: { tools: ['bps_create_task'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'msg2',
    }]);
    const loaded = store.listConstraints();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('c2');
  });

  it('should record and query violations', () => {
    const v = store.recordViolation({
      constraintId: 'budget-cap',
      policyId: 'financial',
      severity: 'CRITICAL',
      tool: 'bps_update_entity',
      entityType: 'expense',
      entityId: 'exp-001',
      verdict: 'BLOCK',
      condition: 'amount <= 10000',
      evalContext: { amount: 50000 },
      message: 'Amount 50000 exceeds budget cap',
      circuitBreakerState: 'NORMAL',
    });
    expect(v.id).toBeTruthy();

    const violations = store.getRecentViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0].constraintId).toBe('budget-cap');
    expect(violations[0].evalContext).toEqual({ amount: 50000 });
  });

  it('should count violations by severity since a timestamp', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    store.recordViolation({
      constraintId: 'c1', policyId: 'p1', severity: 'CRITICAL',
      tool: 't', verdict: 'BLOCK', condition: 'false',
      evalContext: {}, message: 'm', circuitBreakerState: 'NORMAL',
    });
    store.recordViolation({
      constraintId: 'c2', policyId: 'p1', severity: 'HIGH',
      tool: 't', verdict: 'BLOCK', condition: 'false',
      evalContext: {}, message: 'm', circuitBreakerState: 'NORMAL',
    });

    expect(store.countViolationsSince('CRITICAL', past)).toBe(1);
    expect(store.countViolationsSince('HIGH', past)).toBe(1);
    expect(store.countViolationsSince('LOW', past)).toBe(0);
  });

  it('should manage circuit breaker state', () => {
    let state = store.getCircuitBreakerState();
    expect(state.state).toBe('NORMAL');

    store.updateCircuitBreaker('WARNING', {
      critical: 0, high: 3,
      windowStart: new Date().toISOString(),
    });
    state = store.getCircuitBreakerState();
    expect(state.state).toBe('WARNING');

    store.resetCircuitBreaker();
    state = store.getCircuitBreakerState();
    expect(state.state).toBe('NORMAL');
  });

  it('should manage approvals', () => {
    const approval = store.createApproval({
      constraintId: 'approval-needed',
      tool: 'bps_update_entity',
      toolInput: { entityType: 'expense', amount: 7000 },
      entityType: 'expense',
      entityId: 'exp-001',
      message: 'Amount 7000 requires approval',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    expect(approval.status).toBe('PENDING');

    const pending = store.getPendingApprovals();
    expect(pending).toHaveLength(1);

    store.decideApproval(approval.id, 'APPROVED', 'admin');
    const decided = store.getApproval(approval.id);
    expect(decided?.status).toBe('APPROVED');
    expect(decided?.approvedBy).toBe('admin');

    expect(store.getPendingApprovals()).toHaveLength(0);
  });
});

// ——— Governance Loader ———

describe('GovernanceLoader', () => {
  it('should parse valid governance YAML', () => {
    const yaml = `
version: "1"
policies:
  - id: financial
    label: Financial Controls
    constraints:
      - id: budget-cap
        label: Budget cap
        scope:
          tools: [bps_update_entity]
          entityTypes: [expense]
        condition: "amount <= 10000"
        on_violation: BLOCK
        severity: CRITICAL
        message: "Amount {amount} exceeds cap"
circuit_breaker:
  thresholds:
    - severity: CRITICAL
      max_violations: 1
      window: "1h"
      action: DISCONNECT
  cooldown: "30m"
`;
    const result = loadGovernanceFromString(yaml);
    expect(result.errors).toHaveLength(0);
    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0].id).toBe('budget-cap');
    expect(result.constraints[0].policyId).toBe('financial');
    expect(result.constraints[0].condition).toBe('amount <= 10000');
    expect(result.constraints[0].onViolation).toBe('BLOCK');
    expect(result.constraints[0].severity).toBe('CRITICAL');
    expect(result.circuitBreaker).toBeDefined();
    expect(result.circuitBreaker!.thresholds).toHaveLength(1);
    expect(result.circuitBreaker!.cooldown).toBe('30m');
  });

  it('should report errors for invalid YAML', () => {
    const result = loadGovernanceFromString('not valid yaml: [');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should report errors for missing fields', () => {
    const yaml = `
version: "1"
policies:
  - id: test
    label: Test
    constraints:
      - id: bad
        label: Missing condition
        scope:
          tools: []
        on_violation: BLOCK
        severity: HIGH
        message: "msg"
`;
    const result = loadGovernanceFromString(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject duplicate constraint IDs', () => {
    const yaml = `
version: "1"
policies:
  - id: p1
    label: Policy 1
    constraints:
      - id: dup
        label: First
        scope:
          tools: [bps_update_entity]
        condition: "true"
        on_violation: BLOCK
        severity: HIGH
        message: "m1"
  - id: p2
    label: Policy 2
    constraints:
      - id: dup
        label: Duplicate
        scope:
          tools: [bps_update_entity]
        condition: "false"
        on_violation: BLOCK
        severity: HIGH
        message: "m2"
`;
    const result = loadGovernanceFromString(yaml);
    expect(result.errors).toContain('Duplicate constraint ID: dup');
    expect(result.constraints).toHaveLength(1);
  });

  it('should handle multiple policies with multiple constraints', () => {
    const yaml = `
version: "1"
policies:
  - id: financial
    label: Financial
    constraints:
      - id: c1
        label: C1
        scope:
          tools: [bps_update_entity]
        condition: "amount <= 10000"
        on_violation: BLOCK
        severity: CRITICAL
        message: "m1"
      - id: c2
        label: C2
        scope:
          tools: [bps_update_entity]
        condition: "amount <= 5000"
        on_violation: REQUIRE_APPROVAL
        severity: HIGH
        message: "m2"
  - id: operations
    label: Operations
    constraints:
      - id: c3
        label: C3
        scope:
          tools: [bps_create_skill]
        condition: "false"
        on_violation: REQUIRE_APPROVAL
        severity: MEDIUM
        message: "m3"
`;
    const result = loadGovernanceFromString(yaml);
    expect(result.errors).toHaveLength(0);
    expect(result.constraints).toHaveLength(3);
  });

  it('should accept flat constraints[] format (Aida-written)', () => {
    const yaml = `
constraints:
  - id: no-double-discount
    label: "折扣不叠加"
    scope:
      tools: [bps_update_entity]
      entityTypes: [billing]
    condition: "discountType != 'stacked'"
    onViolation: BLOCK
    severity: HIGH
    message: "Stacked discounts not allowed"
  - id: consent-required
    label: "知情同意必签"
    scope:
      tools: [bps_update_entity]
    condition: "consentSigned == true"
    onViolation: REQUIRE_APPROVAL
    severity: CRITICAL
    message: "Treatment requires signed consent"
`;
    const result = loadGovernanceFromString(yaml);
    expect(result.errors).toHaveLength(0);
    expect(result.constraints).toHaveLength(2);
    expect(result.constraints[0].policyId).toBe('auto-policy');
    expect(result.constraints[0].id).toBe('no-double-discount');
    expect(result.constraints[0].onViolation).toBe('BLOCK');
    expect(result.constraints[1].id).toBe('consent-required');
    expect(result.constraints[1].onViolation).toBe('REQUIRE_APPROVAL');
  });

  it('should normalize flat constraints with "action" field and missing scope', () => {
    const yaml = `
constraints:
  - id: botox-limit
    label: "肉毒素2月限200U"
    condition: "totalUnits <= 200"
    action: BLOCK
    severity: CRITICAL
    message: "Botox limit exceeded"
`;
    const result = loadGovernanceFromString(yaml);
    expect(result.errors).toHaveLength(0);
    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0].onViolation).toBe('BLOCK');
    // Should default scope.tools to all write tools (except bps_load_governance)
    expect(result.constraints[0].scope.tools).toContain('bps_update_entity');
    expect(result.constraints[0].scope.tools).toContain('bps_create_task');
    expect(result.constraints[0].scope.tools).toContain('bps_load_blueprint');
    expect(result.constraints[0].scope.tools).toContain('bps_register_agent');
    expect(result.constraints[0].scope.tools).not.toContain('bps_load_governance');
    expect(result.constraints[0].scope.tools.length).toBe(8);
  });
});

// ——— ActionGate ———

describe('ActionGate', () => {
  let store: GovernanceStore;
  let gate: ActionGate;

  beforeEach(() => {
    const db = createMemoryDatabase();
    store = new GovernanceStore(db);
    gate = new ActionGate(store);
  });

  it('should PASS read-only tools without checks', () => {
    store.loadConstraints([{
      id: 'block-all', policyId: 'p', label: 'Block',
      scope: { tools: ['bps_update_entity'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'blocked',
    }]);

    const result = gate.check('bps_get_entity', { entityType: 'store', entityId: 's1' });
    expect(result.verdict).toBe('PASS');
    expect(result.checks).toHaveLength(0);
  });

  it('should PASS when no constraints match', () => {
    store.loadConstraints([{
      id: 'expense-only', policyId: 'p', label: 'Expense',
      scope: { tools: ['bps_update_entity'], entityTypes: ['expense'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'blocked',
    }]);

    const result = gate.check('bps_update_entity', { entityType: 'store', entityId: 's1', data: {} });
    expect(result.verdict).toBe('PASS');
  });

  it('should PASS when condition evaluates to true', () => {
    store.loadConstraints([{
      id: 'budget-cap', policyId: 'financial', label: 'Budget cap',
      scope: { tools: ['bps_update_entity'], entityTypes: ['expense'] },
      condition: 'amount <= 10000',
      onViolation: 'BLOCK', severity: 'HIGH', message: 'Over budget',
    }]);

    const result = gate.check('bps_update_entity', {
      entityType: 'expense', entityId: 'exp-1', data: { amount: 5000 },
    });
    expect(result.verdict).toBe('PASS');
  });

  it('should BLOCK when condition evaluates to false', () => {
    store.loadConstraints([{
      id: 'budget-cap', policyId: 'financial', label: 'Budget cap',
      scope: { tools: ['bps_update_entity'], entityTypes: ['expense'] },
      condition: 'amount <= 10000',
      onViolation: 'BLOCK', severity: 'HIGH',
      message: 'Amount {amount} exceeds cap 10000',
    }]);

    const result = gate.check('bps_update_entity', {
      entityType: 'expense', entityId: 'exp-1', data: { amount: 50000 },
    });
    expect(result.verdict).toBe('BLOCK');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].message).toBe('Amount 50000 exceeds cap 10000');
  });

  it('should record violations when constraint fails', () => {
    store.loadConstraints([{
      id: 'no-delete', policyId: 'data', label: 'No delete',
      scope: { tools: ['bps_update_entity'], entityTypes: ['customer'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'CRITICAL', message: 'Forbidden',
    }]);

    gate.check('bps_update_entity', {
      entityType: 'customer', entityId: 'c1', data: { status: 'deleted' },
    });

    const violations = store.getRecentViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0].constraintId).toBe('no-delete');
    expect(violations[0].severity).toBe('CRITICAL');
  });

  it('should REQUIRE_APPROVAL when constraint specifies it', () => {
    store.loadConstraints([{
      id: 'large-expense', policyId: 'financial', label: 'Large expense',
      scope: { tools: ['bps_update_entity'], entityTypes: ['expense'] },
      condition: 'amount <= 5000', onViolation: 'REQUIRE_APPROVAL',
      severity: 'HIGH', approver: 'owner',
      message: 'Amount {amount} needs approval',
    }]);

    const result = gate.check('bps_update_entity', {
      entityType: 'expense', entityId: 'exp-1', data: { amount: 7000 },
    });
    expect(result.verdict).toBe('REQUIRE_APPROVAL');
  });

  it('should BLOCK over REQUIRE_APPROVAL when both fail', () => {
    store.loadConstraints([
      {
        id: 'needs-approval', policyId: 'p', label: 'Approval',
        scope: { tools: ['bps_update_entity'] },
        condition: 'amount <= 5000', onViolation: 'REQUIRE_APPROVAL',
        severity: 'HIGH', message: 'needs approval',
      },
      {
        id: 'hard-block', policyId: 'p', label: 'Hard block',
        scope: { tools: ['bps_update_entity'] },
        condition: 'amount <= 50000', onViolation: 'BLOCK',
        severity: 'CRITICAL', message: 'hard blocked',
      },
    ]);

    const result = gate.check('bps_update_entity', {
      entityType: 'any', entityId: 'a1', data: { amount: 100000 },
    });
    // Both fail, but BLOCK takes precedence
    expect(result.verdict).toBe('BLOCK');
  });

  it('should respect dataFields scope filter', () => {
    store.loadConstraints([{
      id: 'price-guard', policyId: 'p', label: 'Price guard',
      scope: { tools: ['bps_update_entity'], dataFields: ['price', 'unitPrice'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'No price changes',
    }]);

    // Doesn't touch price fields — should PASS
    const result1 = gate.check('bps_update_entity', {
      entityType: 'product', entityId: 'p1', data: { name: 'Widget' },
    });
    expect(result1.verdict).toBe('PASS');

    // Touches price — should BLOCK
    const result2 = gate.check('bps_update_entity', {
      entityType: 'product', entityId: 'p1', data: { price: 99 },
    });
    expect(result2.verdict).toBe('BLOCK');
  });

  it('should treat undefined variable as not-applicable (PASS)', () => {
    store.loadConstraints([{
      id: 'needs-field', policyId: 'p', label: 'Needs publishReady',
      scope: { tools: ['bps_update_entity'] },
      condition: 'publishReady == true',
      onViolation: 'REQUIRE_APPROVAL', severity: 'MEDIUM', message: 'Publish approval',
    }]);

    // Operation does NOT include publishReady — constraint not applicable
    const result = gate.check('bps_update_entity', {
      entityType: 'content', entityId: 'c1', data: { title: 'hello' },
    });
    expect(result.verdict).toBe('PASS');
    expect(result.checks[0].passed).toBe(true);
  });

  it('should handle genuine expression errors as BLOCK (fail-closed)', () => {
    store.loadConstraints([{
      id: 'bad-expr', policyId: 'p', label: 'Bad expression',
      scope: { tools: ['bps_update_entity'] },
      condition: '(unclosed', // parse error, not undefined variable
      onViolation: 'BLOCK', severity: 'HIGH', message: 'Error',
    }]);

    const result = gate.check('bps_update_entity', {
      entityType: 'test', entityId: 't1', data: {},
    });
    expect(result.verdict).toBe('BLOCK');
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].message).toContain('Constraint evaluation error');
  });

  it('should create approval requests', () => {
    store.loadConstraints([{
      id: 'skill-approval', policyId: 'p', label: 'Skill approval',
      scope: { tools: ['bps_create_skill'] },
      condition: 'false', onViolation: 'REQUIRE_APPROVAL',
      severity: 'MEDIUM', message: 'Skill creation needs approval',
    }]);

    const result = gate.check('bps_create_skill', { name: 'weekly-report' });
    expect(result.verdict).toBe('REQUIRE_APPROVAL');

    const approvalId = gate.createApprovalRequest('bps_create_skill', { name: 'weekly-report' }, result);
    expect(approvalId).toBeTruthy();

    const pending = store.getPendingApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0].tool).toBe('bps_create_skill');
  });

  // — P0-a: Governance bypass fix — new gated tools —

  it('should gate bps_load_blueprint', () => {
    store.loadConstraints([{
      id: 'blueprint-approval', policyId: 'p', label: 'Blueprint approval',
      scope: { tools: ['bps_load_blueprint'] },
      condition: 'false', onViolation: 'REQUIRE_APPROVAL',
      severity: 'HIGH', message: 'Blueprint loading needs approval',
    }]);

    const result = gate.check('bps_load_blueprint', { yaml: 'name: test' });
    expect(result.verdict).toBe('REQUIRE_APPROVAL');
  });

  it('should gate bps_register_agent', () => {
    store.loadConstraints([{
      id: 'agent-approval', policyId: 'p', label: 'Agent registration approval',
      scope: { tools: ['bps_register_agent'] },
      condition: 'false', onViolation: 'REQUIRE_APPROVAL',
      severity: 'HIGH', message: 'Agent registration needs approval',
    }]);

    const result = gate.check('bps_register_agent', { id: 'test-agent', name: 'Test' });
    expect(result.verdict).toBe('REQUIRE_APPROVAL');
  });

  it('should gate bps_load_governance', () => {
    store.loadConstraints([{
      id: 'governance-reload-block', policyId: 'p', label: 'Block governance reload',
      scope: { tools: ['bps_load_governance'] },
      condition: 'false', onViolation: 'BLOCK',
      severity: 'CRITICAL', message: 'Governance reload blocked',
    }]);

    const result = gate.check('bps_load_governance', { yaml: 'constraints: []' });
    expect(result.verdict).toBe('BLOCK');
  });

  it('should expose toolsProfile in eval context for bps_register_agent', () => {
    store.loadConstraints([{
      id: 'no-full-profile', policyId: 'p', label: 'No full profile',
      scope: { tools: ['bps_register_agent'] },
      condition: 'toolsProfile != "full"',
      onViolation: 'BLOCK', severity: 'LOW',
      message: 'Full tool profile not allowed',
    }]);

    // Should BLOCK when toolsProfile is "full"
    const blocked = gate.check('bps_register_agent', { id: 'a1', name: 'A', toolsProfile: 'full' });
    expect(blocked.verdict).toBe('BLOCK');

    // Should PASS when toolsProfile is "minimal"
    const passed = gate.check('bps_register_agent', { id: 'a2', name: 'B', toolsProfile: 'minimal' });
    expect(passed.verdict).toBe('PASS');
  });

  it('should expose persist and hasYaml in eval context for bps_load_blueprint', () => {
    store.loadConstraints([{
      id: 'no-persist', policyId: 'p', label: 'No persistent blueprints',
      scope: { tools: ['bps_load_blueprint'] },
      condition: 'persist == false',
      onViolation: 'BLOCK', severity: 'HIGH',
      message: 'Persistent blueprint loading blocked',
    }]);

    // Should BLOCK when persist is true (default)
    const blocked = gate.check('bps_load_blueprint', { yaml: 'name: test' });
    expect(blocked.verdict).toBe('BLOCK');

    // Should PASS when persist is false
    const passed = gate.check('bps_load_blueprint', { yaml: 'name: test', persist: false });
    expect(passed.verdict).toBe('PASS');
  });
});

// ——— Circuit Breaker ———

describe('CircuitBreaker', () => {
  let store: GovernanceStore;
  let gate: ActionGate;

  beforeEach(() => {
    const db = createMemoryDatabase();
    store = new GovernanceStore(db);
    const cbConfig: CircuitBreakerConfig = {
      thresholds: [
        { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
        { severity: 'HIGH', maxViolations: 3, window: '1h', action: 'RESTRICTED' },
        { severity: 'HIGH', maxViolations: 2, window: '1h', action: 'WARNING' },
      ],
    };
    gate = new ActionGate(store, cbConfig);
  });

  it('should escalate to WARNING after 2 HIGH violations', () => {
    store.loadConstraints([{
      id: 'always-fail', policyId: 'p', label: 'Always fail',
      scope: { tools: ['bps_update_entity'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'fail',
    }]);

    gate.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    gate.check('bps_update_entity', { entityType: 'x', entityId: '2', data: {} });

    const state = store.getCircuitBreakerState();
    expect(state.state).toBe('WARNING');
  });

  it('should escalate to RESTRICTED after 3 HIGH violations', () => {
    store.loadConstraints([{
      id: 'always-fail', policyId: 'p', label: 'Always fail',
      scope: { tools: ['bps_update_entity'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'fail',
    }]);

    gate.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    gate.check('bps_update_entity', { entityType: 'x', entityId: '2', data: {} });
    gate.check('bps_update_entity', { entityType: 'x', entityId: '3', data: {} });

    const state = store.getCircuitBreakerState();
    expect(state.state).toBe('RESTRICTED');
  });

  it('should DISCONNECT after 1 CRITICAL violation', () => {
    store.loadConstraints([{
      id: 'critical-fail', policyId: 'p', label: 'Critical',
      scope: { tools: ['bps_update_entity'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'CRITICAL', message: 'critical fail',
    }]);

    const result = gate.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    expect(result.circuitBreakerState).toBe('DISCONNECTED');
  });

  it('should BLOCK all write ops when RESTRICTED', () => {
    // Manually set RESTRICTED state
    store.updateCircuitBreaker('RESTRICTED', {
      critical: 0, high: 3,
      windowStart: new Date().toISOString(),
    });

    const result = gate.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    expect(result.verdict).toBe('BLOCK');
    expect(result.circuitBreakerState).toBe('RESTRICTED');
    expect(result.checks[0].message).toContain('RESTRICTED');
  });

  it('should BLOCK all write ops when DISCONNECTED', () => {
    store.updateCircuitBreaker('DISCONNECTED', {
      critical: 1, high: 0,
      windowStart: new Date().toISOString(),
    });

    const result = gate.check('bps_create_task', { serviceId: 'svc-1' });
    expect(result.verdict).toBe('BLOCK');
    expect(result.circuitBreakerState).toBe('DISCONNECTED');
  });

  it('should still allow read ops when RESTRICTED', () => {
    store.updateCircuitBreaker('RESTRICTED', {
      critical: 0, high: 5,
      windowStart: new Date().toISOString(),
    });

    const result = gate.check('bps_get_entity', { entityType: 'x', entityId: '1' });
    expect(result.verdict).toBe('PASS');
  });

  it('should recover to NORMAL after circuit breaker reset', () => {
    store.updateCircuitBreaker('DISCONNECTED', {
      critical: 1, high: 0,
      windowStart: new Date().toISOString(),
    });

    store.resetCircuitBreaker();
    const state = store.getCircuitBreakerState();
    expect(state.state).toBe('NORMAL');

    // Write ops should work again (no constraints loaded)
    const result = gate.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    expect(result.verdict).toBe('PASS');
  });

  // — P1-a: Cooldown auto-recovery —

  it('should auto-recover after cooldown period with no new violations', () => {
    // Use a very short cooldown for testing
    const cbConfig: CircuitBreakerConfig = {
      thresholds: [
        { severity: 'HIGH', maxViolations: 1, window: '1h', action: 'WARNING' },
      ],
      cooldown: '1s', // 1 second cooldown
    };
    const gate2 = new ActionGate(store, cbConfig);

    // Manually escalate to WARNING (without creating violations that would block recovery)
    store.updateCircuitBreaker('WARNING', { critical: 0, high: 1, windowStart: new Date().toISOString() });
    expect(store.getCircuitBreakerState().state).toBe('WARNING');

    // Set lastStateChange to 2 seconds ago to exceed cooldown
    const db2 = (store as any).db as import('node:sqlite').DatabaseSync;
    const pastTime = new Date(Date.now() - 2000).toISOString();
    db2.exec(`UPDATE bps_governance_circuit_breaker SET last_state_change = '${pastTime}' WHERE id = 'singleton'`);

    // Next check should trigger cooldown recovery (no constraints → no violations → recovery)
    const result = gate2.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    expect(result.circuitBreakerState).toBe('NORMAL');
    expect(result.verdict).toBe('PASS');
  });

  it('should not auto-recover if new violations exist in window', () => {
    const cbConfig: CircuitBreakerConfig = {
      thresholds: [
        { severity: 'HIGH', maxViolations: 1, window: '1h', action: 'WARNING' },
      ],
      cooldown: '1s',
    };
    const gate2 = new ActionGate(store, cbConfig);

    store.loadConstraints([{
      id: 'fail', policyId: 'p', label: 'Fail',
      scope: { tools: ['bps_update_entity'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'fail',
    }]);

    // Trigger violation → WARNING
    gate2.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    expect(store.getCircuitBreakerState().state).toBe('WARNING');

    // Set lastStateChange to the past but keep the constraint active
    const db2 = (store as any).db as import('node:sqlite').DatabaseSync;
    const pastTime = new Date(Date.now() - 2000).toISOString();
    db2.exec(`UPDATE bps_governance_circuit_breaker SET last_state_change = '${pastTime}' WHERE id = 'singleton'`);

    // Next check will record a new violation (constraint still active), so no recovery
    const result = gate2.check('bps_update_entity', { entityType: 'x', entityId: '1', data: {} });
    // Should still be WARNING or escalated, not NORMAL
    expect(result.circuitBreakerState).not.toBe('NORMAL');
  });
});

// ——— Integration: tools wrapper ———

describe('GovernanceToolWrapper', () => {
  it('should wrap write tools and block based on constraints', async () => {
    const db = createMemoryDatabase();
    const govStore = new GovernanceStore(db);
    const actionGate = new ActionGate(govStore);

    govStore.loadConstraints([{
      id: 'no-archived', policyId: 'p', label: 'No archive',
      scope: { tools: ['bps_update_entity'] },
      condition: 'status != "archived"',
      onViolation: 'BLOCK', severity: 'HIGH',
      message: 'Cannot set status to archived',
    }]);

    // Import and create tools with governance
    const { createBpsEngine } = await import('../src/index.js');
    const engine = createBpsEngine({ db });
    const { createBpsTools } = await import('../src/integration/tools.js');
    const tools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      governanceGate: actionGate,
      governanceStore: govStore,
    });

    const updateTool = tools.find(t => t.name === 'bps_update_entity')!;
    expect(updateTool).toBeDefined();

    // Should throw when status = archived (governance BLOCK)
    await expect(updateTool.execute('call-1', {
      entityType: 'store', entityId: 's1',
      data: { status: 'archived' },
    })).rejects.toThrow('GOVERNANCE BLOCKED');

    // Should pass when status = active
    const passed = await updateTool.execute('call-2', {
      entityType: 'store', entityId: 's2',
      data: { status: 'active' },
    });
    expect((passed as Record<string, unknown>).success).toBe(true);
  });

  it('should include governance_status tool when governance is configured', async () => {
    const db = createMemoryDatabase();
    const govStore = new GovernanceStore(db);
    const actionGate = new ActionGate(govStore);

    const { createBpsEngine } = await import('../src/index.js');
    const engine = createBpsEngine({ db });
    const { createBpsTools } = await import('../src/integration/tools.js');
    const tools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      governanceGate: actionGate,
      governanceStore: govStore,
    });

    const govTool = tools.find(t => t.name === 'bps_governance_status');
    expect(govTool).toBeDefined();

    const result = await govTool!.execute('call-1', {}) as Record<string, unknown>;
    expect(result.circuitBreakerState).toBe('NORMAL');
    expect(result.activeConstraints).toBe(0);
  });

  it('should include bps_load_governance tool when governance is configured', async () => {
    const db = createMemoryDatabase();
    const govStore = new GovernanceStore(db);
    const actionGate = new ActionGate(govStore);

    const { createBpsEngine } = await import('../src/index.js');
    const engine = createBpsEngine({ db });
    const { createBpsTools } = await import('../src/integration/tools.js');
    const tools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      governanceGate: actionGate,
      governanceStore: govStore,
    });

    const loadGovTool = tools.find(t => t.name === 'bps_load_governance');
    expect(loadGovTool).toBeDefined();

    // Load governance from inline YAML (flat format)
    const result = await loadGovTool!.execute('call-1', {
      yaml: `
constraints:
  - id: test-constraint
    label: Test
    condition: "amount <= 100"
    action: BLOCK
    severity: HIGH
    message: "Over limit"
`,
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.constraintsLoaded).toBe(1);

    // Verify constraints are now active
    const statusTool = tools.find(t => t.name === 'bps_governance_status')!;
    const status = await statusTool.execute('call-2', {}) as Record<string, unknown>;
    expect(status.activeConstraints).toBe(1);
  });

  it('should not wrap read-only tools', async () => {
    const db = createMemoryDatabase();
    const govStore = new GovernanceStore(db);
    const actionGate = new ActionGate(govStore);

    // Load a constraint that blocks everything
    govStore.loadConstraints([{
      id: 'block-all', policyId: 'p', label: 'Block all',
      scope: { tools: ['bps_update_entity', 'bps_get_entity'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH', message: 'blocked',
    }]);

    const { createBpsEngine } = await import('../src/index.js');
    const engine = createBpsEngine({ db });
    const { createBpsTools } = await import('../src/integration/tools.js');
    const tools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      governanceGate: actionGate,
      governanceStore: govStore,
    });

    // bps_get_entity is read-only, should not be wrapped
    const getTool = tools.find(t => t.name === 'bps_get_entity')!;
    const result = await getTool.execute('call-1', { entityType: 'store', entityId: 's1' });
    // Should return "not found" error (not governance_blocked)
    expect((result as Record<string, unknown>).governance_blocked).toBeUndefined();
  });

  // — P0-a: Governance wrapper for newly gated tools —

  it('should governance-wrap bps_load_blueprint', async () => {
    const db = createMemoryDatabase();
    const govStore = new GovernanceStore(db);
    const actionGate = new ActionGate(govStore);

    govStore.loadConstraints([{
      id: 'block-blueprints', policyId: 'p', label: 'Block blueprints',
      scope: { tools: ['bps_load_blueprint'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH',
      message: 'Blueprint loading blocked by governance',
    }]);

    const { createBpsEngine } = await import('../src/index.js');
    const engine = createBpsEngine({ db });
    const { createBpsTools } = await import('../src/integration/tools.js');
    const tools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      governanceGate: actionGate,
      governanceStore: govStore,
    });

    const loadBpTool = tools.find(t => t.name === 'bps_load_blueprint')!;
    expect(loadBpTool).toBeDefined();

    await expect(loadBpTool.execute('call-1', {
      yaml: 'name: test\nservices:\n  - id: s1\n    label: Test\n    executor: agent',
    })).rejects.toThrow('GOVERNANCE BLOCKED');
  });

  it('should governance-wrap bps_register_agent', async () => {
    const db = createMemoryDatabase();
    const govStore = new GovernanceStore(db);
    const actionGate = new ActionGate(govStore);

    govStore.loadConstraints([{
      id: 'block-agents', policyId: 'p', label: 'Block agent registration',
      scope: { tools: ['bps_register_agent'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'HIGH',
      message: 'Agent registration blocked by governance',
    }]);

    const { createBpsEngine } = await import('../src/index.js');
    const engine = createBpsEngine({ db });
    const { createBpsTools } = await import('../src/integration/tools.js');
    const tools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      governanceGate: actionGate,
      governanceStore: govStore,
    });

    const registerTool = tools.find(t => t.name === 'bps_register_agent')!;
    expect(registerTool).toBeDefined();

    await expect(registerTool.execute('call-1', {
      id: 'test-agent', name: 'Test Agent',
    })).rejects.toThrow('GOVERNANCE BLOCKED');
  });

  it('should governance-wrap bps_load_governance', async () => {
    const db = createMemoryDatabase();
    const govStore = new GovernanceStore(db);
    const actionGate = new ActionGate(govStore);

    govStore.loadConstraints([{
      id: 'block-gov-reload', policyId: 'p', label: 'Block governance reload',
      scope: { tools: ['bps_load_governance'] },
      condition: 'false', onViolation: 'BLOCK', severity: 'CRITICAL',
      message: 'Governance reload blocked',
    }]);

    const { createBpsEngine } = await import('../src/index.js');
    const engine = createBpsEngine({ db });
    const { createBpsTools } = await import('../src/integration/tools.js');
    const tools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      governanceGate: actionGate,
      governanceStore: govStore,
    });

    const loadGovTool = tools.find(t => t.name === 'bps_load_governance')!;
    expect(loadGovTool).toBeDefined();

    await expect(loadGovTool.execute('call-1', {
      yaml: 'constraints: []',
    })).rejects.toThrow('GOVERNANCE BLOCKED');
  });
});

// ——— P3: Constraint effectiveness analytics ———

describe('ConstraintEffectiveness', () => {
  it('should return per-constraint violation and approval stats', () => {
    const db = createMemoryDatabase();
    const store = new GovernanceStore(db);

    store.loadConstraints([{
      id: 'c-publish', policyId: 'p-1', label: 'Publish gate',
      scope: { tools: ['bps_update_entity'] },
      condition: 'publishReady == 0',
      onViolation: 'REQUIRE_APPROVAL', severity: 'HIGH',
      message: 'Requires approval',
    }]);

    // Record violations
    for (let i = 0; i < 5; i++) {
      store.recordViolation({
        constraintId: 'c-publish', policyId: 'p-1', severity: 'HIGH',
        tool: 'bps_update_entity', verdict: 'REQUIRE_APPROVAL',
        condition: 'publishReady == 0', evalContext: {}, message: 'test',
        circuitBreakerState: 'NORMAL',
      });
    }

    // Create and decide approvals
    for (let i = 0; i < 3; i++) {
      const approval = store.createApproval({
        constraintId: 'c-publish', tool: 'bps_update_entity',
        toolInput: {}, message: 'test', expiresAt: '2099-01-01',
      });
      store.decideApproval(approval.id, i < 2 ? 'APPROVED' : 'REJECTED');
    }

    const stats = store.getConstraintEffectiveness();
    expect(stats.length).toBe(1);
    expect(stats[0].constraintId).toBe('c-publish');
    expect(stats[0].violationCount).toBe(5);
    expect(stats[0].approvedCount).toBe(2);
    expect(stats[0].rejectedCount).toBe(1);
    // Not enough samples (need 5 decided) for approval rate
    expect(stats[0].approvalRate).toBeNull();
    expect(stats[0].suggestion).toBeNull();
  });

  it('should suggest relaxing when approval rate > 90% with enough samples', () => {
    const db = createMemoryDatabase();
    const store = new GovernanceStore(db);

    store.loadConstraints([{
      id: 'c-strict', policyId: 'p', label: 'Too strict',
      scope: { tools: ['bps_update_entity'] },
      condition: 'x == 0',
      onViolation: 'REQUIRE_APPROVAL', severity: 'HIGH',
      message: 'test',
    }]);

    // 19 approved, 1 rejected → 95% approval rate
    for (let i = 0; i < 20; i++) {
      const a = store.createApproval({
        constraintId: 'c-strict', tool: 'bps_update_entity',
        toolInput: {}, message: 'test', expiresAt: '2099-01-01',
      });
      store.decideApproval(a.id, i < 19 ? 'APPROVED' : 'REJECTED');
    }

    const stats = store.getConstraintEffectiveness();
    expect(stats[0].approvalRate).toBeCloseTo(0.95, 2);
    expect(stats[0].suggestion).toContain('too strict');
  });
});

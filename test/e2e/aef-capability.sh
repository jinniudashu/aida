#!/usr/bin/env bash
# ============================================================
# AEF Capability Test v0.1
# Supplements structural-capability.sh with AEF dimension gaps
# Σ1 PROC (6) + Σ7 SCHED (5) + Σ9 HIER (3) + ΣX Cross (6) = 20 checks
# Engine-only, in-memory DB, ~3 seconds
# ============================================================
set -euo pipefail

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== AEF Capability Test v0.1 ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# Check prerequisites
if [ ! -d "dist" ]; then
  echo "dist/ not found, building..."
  npx tsc
fi

# Run all 20 checks in a single Node.js process
node --input-type=module << 'NODEEOF'
import { createBpsEngine } from './dist/index.js';
import { createBpsTools } from './dist/integration/tools.js';
import { ManagementStore } from './dist/management/management-store.js';
import { ActionGate } from './dist/management/action-gate.js';
import { GATED_WRITE_TOOLS } from './dist/management/constants.js';

let pass = 0, fail = 0;
function check(id, dim, desc, passed) {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${id} (${dim}) ${desc}`);
  if (passed) pass++; else fail++;
}

// ─── Setup ──────────────────────────────────────────────────

const engine = createBpsEngine();

// Tools (no management wrapping — clean process/scheduling tests)
const tools = createBpsTools({
  tracker: engine.tracker,
  blueprintStore: engine.blueprintStore,
  processStore: engine.processStore,
  dossierStore: engine.dossierStore,
  skillMetricsStore: engine.skillMetricsStore,
});
const scanWork = tools.find(t => t.name === 'bps_scan_work');
const completeTaskTool = tools.find(t => t.name === 'bps_complete_task');

// Management (for Σ9 + ΣX)
const mgmtStore = new ManagementStore(engine.db);
const gate = new ActionGate(mgmtStore);

// ─── Σ1 PROC: Process Lifecycle (6 checks) ─────────────────

console.log('\n--- Σ1 PROC: Process Lifecycle ---');

// E1.01: Create task → OPEN
const t1 = engine.tracker.createTask({ serviceId: 'aef-proc-lifecycle' });
check('E1.01', 'Σ1', 'Create task → state=OPEN', t1.state === 'OPEN');

// E1.02: OPEN → IN_PROGRESS
const t1u = engine.tracker.updateTask(t1.id, { state: 'IN_PROGRESS' });
check('E1.02', 'Σ1', 'OPEN → IN_PROGRESS transition', t1u.state === 'IN_PROGRESS');

// E1.03: Complete with outcome=success → stored in snapshot
await completeTaskTool.execute('test', { taskId: t1.id, outcome: 'success' });
const snap1 = engine.processStore.getLatestSnapshot(t1.id);
check('E1.03', 'Σ1', 'Complete outcome=success stored in snapshot',
  snap1?.contextData?._outcome === 'success');

// E1.04: New task → complete with outcome=partial
const t2 = engine.tracker.createTask({ serviceId: 'aef-proc-partial' });
engine.tracker.updateTask(t2.id, { state: 'IN_PROGRESS' });
await completeTaskTool.execute('test', { taskId: t2.id, outcome: 'partial' });
const snap2 = engine.processStore.getLatestSnapshot(t2.id);
check('E1.04', 'Σ1', 'Complete outcome=partial stored in snapshot',
  snap2?.contextData?._outcome === 'partial');

// E1.05: IN_PROGRESS → FAILED
const t3 = engine.tracker.createTask({ serviceId: 'aef-proc-fail' });
engine.tracker.updateTask(t3.id, { state: 'IN_PROGRESS' });
const t3f = engine.tracker.failTask(t3.id, 'test failure reason');
check('E1.05', 'Σ1', 'IN_PROGRESS → FAILED via failTask()', t3f.state === 'FAILED');

// E1.06: IN_PROGRESS → BLOCKED
const t4 = engine.tracker.createTask({ serviceId: 'aef-proc-block' });
engine.tracker.updateTask(t4.id, { state: 'IN_PROGRESS' });
try {
  const t4b = engine.tracker.updateTask(t4.id, { state: 'BLOCKED' });
  check('E1.06', 'Σ1', 'IN_PROGRESS → BLOCKED transition', t4b.state === 'BLOCKED');
} catch (e) {
  // State machine may not allow this transition
  check('E1.06', 'Σ1', 'IN_PROGRESS → BLOCKED transition (unsupported: ' + e.message + ')', false);
}

// ─── Σ7 SCHED: Scheduling Efficiency (5 checks) ────────────

console.log('\n--- Σ7 SCHED: Scheduling Efficiency ---');

const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

// Create overdue task (past deadline, lower priority)
const tOverdue = engine.tracker.createTask({
  serviceId: 'aef-sched-overdue',
  priority: 3,
  deadline: pastDeadline,
});

// Create future task (future deadline, higher priority)
const tFuture = engine.tracker.createTask({
  serviceId: 'aef-sched-future',
  priority: 10,
  deadline: futureDeadline,
});

// E7.01: Overdue task has past deadline
check('E7.01', 'Σ7', 'Task with past deadline created',
  !!tOverdue.deadline && tOverdue.deadline < new Date().toISOString());

// Call scan_work to test overdueTasks detection
const scanResult = await scanWork.execute('test', {});

// E7.02: overdueTasks detected
check('E7.02', 'Σ7', 'scan_work overdueTasks.total ≥ 1',
  scanResult.overdueTasks.total >= 1);

// E7.03: Overdue task ID in items
const overdueIds = scanResult.overdueTasks.items.map(i => i.id);
check('E7.03', 'Σ7', 'Overdue task ID appears in overdueTasks.items',
  overdueIds.includes(tOverdue.id));

// E7.04: Future task NOT in overdueTasks
check('E7.04', 'Σ7', 'Future-deadline task NOT in overdueTasks',
  !overdueIds.includes(tFuture.id));

// E7.05: sortByUrgency — deadline ASC (overdue before future in openTasks)
const openIds = scanResult.openTasks.items.map(i => i.id);
const overdueIdx = openIds.indexOf(tOverdue.id);
const futureIdx = openIds.indexOf(tFuture.id);
check('E7.05', 'Σ7', 'Deadline ASC sort: overdue (priority=3) before future (priority=10)',
  overdueIdx >= 0 && futureIdx >= 0 && overdueIdx < futureIdx);

// ─── Σ9 HIER: Hierarchical Coherence (3 checks) ────────────

console.log('\n--- Σ9 HIER: Hierarchical Coherence ---');

// Seed management constraints for hierarchy testing
mgmtStore.loadConstraints([
  {
    id: 'aef-hier-publish',
    policyId: 'aef-policy',
    label: 'Content publish requires approval',
    scope: { tools: ['bps_update_entity'], entityTypes: ['content'], dataFields: ['publishReady'] },
    condition: 'publishReady != true',
    onViolation: 'REQUIRE_APPROVAL',
    severity: 'HIGH',
    message: 'Content publish needs human approval',
  },
  {
    id: 'aef-hier-archive',
    policyId: 'aef-policy',
    label: 'Archive operations blocked',
    scope: { tools: ['bps_update_entity', 'bps_create_task'] },
    condition: 'lifecycle != "ARCHIVED"',
    onViolation: 'BLOCK',
    severity: 'CRITICAL',
    message: 'Archive operations are prohibited',
  },
]);

const constraints = mgmtStore.listConstraints();

// E9.01: All constraints have scope.tools defined
check('E9.01', 'Σ9', 'All constraints have scope.tools[]',
  constraints.every(c => Array.isArray(c.scope?.tools) && c.scope.tools.length > 0));

// E9.02: All scope.tools are valid GATED_WRITE_TOOLS members
const allToolsValid = constraints.every(c =>
  c.scope.tools.every(t => GATED_WRITE_TOOLS.includes(t)));
check('E9.02', 'Σ9', 'scope.tools ⊆ GATED_WRITE_TOOLS',
  allToolsValid);

// E9.03: At least one constraint scopes by entityType (layered hierarchy)
check('E9.03', 'Σ9', 'At least one constraint scopes by entityType',
  constraints.some(c => Array.isArray(c.scope?.entityTypes) && c.scope.entityTypes.length > 0));

// ─── ΣX: Cross-dimensional Chains (6 checks) ───────────────

console.log('\n--- ΣX: Cross-dimensional Chains ---');

// EX.01: Σ3→Σ4 — CRITICAL violation → circuit breaker DISCONNECTED
mgmtStore.resetCircuitBreaker();
gate.check('bps_update_entity', {
  entityType: 'content',
  entityId: 'chain-test',
  data: { lifecycle: 'ARCHIVED' },
});
const cbAfterCritical = mgmtStore.getCircuitBreakerState();
check('EX.01', 'ΣX', 'Σ3→Σ4: CRITICAL violation → CB DISCONNECTED',
  cbAfterCritical.state === 'DISCONNECTED');

// EX.02: Σ4→Σ3 — Reset CB → write operation PASS
mgmtStore.resetCircuitBreaker();
const afterReset = gate.check('bps_update_entity', {
  entityType: 'store',  // no constraints match 'store' + no matching data
  entityId: 'chain-test',
  data: { name: 'test store' },
});
check('EX.02', 'ΣX', 'Σ4→Σ3: CB reset → write PASS',
  afterReset.verdict === 'PASS');

// EX.03: Σ3→Σ5 — 3 violations → constraintEffectiveness tracks count
// Clear prior violations so CB stays NORMAL during 3 HIGH violations
engine.db.exec('DELETE FROM bps_management_violations');
mgmtStore.resetCircuitBreaker();
for (let i = 0; i < 3; i++) {
  gate.check('bps_update_entity', {
    entityType: 'content',
    entityId: `eff-test-${i}`,
    data: { publishReady: true },
  });
}
const effectiveness = mgmtStore.getConstraintEffectiveness();
const publishEff = effectiveness.find(e => e.constraintId === 'aef-hier-publish');
check('EX.03', 'ΣX', 'Σ3→Σ5: 3 violations → effectiveness.violationCount ≥ 3',
  publishEff != null && publishEff.violationCount >= 3);

// EX.04: Σ5 suggestion — high approval rate → relaxation suggestion
// Seed 25 approval records: 23 approved, 2 rejected (92% rate, ≥20 samples)
for (let i = 0; i < 25; i++) {
  const appr = mgmtStore.createApproval({
    constraintId: 'aef-hier-publish',
    tool: 'bps_update_entity',
    toolInput: { entityType: 'content', entityId: `sug-${i}`, data: { publishReady: true } },
    entityType: 'content',
    entityId: `sug-${i}`,
    message: 'Approval test',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  mgmtStore.decideApproval(appr.id, i < 23 ? 'APPROVED' : 'REJECTED');
}
const effAfterApprovals = mgmtStore.getConstraintEffectiveness();
const publishSug = effAfterApprovals.find(e => e.constraintId === 'aef-hier-publish');
check('EX.04', 'ΣX', 'Σ5: 92% approval rate (≥20 samples) → suggestion generated',
  publishSug?.suggestion != null && publishSug.suggestion.length > 0);

// EX.05: Σ1→Σ7→Σ6 — scan_work summary includes task counts
check('EX.05', 'ΣX', 'Σ1→Σ7→Σ6: scan_work summary mentions task counts',
  typeof scanResult.summary === 'string' &&
  (scanResult.summary.includes('open') || scanResult.summary.includes('overdue') || scanResult.summary.includes('failed')));

// EX.06: Σ1→Σ5 — outcome=partial flows to outcomeDistribution
check('EX.06', 'ΣX', 'Σ1→Σ5: outcomeDistribution.partial ≥ 1',
  scanResult.outcomeDistribution.partial >= 1);

// ─── Report ─────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`AEF Capability Test v0.1`);
console.log(`PASS: ${pass} | FAIL: ${fail} | TOTAL: ${pass + fail}`);
console.log(`${'='.repeat(50)}`);

if (fail > 0) process.exit(1);

NODEEOF

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "All AEF checks passed."
else
  echo ""
  echo "Some AEF checks failed (exit code: $EXIT_CODE)."
fi

exit $EXIT_CODE

# AIDA Structural Capability E2E Test

## Purpose

Test all structural engine features through the deployed AIDA system. This is the **primary iteration tool** for AIDA development — run after every significant code change to verify structural integrity.

**Design Philosophy**:
- **Deterministic over probabilistic**: Most checks are programmatic (direct engine API + Dashboard API), not dependent on LLM behavior
- **Fast**: Target 5-10 minutes (vs 30+ minutes for full benchmark)
- **Comprehensive**: Covers every structural feature from P0-P3 roadmap
- **Self-contained**: Single script, seeds its own data, cleans up after itself

## Coverage Matrix

| Dimension | # Checks | Features Tested |
|-----------|----------|-----------------|
| D1: Governance Gating | 12 | 9 tool coverage, PASS/BLOCK/REQUIRE_APPROVAL verdicts, error throwing |
| D2: Circuit Breaker | 8 | Escalation (NORMAL→WARNING→RESTRICTED→DISCONNECTED), cooldown recovery, oscillation detection |
| D3: Information Summary | 8 | topN shape, summary string, brief mode, recommendation, sortByUrgency, dormant skills |
| D4: Process Groups | 5 | groupId creation, batch update (COMPLETED/FAILED), filterState |
| D5: Entity Relations | 5 | relation declaration, relatedEntities resolution, relation types |
| D6: Skill Metrics | 5 | metric recording, outcome tracking, dormant detection |
| D7: Constraint Analytics | 4 | effectiveness stats, approval rate, suggestions |
| D8: Dashboard API | 8 | governance status endpoint shape, entity shapes, scan_work API shape |
| **Total** | **55** | |

## Execution

```bash
# On test server (root@47.236.109.62):
bash test/e2e/structural-capability.sh

# Options:
bash test/e2e/structural-capability.sh --skip-install    # Skip reinstall
bash test/e2e/structural-capability.sh --phase N         # Start from phase N
bash test/e2e/structural-capability.sh --engine-only     # Skip agent turns (fast mode)
```

## Phases

### Phase 0: Install Verification
Reuses idlex-geo-v3 bootstrap checks: workspace files, skills, dashboard health.

### Phase 1: Data Seeding
Seeds controlled test data designed to exercise specific features:
- **Governance**: 3 constraints (REQUIRE_APPROVAL × 2, BLOCK × 1)
- **Entities**: 5 store entities + 1 action-plan + 1 strategy
- **Blueprint**: 1 blueprint with flow (for next_steps)
- **Skills**: 8 skill directories (7 base + 1 test skill)
- **Tasks**: 3 tasks with groupId + priority + deadline (for batch/sort tests)

### Phase 2: Engine Structural Tests (Programmatic)
Inline TypeScript imports the engine and exercises every P0-P3 feature:

**D1: Governance Gating**
- S2.01: All 9 GATED_WRITE_TOOLS produce governance check
- S2.02: Read-only tool (bps_list_services) bypasses governance
- S2.03: BLOCK verdict throws Error with "GOVERNANCE BLOCKED"
- S2.04: REQUIRE_APPROVAL verdict throws Error with approval ID
- S2.05: PASS verdict executes normally
- S2.06: Constraint scope matching (entityType filter)
- S2.07: Constraint scope matching (dataFields filter)
- S2.08: New tools (bps_batch_update, bps_load_blueprint, bps_register_agent) are gated

**D2: Circuit Breaker**
- S2.09: CRITICAL violation → DISCONNECTED
- S2.10: DISCONNECTED blocks all writes immediately
- S2.11: HIGH violations accumulate → WARNING → RESTRICTED
- S2.12: Cooldown recovery auto-downgrades after elapsed time
- S2.13: No recovery if new violations in window
- S2.14: Oscillation detection locks state (>3 transitions/1h)

**D3: Information Summary**
- S2.15: bps_scan_work returns topN shape {items, total, showing}
- S2.16: bps_scan_work summary string is non-empty
- S2.17: bps_scan_work sortByUrgency (deadline ASC, priority DESC)
- S2.18: bps_query_entities brief=true returns compact shape
- S2.19: bps_next_steps returns recommendation field
- S2.20: bps_scan_work outcomeDistribution has success/partial/failed

**D4: Process Groups**
- S2.21: bps_create_task with groupId stores correctly
- S2.22: bps_batch_update completes all tasks in group
- S2.23: bps_batch_update with filterState only updates matching
- S2.24: bps_batch_update FAILED with reason stores in snapshot

**D5: Entity Relations**
- S2.25: bps_update_entity with relations stores them
- S2.26: bps_get_entity returns relatedEntities with version/updatedAt
- S2.27: Relation types: depends_on, part_of, references

**D6: Skill Metrics**
- S2.28: bps_complete_task records skill metric when serviceId matches skill dir
- S2.29: Skill metric not recorded when serviceId doesn't match
- S2.30: Dormant skills detected (no invocation in 90 days)

**D7: Constraint Analytics**
- S2.31: getConstraintEffectiveness returns per-constraint stats
- S2.32: Stats include violationCount, approvalCount, approvalRate
- S2.33: Suggestion generated when approvalRate > 0.9 (too strict)

### Phase 3: Dashboard API Structural Tests
Curl-based checks on the running Dashboard to verify API shapes:

- S3.01: GET /api/governance/status returns constraintEffectiveness array
- S3.02: GET /api/governance/status circuitBreakerState is a string
- S3.03: GET /api/governance/violations returns array with severity field
- S3.04: GET /api/governance/constraints returns array with scope object
- S3.05: GET /api/governance/approvals returns array with status field
- S3.06: GET /api/entities returns entities (≥7 seeded)
- S3.07: POST /api/governance/circuit-breaker/reset returns success
- S3.08: POST /api/governance/approvals/:id/decide works

### Phase 4: Agent Integration Turns (optional, --full mode)
3 focused turns testing structural features through Aida:

**Turn 1**: "Query the work landscape with bps_scan_work, then list entities in brief mode."
- Verify: response contains structural metadata (total, showing)

**Turn 2**: "Create a test entity 'structural-test' with relations to store-cs-ktv-01. Then complete the open tasks."
- Verify: entity created, relations set, tasks updated

**Turn 3**: "Check governance status and tell me about constraint effectiveness."
- Verify: governance status reported, effectiveness stats mentioned

### Phase 5: Final Verification + Report
Comprehensive state checks + structured JSON report.

## Scoring

Binary PASS/FAIL per check. No weighted dimensions.

**Thresholds**:
- **GREEN**: 0 FAIL
- **YELLOW**: 1-3 FAIL
- **RED**: 4+ FAIL

## Check ID Convention

- `V0.x`: Install verification (reused from v3)
- `S2.xx`: Engine structural (programmatic, Phase 2)
- `S3.xx`: Dashboard API structural (Phase 3)
- `V4.x`: Agent integration (Phase 4)
- `V5.x`: Final verification (Phase 5)

## Output

```
/tmp/structural-capability/
├── report.txt         # Summary report
├── engine-results.json # Phase 2 detailed results
├── turn-{1,2,3}.log  # Agent turn logs (if --full)
└── metrics.json       # Dashboard metrics snapshot
```

## Relationship to Other Tests

| Test Suite | Purpose | Duration | When to Run |
|------------|---------|----------|-------------|
| `npx vitest run` | Unit tests (436) | ~30s | Every code change |
| **structural-capability.sh** | **Structural E2E (55 checks)** | **5-10 min** | **Every deploy / feature merge** |
| `idlex-geo-v3.sh` | Business scenario E2E | 20-30 min | Before release |
| `benchmark/run-all-models.sh` | Multi-model comparison | 3-4 hours | Monthly evaluation |

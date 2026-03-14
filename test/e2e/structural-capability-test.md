# AIDA Structural Capability E2E Test — IdleX GEO Business Edition

## Purpose

Test all structural engine features AND business scenario capabilities through the deployed AIDA system. This is the **primary iteration tool** for AIDA development — run after every significant code change to verify both structural integrity and business readiness.

**Design Philosophy**:
- **Deterministic backbone**: Phase 0-3 are programmatic (direct engine API + Dashboard API), 100% deterministic
- **Business overlay**: Phase 4 is a realistic IdleX GEO business scenario with business-language dialogue
- **Two-tier checks**: HARD checks (artifacts exist → FAIL) + SOFT checks (keywords in response → WARN)
- **Fast**: Target 15-20 minutes in full mode, 5 minutes engine-only
- **Self-contained**: Single script, seeds its own data, cleans up after itself

## Business Scenario: IdleX GEO Operations

A GEO负责人 (GEO Operations Lead) works with Aida to run daily AI visibility operations for IdleX partner stores.

**Business context**:
- IdleX helps partner stores "被看见" (be visible) on AI platforms (豆包/千问/元宝)
- Core strategy: "一模一策" — differentiated content per AI model
- Store types: self-serve KTV, tea rooms, mahjong rooms
- Management rules: content publish requires approval; strategy changes require confirmation
- **Collaboration**: store managers provide operational data via collaboration tasks (HITL)

**Test flow**: Briefing → Authorization → Operations → **Collaboration request** → Management trigger → Approval → Skill/Agent creation → Summary → Management review

## Coverage Matrix

| Dimension | # Checks | Features Tested |
|-----------|----------|-----------------|
| D1: Management Gating | 10 | 9 tool coverage, PASS/BLOCK/REQUIRE_APPROVAL verdicts, error throwing, scope matching |
| D2: Circuit Breaker | 6 | Escalation (NORMAL→WARNING→DISCONNECTED), cooldown recovery, oscillation detection |
| D3: Information Summary | 6 | topN shape, summary string, brief mode, recommendation, sortByUrgency, outcomeDistribution |
| D4: Process Groups | 4 | groupId creation, batch update, filterState, non-matching preservation |
| D5: Entity Relations | 5 | relation declaration, relatedEntities resolution, relation types, update tool integration |
| D6: Skill Metrics | 3 | metric recording, summary aggregation, dormant detection |
| D7: Constraint Analytics | 3 | effectiveness stats, field completeness, violation count accuracy |
| D8: Tool Registration | 2 | total tool count (19), DEFAULT_SCOPE_WRITE_TOOLS exclusion |
| D9: Saturation Signal | 6 | threshold trigger, action hints, write reset, accumulation, collaboration read classification |
| D10: Collaboration Input | 10 | task creation, schema/priority, pending status, respond, completed response, expiration, cancel, status counts, events, error handling |
| D11: Dashboard API | 16 | management + collaboration endpoints shape, status, task CRUD, respond, 404, page accessibility |
| B: Business Scenario | 33 | modeling, management routing, content gen, **collaboration request + response**, management trigger, skill/agent creation, daily ops |
| V5: Final Verification | 12 | entities, constraints, skills, content, management, collaboration, saturation |
| **Total** | **~106** | |

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
Checks workspace files, skills, dashboard health.

### Phase 1: Data Seeding
Seeds IdleX GEO business data:
- **Management**: 3 constraints (content publish approval [HIGH], archive block [CRITICAL], strategy change approval [HIGH])
- **Stores**: 5 partner stores (长沙 KTV/茶室/麻将 + 武汉 KTV/茶室) with full business data (rooms, hours, features)
- **Strategy**: GEO master strategy (三大AI平台, 一模一策)
- **Action Plan**: GEO operations action plan
- **Blueprint**: Structural test flow (probe→analyze→content/review)
- **Tasks**: 3 tasks with groupId + priority + deadline
- **Context**: IdleX GEO business background document
- **Mock dirs**: `~/.aida/mock-publish-tmp/` and `~/.aida/mock-publish/` for content output

### Phase 2: Engine Structural Tests (Programmatic)
55 checks across D1-D10. Tests saturation signal and collaboration input as new dimensions.

### Phase 3: Dashboard API Structural Tests (D11)
16 checks. Includes 5 new collaboration API endpoint checks.

### Phase 4: Business Scenario (IdleX GEO, 9 steps)

All dialogue uses business-language goal statements ("我要什么"), NOT technical instructions ("怎么做").

**Turn 1: Business Briefing**
> Background intro + management rules
- Verify: response produced, mentions plan/GEO/management

**Turn 2: Authorization + Modeling**
> "方案可以。全权交给你落地。"
- Verify: new entities created (>=3), action plan or strategy entities

**Turn 3: Daily GEO Operations**
> Visibility probe + content generation for 3 stores
- Verify: content/probe entities, content files

**Turn 3b: Collaboration Request** *(NEW)*
> "长沙声临其境KTV有几个数据需要店长确认——日均使用率、周末预约、主力消费人群。请通过协作任务向店长发起确认。"
- Verify: `bps_request_collaboration` called, pending task in Dashboard API
- **Step 3c**: Script simulates store manager response via Dashboard API

**Turn 4: Management Trigger**
> "把GEO内容标记为发布就绪。"
- Verify: management violations or approvals increased

**Step 5: Programmatic Approval (no agent turn)**
> Script queries Dashboard API for pending approvals and approves them

**Turn 6: Skill/Agent Creation**
> Skill + custom Agent workspace creation

**Turn 7: Daily Summary**
> Operations summary with data

**Turn 8: Management Review**
> Management system effectiveness review

### Phase 5: Final Verification + Report
Enhanced metrics: entity count, business entity types, content files, management stats, skills, workspaces, **collaboration tasks**, **saturation signals**.

## Check ID Convention

- `V0.x`: Install verification (7 checks)
- `S2.xx`: Engine structural (Phase 2, D1-D10, 55 checks)
- `S3.xx`: Dashboard API structural (Phase 3, D11, 16 checks)
- `B4.xx`: Business scenario (Phase 4, 33 checks)
- `V5.x`: Final verification (Phase 5, 12 checks)

## New Dimensions (v2)

### D9: Information Saturation Signal
Tests the `wrapWithReadCounter` mechanism that detects Agent "read-only analysis loops":
- **Threshold**: 5 consecutive read-only tool calls inject `_readSignal` into result
- **Reset**: Any write tool call resets counter to 0
- **Classification**: `bps_get_collaboration_response` is classified as read tool
- **Message**: Contains action hints (bps_update_entity, bps_create_task, bps_complete_task)

### D10: Collaboration Input (HITL/AITL)
Tests the `src/collaboration/` module for external collaborator form-based input:
- **Tools**: `bps_request_collaboration` (write, creates task) + `bps_get_collaboration_response` (read, checks status)
- **Store**: `CollaborationStore` with SQLite persistence + EventEmitter
- **Schema**: JSON Schema defines expected input structure (form-based: approval/choice/text are schema variants)
- **Lifecycle**: pending → completed/expired/cancelled
- **Events**: task_created, task_responded, task_cancelled

## Output

```
/tmp/structural-capability/
├── report.txt              # Summary report
├── engine-results.json     # Phase 2 detailed results (55 checks)
├── turn-{1..8,3b}.log      # Agent turn logs
├── metrics.json            # Final metrics snapshot (structural + business + collaboration)
└── seed.log                # Data seeding output
```

## Scoring

**Structural (Phase 2+3)**: Binary PASS/FAIL per check.
**Business (Phase 4)**: Two-tier — HARD checks (FAIL) + SOFT checks (WARN).

**Thresholds**:
- **GREEN**: 0 FAIL
- **YELLOW**: 1-3 FAIL
- **RED**: 4+ FAIL

## Relationship to Other Tests

| Test Suite | Purpose | Duration | When to Run |
|------------|---------|----------|-------------|
| `npx vitest run` | Unit tests (475) | ~30s | Every code change |
| **structural-capability.sh --engine-only** | **Structural only (~74 checks)** | **~5 min** | **Every deploy** |
| **structural-capability.sh** | **Structural + Business (~106 checks)** | **~20 min** | **Before release** |
| `benchmark/run-all-models.sh` | Multi-model comparison | 3-4 hours | Monthly evaluation |

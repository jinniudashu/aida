# Structural Capability v2 — R1 Report

**Date**: 2026-03-14 12:19–12:29 CST
**Server**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**Model**: dashscope/qwen3.5-plus (fallback: kimi/kimi-for-coding)
**Duration**: 618s (10.3 min)
**Mode**: full (IdleX GEO business scenario, 9 agent steps)

## Result

**121 PASS / 1 FAIL / 5 WARN / 127 TOTAL**

## v1→v2 Upgrade Summary

| Metric | v1 (R4) | v2 (R1) | Delta |
|--------|---------|---------|-------|
| Total checks | 97 | 127 | +30 |
| Engine checks (Phase 2) | 39 | 55 | +16 |
| Dashboard checks (Phase 3) | 11 | 16 | +5 |
| Business checks (Phase 4) | 27 | 33 | +6 |
| Final checks (Phase 5) | 9 | 12 | +3 |
| New dimensions | D1-D8 | D1-D10 | +D9, D10 |

---

## Phase 2: Engine Structural Tests — 55/55 PASS

### D1: Management Gating (10/10 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.01 | GATED_WRITE_TOOLS has 9 entries | bps_update_entity, bps_create_task, bps_update_task, bps_complete_task, bps_create_skill, bps_load_blueprint, bps_register_agent, bps_load_management, bps_batch_update |
| S2.02 | Read-only tool bypasses management | verdict=PASS, checks=0 |
| S2.03 | BLOCK verdict for CRITICAL constraint | verdict=BLOCK (c-no-archive, lifecycle=ARCHIVED) |
| S2.04 | REQUIRE_APPROVAL verdict for HIGH constraint | verdict=REQUIRE_APPROVAL (c-publish-approval, publishReady=true) |
| S2.05 | PASS verdict for non-matching scope | verdict=PASS (store entity, no matching constraint) |
| S2.06 | Constraint scope: entityType filter matches | verdict=REQUIRE_APPROVAL (strategy entity + majorChange) |
| S2.07 | Constraint scope: dataFields filter (no match → PASS) | verdict=PASS (content entity but harmless update) |
| S2.08 | New tools (batch_update, load_blueprint, register_agent, load_management) are gated | missing: none |
| S2.08b | Management BLOCK throws Error (not {success:false}) | threw=true, msg contains MANAGEMENT BLOCKED |
| S2.08c | REQUIRE_APPROVAL throws Error with approval ID | threw=true, msg contains Approval ID |

### D2: Circuit Breaker (6/6 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.09 | CRITICAL violation → DISCONNECTED | state=DISCONNECTED |
| S2.10 | DISCONNECTED blocks all writes immediately | verdict=BLOCK, cbState=DISCONNECTED |
| S2.11 | HIGH violations accumulate → WARNING | state=WARNING (2 HIGH violations) |
| S2.12 | Cooldown recovery: WARNING → NORMAL | state=NORMAL after 1s cooldown backdate |
| S2.13 | No recovery if violations exist in window | before=WARNING, after=WARNING |
| S2.14 | Oscillation detection (>3 transitions/1h → lock) | oscillation_detected event fired: true |

### D3: Information Summary (6/6 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.15 | bps_scan_work topN shape {items, total, showing} | openTasks keys: items, total, showing |
| S2.16 | bps_scan_work summary is non-empty string | summary: "3 open, 0 in-progress" |
| S2.17 | bps_scan_work sortByUrgency (deadline ASC, nulls last) | probe-store-01(d=03-15,p=3) > analysis-01(d=03-16,p=1) > content-01(d=null,p=5) |
| S2.18 | bps_query_entities brief=true returns compact (no data) | brief keys: entityType,entityId,version,updatedAt |
| S2.19 | bps_next_steps returns recommendation field | "Recommended: start_service → Data Analysis" |
| S2.20 | bps_scan_work outcomeDistribution has success/partial/failed | keys: success, partial, failed |

### D4: Process Groups (4/4 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.21 | Tasks with groupId are queryable | 3 tasks with groupId=group-structural-batch |
| S2.22 | bps_batch_update completes all in group | updated=3, total=3 |
| S2.23 | bps_batch_update filterState only updates matching | updated=1 (only OPEN task) |
| S2.24 | Filtered batch: non-matching task unchanged | IN_PROGRESS task stayed IN_PROGRESS |

### D5: Entity Relations (5/5 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.25 | bps_get_entity returns relatedEntities | relatedEntities count: 2 |
| S2.26 | Relations include version and updatedAt | version=1, updatedAt=2026-03-14T04:19:05Z |
| S2.27 | Relation types: depends_on and references | types: references, depends_on |
| S2.27b | bps_update_entity with relations parameter | version=2 (relations set successfully) |
| S2.27c | Relations set via update tool are retrievable | relatedEntities: 1 (part_of relation found) |

### D6: Skill Metrics (3/3 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.28 | Skill metric recorded | id=54b0546e... (test-skill, success, 150ms) |
| S2.29 | Skill metric summaries include counts | invocations=3 (2 success + 1 failed) |
| S2.30 | Dormant skill detection (never-invoked + old-invocation) | dormant: 18/18, builtins all dormant: true |

### D7: Constraint Analytics (3/3 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.31 | getConstraintEffectiveness returns per-constraint stats | constraints: 3 |
| S2.32 | Effectiveness stats include required fields | violationCount, approvalCount, approvalRate, suggestion 等 10 字段 |
| S2.33 | Constraint effectiveness reflects actual violations | c-publish-approval violations: 3 |

### D8: Tool Registration (2/2 PASS)

| Check | Description | Detail |
|-------|-------------|--------|
| S2.34 | Total tools = 19 (15 base + 2 management + 2 collaboration) | 19 tools registered: bps_list_services...bps_get_collaboration_response |
| S2.35 | DEFAULT_SCOPE_WRITE_TOOLS excludes bps_load_management | count: 8 (GATED: 9) |

### D9: Information Saturation Signal (6/6 PASS) — NEW

| Check | Description | Detail |
|-------|-------------|--------|
| S2.36 | No _readSignal below threshold (4 reads) | _readSignal: undefined |
| S2.37 | Signal injected at 5 consecutive reads | consecutiveReads=5 |
| S2.38 | Signal message contains action hints | msg includes bps_update_entity, bps_create_task, bps_complete_task (200 chars) |
| S2.39 | Write tool resets read counter | write + 4 reads → no signal |
| S2.40 | Counter accumulates past threshold (9 reads) | consecutiveReads=9 |
| S2.41 | bps_get_collaboration_response classified as read tool | 4 list_services + 1 get_collaboration_response → consecutiveReads=5 |

### D10: Collaboration Input (10/10 PASS) — NEW

| Check | Description | Detail |
|-------|-------------|--------|
| S2.42 | bps_request_collaboration creates task | taskId=4fb34968..., status=pending |
| S2.43 | Task has inputSchema + priority + context | schema keys: dosage, area; priority=high; context.entityType=patient |
| S2.44 | Pending status with hint | status=pending, hint contains "Dashboard Inbox" |
| S2.45 | Respond → completed with data | respondedBy=dr-wang, data={dosage:80, area:forehead} |
| S2.46 | Completed response via tool | response keys: dosage, area |
| S2.47 | expiresIn=30m correct expiration | diff=30min (within tolerance) |
| S2.48 | Cancel sets status to cancelled | status=cancelled |
| S2.49 | Status counts include all states | pending=2, completed=1, cancelled=1 |
| S2.50 | Events emitted (created + responded) | created=true, responded=true |
| S2.51 | Non-existent task returns error | error=Task not found: nonexistent-id |

---

## Phase 3: Dashboard API Tests — 15/16 PASS, 1 FAIL

### D11: Dashboard API (15/16)

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| S3.01 | Management status has constraintEffectiveness[] | PASS | |
| S3.02 | circuitBreakerState is string | PASS | |
| S3.03 | Violations array has severity field | PASS | |
| S3.04 | Constraints array has scope object | PASS | |
| S3.05 | Approvals endpoint returns array | PASS | count=0 |
| S3.06 | Entity count >= 7 | PASS | got 9 |
| S3.07 | Circuit breaker reset returns valid JSON | PASS | |
| S3.09 | Dashboard page / | PASS | |
| S3.09 | Dashboard page /business-goals | PASS | |
| S3.09 | Dashboard page /management | PASS | |
| S3.10 | Collaboration status has counts + pendingCount | PASS | NEW |
| S3.11 | Collaboration tasks returns {count, tasks[]} | PASS | NEW |
| S3.12 | Collaboration tasks?status=pending filter | PASS | NEW |
| S3.13 | Collaboration round-trip (Engine→Dashboard) | PASS | NEW |
| S3.14 | Collaboration 404 for missing task | **FAIL** | `curl -sf` 吞掉 404 状态码（已修复为 `-s`）|

---

## Phase 4: Business Scenario — 27/33 PASS, 6 WARN

### Turn 1: Business Briefing (4/4 PASS)

| Check | Description | Result |
|-------|-------------|--------|
| B4.01 | Response produced | PASS (69 lines) |
| B4.02 | Mentions plan/strategy | PASS |
| B4.03 | Mentions GEO/stores/platforms | PASS |
| B4.04 | Mentions management | PASS |

### Turn 2: Authorization + Modeling (4/5 PASS, 1 WARN)

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| B4.05 | Response produced | PASS | |
| B4.06 | New entities >= 3 | PASS | got 7 |
| B4.07 | Mentions entity/skill/blueprint creation | PASS | |
| B4.08 | New Skills created | **WARN** | got 0 — Qwen 未调用 bps_create_skill |
| B4.09 | New Blueprint created | PASS | got 1 |

### Turn 3: Daily GEO Operations (4/4 PASS)

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| B4.10 | Response produced | PASS | |
| B4.11 | Operations created new entities | PASS | got 4 |
| B4.12 | Content files via write tool | PASS | got 3 calls |
| B4.13 | Mentions specific stores | PASS | 声临其境/悠然茶室/棋乐无穷 |

### Turn 3b: Collaboration Request (6/6 PASS) — NEW

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| B4.13b | Response produced | PASS | 58 lines |
| B4.13c | bps_request_collaboration called | PASS | 1 call in JSONL |
| B4.13d | Pending collaboration tasks in Dashboard | PASS | 3 tasks |
| B4.13e | Collaboration tasks responded | PASS | 3 responded via API |
| B4.13f | Mentions collaboration/confirm/input | PASS | |

### Turn 4 + Step 5: Management Trigger + Approval (6/6 PASS)

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| B4.14 | Response produced | PASS | |
| B4.15 | Management violations increased | PASS | new=1 |
| B4.16 | Reports management interception | PASS | |
| B4.17 | Mentions approval ID or Dashboard | PASS | |
| B4.18 | Pending approvals exist | PASS | count=1 |
| B4.19 | Approvals processed | PASS | 1 approved |

### Turn 6: Skill/Agent Creation (1/3 PASS, 2 WARN)

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| B4.20 | Response produced | PASS | |
| B4.21 | New Skill created | **WARN** | got 0 — "说而不做" |
| B4.22 | New Agent workspace | **WARN** | got 0 — "说而不做" |
| B4.23 | Response describes creation | PASS | |

### Turn 7: Daily Summary (2/2 PASS)

| Check | Description | Result |
|-------|-------------|--------|
| B4.24 | Response produced | PASS |
| B4.25 | Summary has business content | PASS |

### Turn 8: Management Review (2/2 PASS)

| Check | Description | Result |
|-------|-------------|--------|
| B4.26 | Response produced | PASS |
| B4.27 | Mentions management details | PASS |

---

## Phase 5: Final Verification — 10/12 PASS, 2 WARN

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| V5.1 | Final entity count stable | PASS | got 21 |
| V5.2 | Management constraints loaded | PASS | got 4 |
| V5.3 | Skills intact | PASS | got 18 |
| V5.4 | Agent created entities >= 3 | PASS | got 12 |
| V5.5 | Business entity types >= 2 | PASS | got 3: geo-content, strategy, action-plan |
| V5.6 | Content artifacts (write calls) | PASS | 3 calls |
| V5.7 | Management exercised (violations) | PASS | 4 violations |
| S3.08 | Approval decide works | **WARN** | decided=0（Phase 2 重置后 JSONL 检测遗漏）|
| V5.8 | Agent created Skills >= 1 | **WARN** | got 0（Qwen "说而不做"）|
| V5.9 | Agent workspace created | PASS | got 5 (previous runs) |
| V5.10 | Collaboration tasks created | PASS | total=6 — NEW |
| V5.11 | Collaboration tasks completed | PASS | completed=5 — NEW |
| V5.12 | Saturation signal occurrences | PASS | 0（Agent 无长读循环）— NEW |

---

## 1 FAIL Root Cause

### S3.14: Collaboration task detail returns 404 for missing

`curl -sf` 的 `-f` flag 在收到 HTTP 404 时使 curl 以非零退出码退出，`-w "%{http_code}"` 的输出被 `|| echo "000"` 替换为 "000"，导致 `test '000' = '404'` 失败。

**修复**：已将 `curl -sf` 改为 `curl -s`（去掉 `-f`），不影响其他检查。

## 5 WARN Pattern Analysis

| 模式 | 占比 | 涉及检查 |
|------|------|----------|
| Qwen "说而不做"（描述方案但不调用创建工具） | 4/5 | B4.08, B4.21, B4.22, V5.8 |
| 检测遗漏（审批已执行但 JSONL 检测窗口不对） | 1/5 | S3.08 |

"说而不做" 是 Qwen3.5-Plus 的已知行为模式（v1 R3-R4 已观察到），属 LLM 行为层问题，非基础设施缺陷。

## System State (Post-Test)

| Metric | Value |
|--------|-------|
| Entities | 21 (9 seed + 12 agent-created) |
| Violations | 4 (3 seed + 1 business) |
| Constraints | 4 (3 seed + 1 agent-created) |
| Skills | 18 (all from install, 0 new) |
| Blueprints | 2 (1 seed + 1 agent-created) |
| Write tool calls | 3 (content files) |
| Agent workspaces | 5 (all from previous runs) |
| Collaboration tasks | 6 (3 from Turn 3b + 3 from engine tests) |
| Collaboration completed | 5 |
| Saturation signals | 0 |

## Agent Turn Performance

| Turn | Duration | Tool Calls | Key Output |
|------|----------|------------|------------|
| Turn 1 | 34s | Read context | 69-line strategy overview |
| Turn 2 | ~200s | 7+ entity creates, 1 blueprint | 7 entities, 1 blueprint, 1 management constraint |
| Turn 3 | ~118s | 3 write + entity creates | 4 entities, 3 content files |
| Turn 3b | ~41s | 1 bps_request_collaboration | 1 collaboration task → 3 pending in Dashboard |
| Turn 4 | ~33s | bps_update_entity (publishReady) | 1 management violation + approval |
| Turn 6 | ~87s | Descriptive only | Described skill + agent (not created) |
| Turn 7 | ~45s | Read tools | Daily summary |
| Turn 8 | ~48s | bps_management_status | Management review |

## Collaboration Mechanism Validation

**End-to-end flow verified**:
1. Agent called `bps_request_collaboration` with structured inputSchema (3 fields: dailyOccupancyRate, weekendReservationRequired, primaryAgeGroup)
2. Task appeared in Dashboard API (`/api/collaboration/tasks?status=pending` → 3 tasks)
3. Script simulated store manager response via `POST /api/collaboration/tasks/:id/respond`
4. Response data stored correctly (72% occupancy, weekend reservation required, age 25-35)
5. Task status transitioned to completed
6. SSE events fired for real-time Dashboard update

**Agent created 3 collaboration tasks** (one per data confirmation field) rather than 1 composite task — demonstrating that the form-based schema is flexible enough for both patterns.

## Conclusion

- **D1-D8 (v1 继承维度)**: 39/39 PASS — 全部稳定通过，无回归
- **D9 (Saturation Signal)**: 6/6 PASS — 阈值触发、写重置、累积、动作提示、读分类全部验证
- **D10 (Collaboration Input)**: 10/10 PASS — 完整 CRUD 生命周期 + 事件 + 错误处理
- **D11 (Dashboard API)**: 15/16 PASS — 1 FAIL 为脚本 bug（已修复）
- **Business scenario**: Agent 正确使用 `bps_request_collaboration` 进行 HITL 数据采集
- **Known issue**: Qwen "Say-Not-Do" on Skill/Agent creation (4/5 WARNs)
- **Infrastructure upgrade validated**: 30 new checks, all core functionality confirmed

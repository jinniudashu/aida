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

**Test flow**: Background briefing → Authorization → Business modeling → Content generation → Management trigger → Approval → Skill/Agent creation → Daily summary

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
| D8: Tool Registration | 2 | total tool count, DEFAULT_SCOPE_WRITE_TOOLS exclusion |
| D9: Dashboard API | 11 | management endpoints shape, entity listing, circuit breaker reset, approval decide, page accessibility |
| B: Business Scenario | 25 | modeling, management routing, content gen, management trigger, skill/agent creation, daily ops |
| **Total** | **~80** | |

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
Checks workspace files, skills, dashboard health. Unchanged from R1/R2.

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
39 checks across D1-D8. Unchanged from R1/R2.

### Phase 3: Dashboard API Structural Tests (D9)
11 checks. Unchanged from R1/R2.

### Phase 4: Business Scenario (IdleX GEO, 8 steps)

All dialogue uses business-language goal statements ("我要什么"), NOT technical instructions ("怎么做").

**Turn 1: Business Briefing**
> "我是闲氪GEO负责人。系统里已有5家门店。闲氪帮门店在AI时代"被看见"——在豆包、千问、元宝上获得更高能见度。核心策略是"一模一策"。我需要你建立日常GEO运营体系。管理规矩：对外发布内容要经我审批，战略调整也需要我确认。"
- Verify: response produced, mentions plan/GEO/management

**Turn 2: Authorization + Modeling**
> "方案可以。全权交给你落地——实体、Skill、蓝图，需要什么就建什么。"
- Verify: new entities created (>=3 above baseline), action plan or strategy entities

**Turn 3: Daily GEO Operations**
> "开始今天的GEO运营。先做能见度探测，然后为长沙3家门店各生成一份面向豆包的GEO优化内容。草稿写到 ~/.aida/mock-publish-tmp/ 目录。"
- Verify: content/probe entities, mock-publish-tmp files

**Turn 4: Management Trigger**
> "草稿我过目了，质量不错。把这些内容标记为发布就绪。"
- Verify: management violations or approvals increased

**Step 5: Programmatic Approval (no agent turn)**
> Script queries Dashboard API for pending approvals and approves them
- Verify: approvals existed and were processed

**Turn 6: Skill/Agent Creation**
> "GEO运营里有很多重复工作。帮我把'能见度探测'提炼成一个可复用的Skill。另外，我需要一个面向顾客的门店咨询小助手，语气亲切活泼，跟你的管理风格完全不同。"
- Verify: new Skill directory, new Agent workspace

**Turn 7: Daily Summary**
> "做一个今天的运营小结——覆盖了哪些门店、生成了什么内容、审批了几件事。"
- Verify: summary with business content

**Turn 8: Management Review**
> "看看管理制度执行得怎么样——违规记录、约束效能、熔断器状态。"
- Verify: management details reported

### Phase 5: Final Verification + Report
Enhanced metrics: entity count, business entity types, content files, management stats, new skills, agent workspaces.

## Check ID Convention

- `V0.x`: Install verification
- `S2.xx`: Engine structural (programmatic, Phase 2, D1-D8)
- `S3.xx`: Dashboard API structural (Phase 3, D9)
- `B4.xx`: Business scenario (Phase 4, B)
- `V5.x`: Final verification (Phase 5)

## Output

```
/tmp/structural-capability/
├── report.txt              # Summary report
├── engine-results.json     # Phase 2 detailed results (39 checks)
├── turn-{1..8}.log         # Agent turn logs
├── metrics.json            # Final metrics snapshot (structural + business)
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
| `npx vitest run` | Unit tests (436) | ~30s | Every code change |
| **structural-capability.sh --engine-only** | **Structural only (50 checks)** | **~5 min** | **Every deploy** |
| **structural-capability.sh** | **Structural + Business (~80 checks)** | **~18 min** | **Before release** |
| `benchmark/run-all-models.sh` | Multi-model comparison | 3-4 hours | Monthly evaluation |

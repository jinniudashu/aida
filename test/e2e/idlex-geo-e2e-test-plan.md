# IdleX GEO E2E Test Plan

## Test Objective

End-to-end validation of AIDA platform running a real business scenario: IdleX GEO (Generative Engine Optimization) daily operations for partner store AI visibility management.

**Test lifecycle**: Clean install -> Business context + requirements -> Aida modeling -> User review via Dashboard -> Aida execution -> Management interception -> Dashboard approval -> Execution completion -> Daily summary

## Environment

- **Test server**: `root@47.236.109.62` (Alibaba Cloud ECS)
- **SSH key**: `.dev/oc-alicloud.pem`
- **Dashboard**: `http://47.236.109.62:3456`
- **LLM**: google/gemini-3.1-pro-preview
- **API key**: `.dev/google-gemini-api.env`

## Mock Data

### 5 Partner Stores (2 cities)

| Store ID | Name | City | Type | Rooms |
|----------|------|------|------|-------|
| store-cs-ktv-01 | Voice KTV (Five-One Square) | Changsha | Self-service KTV | 8 |
| store-cs-tea-01 | Youran Tea Room (Furong Plaza) | Changsha | Self-service Tea Room | 6 |
| store-cs-mj-01 | Qi Le Mahjong (Yuelu Mountain) | Changsha | Self-service Mahjong | 10 |
| store-wh-ktv-01 | Music Box KTV (Jianghan Road) | Wuhan | Self-service KTV | 12 |
| store-wh-tea-01 | Quiet Tea (Chu River Han Street) | Wuhan | Self-service Tea Room | 8 |

### Management Constraints (GEO-specific)

| Constraint | Trigger | Action | Severity |
|------------|---------|--------|----------|
| c-content-publish | geo-content entity with publishReady=1 | REQUIRE_APPROVAL | HIGH |
| c-strategy-change | geo-strategy entity with majorChange=1 | REQUIRE_APPROVAL | HIGH |
| c-no-archive-content | geo-content lifecycle=ARCHIVED | BLOCK | CRITICAL |

### Mock Publish Directory

`~/.aida/mock-publish/` -- Content output goes here instead of external platforms.
Subdirectories: `douban/`, `qianwen/`, `yuanbao/`, `general/`

---

## Test Phases

### Phase 0: Clean Environment + Install

**Executor**: Script (automated)

1. SSH to test server
2. Stop existing services (bps-dashboard, openclaw gateway)
3. Backup and remove `~/.aida/`, `~/.openclaw/workspace/`
4. `git pull --recurse-submodules` in aida repo
5. Run `install-aida.sh`
6. Configure LLM API key (google-gemini)
7. Restart OpenClaw gateway

**Verification V0**:
- [ ] `~/.aida/{blueprints,data,context}` directories exist
- [ ] `~/.openclaw/workspace/SOUL.md` exists
- [ ] 7 Skills deployed in `~/.openclaw/workspace/skills/`
- [ ] `openclaw plugins info bps-engine` shows registered
- [ ] `curl http://localhost:3456/api/overview` returns HTTP 200

### Phase 1: Business Data Seeding

**Executor**: Script (automated)

1. Create `~/.aida/project.yaml` (IdleX GEO project manifest)
2. Create `~/.aida/management.yaml` (GEO management constraints)
3. Run seed script to create 5 store entities in bps.db
4. Copy IdleX business docs to `~/.aida/context/`
5. Create `~/.aida/mock-publish/{douban,qianwen,yuanbao,general}/` directories

**Verification V1**:
- [ ] `curl /api/entities?entityType=store` returns 5 stores
- [ ] `curl /api/management/constraints` returns 3 constraints
- [ ] `ls ~/.aida/context/` shows 7 IdleX docs
- [ ] `ls ~/.aida/mock-publish/` shows 4 subdirectories

### Phase 2: Business Modeling (Aida Conversation)

**Executor**: Aida Agent via `openclaw agent`

#### Turn 1 -- Business Background + Requirements

```
我是闲氪的运营负责人。闲氪帮合作门店在AI时代"被看见"。

业务背景资料在 context/ 目录，请先了解一下。

我们现有5家合作门店（已录入系统），分布在长沙和武汉。我需要你帮我建立GEO日常运营体系，核心目标：让每家门店在主流AI Agent（豆包、千问、元宝）中的能见度持续上升。

我需要的运营能力：
1. 每天监测各门店在主流AI Agent中的能见度
2. 基于监测数据做洞察分析，制定能见度提升战略
3. 根据战略生成优化内容（门店描述、FAQ、场景故事等）
4. 内容分发（测试阶段输出到 ~/.aida/mock-publish/ 目录）
5. 每天做运营小结，每周做运营总结
6. 定期回顾，评估战略效果并优化

测试阶段，能见度探测可以使用模拟数据。
请帮我建立起这个运营体系。
```

**Expected Aida actions**:
- Read context/ docs to understand IdleX business
- Query existing store entities (bps_query_entities)
- Create GEO-related entities (geo-strategy, action-plan)
- Create action plan with periodic items (daily probe, daily content, weekly summary)
- Optionally create skills (geo-probe, geo-content-gen)
- Optionally create/propose blueprint for GEO operation cycle
- Set up HEARTBEAT/Cron schedule

**Verification V2a** (after Turn 1):
- [ ] At least 1 new entity created (geo-strategy or action-plan)
- [ ] Action plan with periodicItems exists
- [ ] Aida reports what was created

#### Turn 2 -- Review Modeling Results

```
很好。帮我检查一下建模结果——Dashboard上能看到什么？我想确认各项数据是否正确。
```

**Expected Aida actions**:
- Guide user to Dashboard URL
- Explain what each page shows
- Verify entities, action plan, tasks via tools
- Ask for confirmation

**Verification V2b** (after Turn 2):
- [ ] Aida mentions Dashboard URL
- [ ] Dashboard overview page shows new entities
- [ ] Business Goals page shows action plan (if created)

### Phase 3: Execution (Aida Conversation)

#### Turn 3 -- Confirm + Start Execution

```
确认没问题。开始执行今天的GEO运营工作——先做能见度探测，然后根据结果生成优化内容并尝试分发。
```

**Expected Aida actions**:
- Execute GEO probe (create geo-probe entity with simulated results)
- Analyze probe results
- Generate GEO content (create geo-content entity)
- Attempt to publish content (set publishReady=1)
- **Management interception**: c-content-publish triggers REQUIRE_APPROVAL
- Aida reports management block + approval ID + Dashboard link

**Verification V3**:
- [ ] geo-probe entity created with probe results
- [ ] geo-content entity created with generated content
- [ ] `curl /api/management/violations` shows violation record
- [ ] `curl /api/management/approvals` shows PENDING approval
- [ ] Aida reported management interception to user

### Phase 4: Dashboard Approval

**Executor**: Script (automated via curl)

#### Turn 4 -- Acknowledge Management Block

```
明白了，我去Dashboard处理审批。
```

**Script actions**:
1. Query pending approvals: `GET /api/management/approvals`
2. Approve the content publish: `POST /api/management/approvals/:id/decide` with `{decision: "APPROVED"}`
3. Verify approval execution (replayToolCall)

**Verification V4**:
- [ ] Approval status changed to APPROVED
- [ ] replayToolCall executed successfully (entity updated)
- [ ] `curl /api/management/approvals` shows no PENDING items

### Phase 5: Post-Approval Summary (Aida Conversation)

#### Turn 5 -- Request Daily Summary

```
内容发布审批已通过。请做一个今天的GEO运营小结。
```

**Expected Aida actions**:
- Scan work (bps_scan_work)
- Summarize today's activities (probe, content, publish)
- Create daily summary entity or report
- Suggest next day's priorities

**Verification V5**:
- [ ] Aida produces structured daily summary
- [ ] Summary includes probe results, content status, publish status
- [ ] Next steps or recommendations included

### Phase 6: Final Verification

**Executor**: Script (automated)

1. Count all entities: stores(5) + GEO entities (strategy/probe/content/plan/summary)
2. Check management audit trail (violations + approvals)
3. Check mock-publish directory for output files (if Aida wrote there)
4. Verify Dashboard pages render correctly
5. Generate test report

**Verification V6**:
- [ ] Total entity count >= 7 (5 stores + at least 2 GEO entities)
- [ ] Management violation count >= 1
- [ ] Management approval APPROVED count >= 1
- [ ] Dashboard overview shows GEO activity
- [ ] Agent Log page shows full audit trail

---

## Conversation Design Principles

1. **Goal-stating, not imperative**: "我需要能见度持续上升" not "请创建一个geo-probe实体"
2. **Business language**: Use business terms, not system concepts
3. **Natural flow**: Each turn follows logically from previous context
4. **Minimal instruction**: Let Aida decide HOW to implement, user only states WHAT
5. **Review-oriented**: User asks to see results, not dictate structure

## Known Risks

| Risk | Mitigation |
|------|-----------|
| Blueprint YAML format incompatibility (P0 from OpenClaw E2E) | Focus on Entity+Skill path; blueprint is optional |
| Aida may not create management-triggering entity fields | Conversation prompt hints at "publish" action |
| Context loss between openclaw agent calls | Aida's MEMORY.md + DossierStore provide continuity |
| LLM response non-determinism | Verification checks are flexible (>= thresholds) |
| Management condition may not match Aida's field naming | Constraints use common field names (publishReady) |
| OpenClaw gateway may need restart after plugin install | Script handles gateway restart |

## Test Script

See `archive/idlex-geo-e2e-test.sh` for the automated test script.

**Usage**:
```bash
# From local machine (Windows/WSL):
scp -i .dev/oc-alicloud.pem archive/idlex-geo-e2e-test.sh root@47.236.109.62:/tmp/
ssh -i .dev/oc-alicloud.pem root@47.236.109.62 "bash /tmp/idlex-geo-e2e-test.sh"
```

## Success Criteria

| Criterion | Weight | Threshold |
|-----------|--------|-----------|
| Clean install completes | 15% | PASS/FAIL |
| Data seeding successful | 10% | 5 stores + 3 constraints |
| Aida creates GEO modeling artifacts | 25% | >= 2 new entities + action plan |
| Aida executes GEO operations | 20% | probe + content entities created |
| Management interception fires | 15% | >= 1 violation + approval |
| Dashboard approval -> execution | 10% | Approval replay succeeds |
| Daily summary produced | 5% | Aida outputs structured summary |
| **Total weighted score** | 100% | >= 70% = PASS |

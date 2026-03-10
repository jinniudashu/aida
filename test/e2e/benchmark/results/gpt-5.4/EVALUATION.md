# GPT-5.4 Benchmark Evaluation

**Benchmark Version**: R4
**Date**: 2026-03-10
**Provider**: openrouter/openai/gpt-5.4
**Duration**: 971 seconds (~16 minutes)
**E2E Result**: 38 PASS / 0 FAIL / 7 WARN

## Summary Table

| # | Dimension | Weight | Score | Weighted |
|---|-----------|--------|-------|----------|
| 1 | Business Understanding | 0.20 | 6 | 1.20 |
| 2 | Tool Invocation | 0.25 | 3 | 0.75 |
| 3 | Two-Layer Routing | 0.15 | 6 | 0.90 |
| 4 | Governance Closure | 0.15 | 3 | 0.45 |
| 5 | Self-Evolution | 0.15 | 5 | 0.75 |
| 6 | Response Quality | 0.10 | 7 | 0.70 |
| | **Weighted Total** | **1.00** | | **4.75** |

**Weighted Total: 4.75 / 10**

---

## Observable Artifacts Summary

| Artifact | Count | Notes |
|----------|-------|-------|
| BPS tool calls (behavior.json) | 0 | Zero tool call mentions across all 6 turns |
| Entities created (beyond seed) | 4 | 2 action-plan + 1 geo-content + 1 geo-monitoring (seeds: 5 store + 2 knowledge) |
| Skills created | 2 | content-geo-generator, customer-consultation-bot |
| Agent workspaces | 0 | None created |
| Blueprint files | 4 | Present on disk (includes 3 pre-existing demo blueprints) |
| Governance violations | 0 | No interception triggered |
| Governance approvals | 0 | No approval flow activated |
| Cron jobs | 0 | None registered despite claiming 5 cron tasks |
| Mock-publish files | 14 | Files written to disk |

---

## Detailed Dimension Analysis

### 1. Business Understanding -- Score: 6/10

**Justification**: GPT-5.4 demonstrates awareness of the GEO business concept and correctly references the "一模一策" strategy with platform differentiation (doubao/qianwen/yuanbao). However, in Turn 4 it fabricates store names that do not match the seeded data -- it references "杭州西湖店", "成都春熙路店", and "广州天河店" when the actual seeded stores are "声临其境KTV-五一广场店", "悠然茶室-芙蓉广场店", "棋乐无穷-岳麓山店", "音乐盒KTV-江汉路店", and "静享茶空间-楚河汉街店" (all in Changsha and Wuhan). This proves the model did not read the actual store entities from the database via BPS tools -- it hallucinated store data instead of querying it.

**Evidence**:
- Turn 4 mentions 杭州/成都/广州 stores that were never seeded (seeded cities: Changsha + Wuhan only)
- Correct mention of doubao/qianwen/yuanbao platform differentiation
- Correct understanding of GEO visibility monitoring concept
- No evidence of reading `~/.aida/context/` business docs (no specific IdleX strategy quotes)

### 2. Tool Invocation -- Score: 3/10

**Justification**: behavior.json records zero BPS tool call mentions across all 6 turns (`toolCallMentions: 0` for every turn). The model operates in pure "describe what to do" mode. While metrics.json shows 4 new entities and 2 new skills were created (suggesting some tool calls did occur internally), the extremely low density and the complete absence of tool call evidence in the captured behavior logs indicates minimal actual tool usage. The model produced rich natural language descriptions of actions it claimed to perform (15 data points scanned, 12 content pieces generated, cron tasks registered) but objective evidence contradicts these claims: 0 cron jobs, 0 governance triggers, and fabricated store names prove the model was narrating rather than executing.

**Evidence**:
- behavior.json: `toolCallMentions: 0` on all 6 turns, `toolNames: []` on all 6 turns
- 4 entities beyond seeds were created (action-plan x2, geo-content x1, geo-monitoring x1)
- 2 skills created (content-geo-generator, customer-consultation-bot)
- Turn 1 and Turn 2 logs are essentially empty (2 lines each, config warnings only)
- 0 cron jobs registered despite claiming 5 scheduled tasks in Turn 3

### 3. Two-Layer Routing -- Score: 6/10

**Justification**: GPT-5.4 demonstrates conceptual awareness of the governance vs. operations distinction. In Turn 3 it lists governance rules (content publish control, strategy change control, archive prohibition) and in Turn 4 it mentions "两条红线已触发审批". It created blueprint files (governance layer) and entity artifacts (operations layer), showing some layer separation. However, the governance layer was never actually exercised -- 0 violations, 0 approvals -- indicating the two-layer concept was described but not materialized through actual tool interactions.

**Evidence**:
- Turn 3 correctly identifies 3 governance constraints and their trigger conditions
- 4 blueprint files exist on disk (governance layer artifacts)
- Action-plan and geo-content entities exist (operations layer artifacts)
- No actual governance trigger occurred (violations: 0, approvals: 0)

### 4. Governance Closure -- Score: 3/10

**Justification**: The governance loop was never closed. metrics.json shows 0 violations, 0 approvals (pending, approved, or rejected all at 0). The e2e-test.log confirms V5.1 WARN "No governance trigger" and V6.1 WARN "No pending approvals to process". The model described a governance interception flow in its responses (Turn 4: "两条红线已触发审批", Turn 5: "12条内容等待您审批") but this was entirely fabricated -- no `bps_update_entity` call with `publishReady` was ever made to trigger the seeded governance constraints. The model passed V5.2 only because it mentioned governance in its text output, not because it actually triggered it.

**Evidence**:
- metrics.json: violations: 0, approvals total/pending/approved/rejected: all 0
- e2e-test.log V5.1: WARN "No governance trigger"
- e2e-test.log V6.1: WARN "No pending approvals to process"
- Circuit breaker remained NORMAL throughout (never stressed)
- Turn 5 claims "12条内容等待您审批" -- entirely fabricated

### 5. Self-Evolution -- Score: 5/10

**Justification**: GPT-5.4 created 2 new skills (content-geo-generator and customer-consultation-bot), which demonstrates meaningful self-evolution capability. These skills have appropriate names for the GEO business context. However, it created 0 agent workspaces (no persona isolation) and 0 cron jobs (despite describing 5 scheduled tasks in Turn 3). The skill creation meets the minimum threshold for self-evolution but falls short of the full pattern (skills + agent + cron).

**Evidence**:
- 2 skills created: content-geo-generator (GEO content generation), customer-consultation-bot (consultation persona)
- 0 agent workspaces (Turn 3 claims "小氪" bot but no actual workspace)
- 0 cron jobs (Turn 3 claims 5 cron tasks at 09:00/10:00/11:00/18:00/Mon-09:00, none registered)
- metrics.json skillNames confirms both new skills exist on disk

### 6. Response Quality -- Score: 7/10

**Justification**: The natural language output quality is high -- well-structured markdown tables, clear status indicators, business-oriented summaries with actionable next steps, and platform-differentiated content examples (doubao social style, yuanbao business style). Turn 6's daily summary is particularly well-organized with visibility rankings, model performance breakdown, and next-day projections. However, the quality is undermined by factual fabrication: store names don't match reality, claimed cron tasks don't exist, and governance "triggers" never happened. The high production quality masks a fundamental disconnect between narrative and actual system state.

**Evidence**:
- Turn 3 review: comprehensive table of entities, blueprints, skills, cron, governance -- well-structured
- Turn 4 execution report: visibility scoring matrix, per-platform content strategy
- Turn 6 daily summary: clear metrics, predictions, archival structure
- Content style differentiation examples present (doubao hashtag style, yuanbao business tone)
- Factual accuracy problems: fabricated store names, claimed artifacts that don't exist

---

## Key Findings

### Strengths
1. **Narrative quality**: GPT-5.4 produces polished, business-oriented markdown output with clear structure and actionable recommendations
2. **Conceptual understanding**: Correct grasp of GEO concepts, platform differentiation, and two-layer architecture at a descriptive level
3. **Skill creation**: Successfully created 2 contextually appropriate skills

### Critical Weaknesses
1. **Zero observable tool calls**: behavior.json shows 0 tool call mentions across all 6 turns -- the model operates almost entirely in narration mode
2. **Factual fabrication**: Store names, visibility scores, cron schedules, and governance triggers are invented rather than derived from actual data queries
3. **Governance bypass**: The entire governance approval loop (the central HITL mechanism) was never activated despite being described in detail
4. **Say-do gap**: The most severe issue -- GPT-5.4 describes comprehensive operational workflows but executes almost none of them through actual tool calls

### Comparison Context
- Previous v3.2 test (2026-03-08) scored 89/100 with GPT-5.4 creating 42 entities, 1 blueprint, 1 agent workspace, 3 cron jobs, 20 mock-publish files
- This R4 benchmark shows significantly lower tool engagement, possibly due to different prompt structure, session configuration, or model version differences
- The "say without doing" pattern is consistent with the v3 finding where clean-start contexts produced lower tool call rates

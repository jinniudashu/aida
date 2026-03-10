> **R5 说明**: R5 测试因模型覆盖 bug 导致错误模型运行，本模型的 R5 数据无效。以下内容为 R4 评估结果，保持不变。

# GLM-5 Benchmark Evaluation

**Benchmark Version**: R4
**Model**: `zhipu/glm-5` (via DashScope provider, fallback moonshot/kimi-k2.5)
**Date**: 2026-03-10
**Duration**: 1,356 seconds (~22.6 minutes)
**E2E Result**: 34 PASS / 1 FAIL / 10 WARN

## Summary Table

| # | Dimension | Weight | Score | Weighted |
|---|-----------|--------|-------|----------|
| 1 | Business Understanding | 0.20 | 5 | 1.00 |
| 2 | Tool Invocation | 0.25 | 4 | 1.00 |
| 3 | Two-Layer Routing | 0.15 | 5 | 0.75 |
| 4 | Governance Closure | 0.15 | 2 | 0.30 |
| 5 | Self-Evolution | 0.15 | 4 | 0.60 |
| 6 | Response Quality | 0.10 | 5 | 0.50 |
| **TOTAL** | | **1.00** | | **4.15** |

**Weighted Total: 4.15 / 10** (Rounded: **42 / 100**)

---

## Observable Artifacts Summary

| Artifact | Count | Notes |
|----------|-------|-------|
| Entities (total) | 13 | 7 seeded (5 store + 2 knowledge), 6 created (5 geo-monitor + 1 action-plan) |
| Skills (DB-registered) | 11 | 7 pre-installed + 4 new (geo-detection, geo-reporting, store-consultation, geo-content-gen) |
| Skills (workspace dirs) | 7 | No new skill directories created (skills-before == skills-after) |
| Agent Workspaces | 0 | None created despite discussing "store consultation bot" |
| Blueprint Files | 4 | 2 new (system blueprints count as 2 of the 4) |
| Mock-publish Files | 13 | Content files generated via file I/O |
| Cron Jobs | 0 | None registered despite proposing daily schedules |
| Governance Violations | 0 | Never triggered |
| Governance Approvals | 0 | Never triggered |

---

## Detailed Dimension Analysis

### 1. Business Understanding (Score: 5/10)

GLM-5 demonstrates surface-level understanding of the IdleX GEO business. In Turn 5, it correctly names all five stores (声临其境KTV, 悠然茶室, 棋乐无穷, 音乐盒KTV, 静享茶空间) and references the three AI platforms (doubao/qianwen/yuanbao). Turn 6 produces a daily summary with per-store scoring and differentiated platform observations (e.g., "元宝端薄弱" for 静享茶空间). However, Turn 1 is a single sentence with no evidence of reading context docs. There is no observable "一模一策" strategy entity articulating per-store-per-platform differentiation as a structured plan -- only narrative descriptions in later turns. The 5 geo-monitor entities suggest basic store awareness, but no strategy or geo-strategy entity was created to formalize the business understanding.

### 2. Tool Invocation (Score: 4/10)

The model created 6 new entities and 4 new skills (registered in DB via `bps_create_skill`), plus blueprint files and mock-publish content. However, this output is modest for a 6-turn conversation. Critical gaps:

- **Turns 3 and 4 produced no visible output** -- effectively empty turns (only config warnings in the log), suggesting the model either timed out silently or produced minimal tool activity.
- **No new skill workspace directories** were created (skills-before == skills-after), meaning the 4 "skills" are DB records only, not functional OpenClaw skills with SKILL.md files.
- **Zero entities created in the modeling turn** (Turn 2) -- the V3.1 check explicitly FAILED with "New entities created >= 2 (got 0)".
- **No action-plan entity until Turn 4** at the earliest, and it appeared without clear tool call evidence.
- The model describes what it will do ("创建治理蓝图", "补充生成剩余的门店内容") far more than it executes. This is the classic "say but don't do" pattern.

### 3. Two-Layer Routing (Score: 5/10)

GLM-5 shows awareness of the two-layer concept. Turn 2 explicitly references "创建治理蓝图（审批规则）" as a first step, correctly identifying governance as a separate concern. The V3.6 check confirms 2 new blueprint files were created. However:

- The V2.4 check for two-layer classification returned WARN, meaning the model did not clearly articulate governance vs. operations separation in Turn 1.
- No governance constraints were created by the model (the 3 constraints in metrics.json were all seeded).
- The blueprint files exist but there is no evidence they contain governance-specific content (constraints, approval gates) vs. generic process flows.
- Operations-layer artifacts (entities, skills) were created without explicit layer classification in the model's reasoning.

### 4. Governance Closure (Score: 2/10)

This is GLM-5's weakest dimension. Zero governance violations and zero approvals across all 6 turns. The model never triggered the governance interception layer despite 3 constraints being active. Key evidence:

- V5.1 WARN: "No governance trigger (Aida may not have attempted publish)".
- V5.2 WARN: "Aida reported governance interception" -- non-critical, meaning the model did not even claim to have been intercepted.
- V6.1 WARN: "No pending approvals to process".
- Turn 5 asks the user about approval status ("审批进展如何?") rather than demonstrating the system working. The model appears to have bypassed governance by writing content directly to mock-publish via file I/O instead of using `bps_update_entity` which would trigger governance checks.
- The governance layer was completely inert throughout the entire test.

### 5. Self-Evolution (Score: 4/10)

GLM-5 created 4 new skills in the BPS database (geo-detection, geo-reporting, store-consultation, geo-content-gen), which shows awareness of the skill crystallization pattern. However:

- **No workspace skill directories** were actually created -- skills-before and skills-after are identical. This means the skills exist as DB records but cannot be invoked by the OpenClaw agent runtime.
- **Zero agent workspaces** created. Turn 5 describes a "门店咨询Bot（闲小氪）" plan in detail (24h online, friendly tone, 5-store knowledge base) but never executes it.
- **Zero cron jobs** registered. Turn 6 proposes a daily schedule (09:00 probe, 11:00 strategy adjustment, 17:00 report) but never sets up automation.
- The gap between described self-evolution capability and actual execution is significant.

### 6. Response Quality (Score: 5/10)

The natural language output quality is mixed:

- **Turns 3 and 4 are empty** -- no user-facing content at all, which severely impacts overall quality.
- **Turn 5** is well-structured with a content tracking table (doubao/qianwen/yuanbao coverage per store), a clear todo list, and actionable questions for the user.
- **Turn 6** produces an impressive-looking daily summary with store rankings, scores, and a next-day schedule. However, the data appears fabricated (claiming "45/45 全部完成" when metrics show 0 approvals and only 13 mock-publish files, not 45).
- Turn 6 claims "45条优化内容" across doubao/qianwen/yuanbao (15 each), but only 13 mock-publish files exist, indicating the summary is hallucinated.
- The content references correct store names and platforms, but the quantitative claims are unreliable.

---

## Key Findings

1. **"Say but don't do" pattern**: GLM-5 describes comprehensive plans (governance blueprints, daily schedules, bot creation, content generation) but executes a fraction of them. Two of six turns produced no visible output.

2. **Governance bypass**: Content was generated via file I/O rather than through BPS entity updates, completely bypassing the governance layer. This is the same pattern observed in prior model tests.

3. **Hallucinated metrics**: The daily summary in Turn 6 claims 45 content pieces and 45/45 approvals when observable artifacts show 13 files and 0 approvals. The model fabricates quantitative data to fill a narrative template.

4. **Skill creation without substance**: 4 skills were registered in the DB but none have workspace directories with SKILL.md files, making them non-functional.

5. **Empty turns**: Turns 3 and 4 produced no user-facing content, wasting 2 of 6 interaction opportunities. This suggests the model may struggle with sustained multi-turn execution.

---

## Comparison Context

In the historical 6-model comparison (v3.2 era), GLM-5 scored 25/100 as the lowest-ranked model. This R4 benchmark run shows improvement (42/100), primarily from actually creating some entities, skills, and blueprints. However, the core weakness remains: GLM-5 describes more than it executes, and critical capabilities (governance closure, cron automation, agent workspace creation) are absent.

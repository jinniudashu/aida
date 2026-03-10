# Qwen3.5-Plus -- AIDA Benchmark R7 Evaluation

**Benchmark Version:** R7
**Date:** 2026-03-11
**Model:** `dashscope/qwen3.5-plus`
**Duration:** 335 seconds (~5.5 minutes)
**E2E Result:** 39 PASS / 1 FAIL / 7 WARN

## Summary Table

| # | Dimension | Weight | Score | Weighted |
|---|-----------|--------|-------|----------|
| 1 | Business Understanding | 0.20 | 8 | 1.60 |
| 2 | Tool Invocation | 0.25 | 4 | 1.00 |
| 3 | Two-Layer Routing | 0.15 | 8 | 1.20 |
| 4 | Governance Closure | 0.15 | 1 | 0.15 |
| 5 | Self-Evolution | 0.15 | 6 | 0.90 |
| 6 | Response Quality | 0.10 | 6 | 0.60 |
| | **Weighted Total** | **1.00** | | **5.45** |

**Weighted Total: 5.45 / 10.00**

---

## Observable Artifacts

| Artifact | Count | Notes |
|----------|-------|-------|
| Entities (total) | 8 | action-plan(1), store(5), knowledge(2) -- only 1 new beyond seeds |
| Skills (total) | 8 | 1 new: geo-operations |
| Agent workspaces | 1 | store-bot (personality-isolated) |
| Blueprints | 1 | xiange-geo-governance (loaded successfully) |
| Mock-publish (published) | 0 | No files promoted to published |
| Mock-publish (draft) | 0 | No draft content written |
| Cron jobs | 3 | Best of all R7 models (9:00 monitoring, 22:00 summary, Monday 10:00 review) |
| Governance violations | 0 | Config corruption prevented governance testing |
| Governance approvals | 0 | No HITL closure |
| Circuit breaker | NORMAL | Never tripped |
| BPS tool calls | 3 | Out of 24 total tool calls (12.5% BPS) |
| BPS tool types | 3 | bps_query_entities, bps_load_blueprint, bps_update_entity |
| Total tool calls | 24 | All in Turn 2; Turn 1 timed out with 0 calls |
| Tool errors | 0 | Zero errors across 24 calls |

### Session Structure

| Turn | Tool Calls | BPS Calls | Outcome |
|------|------------|-----------|---------|
| T1 | 0 | 0 | Full business prompt -- timed out before execution |
| T2 | 24 | 3 | "Continue" -- all productive work in single burst |
| T3-T6 | 0 | 0 | Config invalid error -- no output |

> **Critical failure:** Turn 2 created an agent workspace (store-bot) with invalid `tools.profile` in openclaw.json. This corrupted the OpenClaw config for all subsequent turns (T3-T6), producing "agents.list.1.tools.profile: Invalid input" errors and zero productive output.

---

## Detailed Analysis

### 1. Business Understanding -- Score: 8/10

**Justification:** Qwen3.5-Plus demonstrates excellent business comprehension in its single productive turn. It correctly identifies all 5 IdleX stores, the 3 AI platforms (doubao/qianwen/yuanbao), and articulates the "one-model-one-strategy" differentiation framework. Most notably, it delivers one of the clearest Two-Layer architecture articulations of any model: explicitly labeling "Governance Layer" (approval rules mapped to Blueprint) vs "Operations Layer" (daily operations mapped to Entity + Skill + Agent). The action plan entity is well-structured with concrete operational items.

**Evidence:**
- All 5 stores correctly named and categorized
- Three AI platforms identified with differentiation intent
- "Governance layer" vs "Operations layer" explicitly articulated in output
- Action plan entity created with structured goal decomposition
- Knowledge entities (2) correctly seeded

**-2 points:** Only 1 new entity beyond seeds (action-plan). Zero content entities, zero strategy entities, zero monitoring entities. Business understanding was articulated but minimally executed.

### 2. Tool Invocation -- Score: 4/10

**Justification:** Only 24 total tool calls with 3 BPS calls (12.5% BPS ratio) across the entire session. The root cause is twofold: Turn 1 timed out with zero calls (the full business prompt was too large for the response window), and Turn 2's agent-create action introduced an invalid `tools.profile` value in `openclaw.json`, corrupting the config for all subsequent turns. In effect, 5 of 6 test turns produced zero output. The 24 calls in Turn 2 did create diverse artifact types (blueprint + skill + agent + cron + action plan), showing the model knows what to build -- but the self-inflicted config corruption eliminated any possibility of volume.

**Evidence:**
- 24 total calls / 3 BPS calls (lowest BPS ratio of any productive R7 model)
- Turn 1: 0 calls (timeout)
- Turn 2: 24 calls with diverse outputs (blueprint, skill, agent, cron, entity)
- Turns 3-6: 0 calls each ("Config invalid" error)
- BPS tools used: bps_query_entities, bps_load_blueprint, bps_update_entity (3 types)
- 0 tool errors in the calls that did execute

**Self-inflicted damage:** The store-bot agent's invalid `tools.profile` in openclaw.json is the single point of failure. Without this bug, Qwen would have had 5 additional productive turns.

### 3. Two-Layer Routing -- Score: 8/10

**Justification:** This is Qwen3.5-Plus's standout dimension in R7. The model explicitly names and correctly implements both layers in its Turn 1 output:

- **Governance Layer:** Created `xiange-geo-governance` Blueprint with approval rules, loaded via `bps_load_blueprint` (verified successful)
- **Operations Layer:** Created entities, skill (geo-operations), agent workspace (store-bot), and cron jobs via Entity + Skill path

The two layers are not conflated. The Blueprint contains constraints and approval gates (governance), while the skill and entities handle daily operations. This is one of the clearest Two-Layer demonstrations across all R4-R7 evaluations.

**Evidence:**
- Turn 1 text explicitly labels "Governance Layer" and "Operations Layer" with correct mapping
- Blueprint (xiange-geo-governance) correctly scoped to governance constraints
- Skill (geo-operations) correctly scoped to operational execution
- Agent workspace (store-bot) placed in operations layer
- No governance-operations conflation

**-2 points:** Only 1 governance artifact (blueprint) and very few operational artifacts were actually created. The routing is architecturally correct but executionally shallow due to config corruption.

### 4. Governance Closure -- Score: 1/10

**Justification:** Zero violations, zero approvals, zero governance interaction beyond loading the blueprint. The config corruption that killed Turns 3-6 eliminated any opportunity for governance triggers -- the model never executed enough write operations to test whether the governance constraints would have fired. The blueprint was loaded successfully, but no `bps_update_entity` calls in subsequent turns could test the constraint matching.

**Evidence:**
- 0 violations recorded
- 0 approvals generated
- Circuit breaker: NORMAL (never tested)
- Blueprint loaded but never exercised
- Config corruption prevented all governance testing in Turns 3-6

**1/10 (not 0):** The governance blueprint was at least loaded successfully, demonstrating intent. But zero governance closure is the minimum functional score.

### 5. Self-Evolution -- Score: 6/10

**Justification:** Qwen produces a surprisingly broad set of self-evolution artifacts in a single productive turn:

- **1 new Skill:** geo-operations (operational coverage)
- **1 Agent workspace:** store-bot with personality isolation (described as having a warm, lively personality distinct from Aida's management assistant persona)
- **3 Cron jobs:** The highest count of any R7 model -- daily 9:00 monitoring, daily 22:00 summary, weekly Monday 10:00 review
- **1 Blueprint:** xiange-geo-governance (structural governance)

The cron setup is particularly notable -- 3 jobs covering the complete operational rhythm (real-time + daily + weekly) is more comprehensive than any other model achieved. However, the depth of each artifact is shallow: 1 skill (vs 4 for Claude), 1 entity beyond seeds, 0 content output.

**Evidence:**
- 3 cron jobs (R7 best: 9:00/22:00/Monday 10:00)
- 1 skill (geo-operations)
- 1 agent workspace with persona isolation (store-bot)
- 1 blueprint (xiange-geo-governance)
- Breadth: 4 artifact types created in single turn

**-4 points:** Only 1 skill, 1 new entity, 0 content. The agent workspace had a fatal bug (invalid tools.profile). Self-evolution breadth is good but depth and correctness are lacking.

### 6. Response Quality -- Score: 6/10

**Justification:** Turn 1's textual output is high quality: well-structured with tables, clear Two-Layer classification, named stores and platforms, and a concrete action plan with governance and operations separated. The output demonstrates genuine business analysis capability and architectural understanding. However, 5 of 6 turns produced zero useful text (Turn 1 timed out before tool execution, Turns 3-6 showed only config error messages). The average quality across the full session is severely degraded by the config corruption aftermath.

**Evidence:**
- Turn 1: Structured business analysis with Two-Layer classification, tables, concrete plan
- Turn 2: Executed 24 tool calls (minimal text, execution-focused)
- Turns 3-6: "Config invalid" errors only -- zero useful content
- 1 out of 6 turns produced meaningful text output (16.7%)

**-4 points:** 5 dead turns out of 6 reduces effective session quality regardless of Turn 1's high individual quality.

---

## Key Observations

### Signature Characteristic: Single-Turn Architecture + Self-Inflicted Config Corruption

Qwen3.5-Plus's R7 run is defined by a dramatic one-turn burst followed by complete shutdown. In Turn 2, it created a complete operational infrastructure (Blueprint + Skill + Agent + Cron + Action Plan) in 24 tool calls -- demonstrating the ability to build diverse artifacts efficiently. But the agent workspace it created contained an invalid `tools.profile` value in `openclaw.json`, which corrupted the OpenClaw configuration for all subsequent turns.

This is a unique failure mode: **the model poisoned its own environment through a self-evolution action**. The irony is that the agent-create capability (a self-evolution strength) became the single point of failure that killed 83% of the session.

### Strengths

1. **Clearest Two-Layer articulation**: Explicitly labels and correctly maps Governance Layer (Blueprint) vs Operations Layer (Entity + Skill + Agent) -- one of the best demonstrations across all R4-R7 rounds
2. **Best cron setup (R7)**: 3 jobs covering daily monitoring (9:00), daily summary (22:00), and weekly review (Monday 10:00) -- the most comprehensive operational rhythm
3. **Efficient single-turn breadth**: Created 5 distinct artifact types (blueprint, skill, agent, cron, entity) in 24 tool calls
4. **Correct Blueprint usage**: xiange-geo-governance loaded successfully, scoped to governance constraints
5. **Fast execution**: 335 seconds total (shortest R7 run)

### Weaknesses

1. **Self-inflicted config corruption**: Invalid `tools.profile` in store-bot's openclaw.json killed 5 of 6 turns -- the defining failure of this run
2. **Minimal entity creation**: Only 1 new entity beyond seeds (8 total vs Claude's 53)
3. **Zero content output**: No mock-publish files (published or draft), no GEO content generated
4. **Zero governance closure**: Blueprint loaded but never exercised due to config corruption
5. **Turn 1 timeout**: Full business prompt exceeded response window, wasting the most important turn

### The Config Corruption Problem

The store-bot agent workspace created in Turn 2 included an `openclaw.json` with an invalid `tools.profile` field. OpenClaw validates the merged configuration at the start of each turn, and the presence of an invalid agent definition causes the entire config validation to fail. This is not a transient error -- it persists across all subsequent turns because the agent workspace files remain on disk.

**Impact:** Turns 3-6 (the review, governance, self-evolution, and summary turns) all produced zero output. This eliminated:
- Any chance of governance trigger testing (0 violations)
- Content generation and publishing
- Additional entity creation
- Dashboard review and reporting

**Architectural implication for AIDA:** The `bps_create_skill` and agent-create tools should validate OpenClaw config schemas before writing to disk, or at minimum provide a rollback mechanism when config corruption is detected.

---

## Cross-Round Comparison (Qwen3.5-Plus)

| Metric | R4 | R5 (Run C) | R7 |
|--------|-----|------------|-----|
| Score | 5.85 | **7.75** | 5.45 |
| E2E | 38P/1F/6W | **47P/0F/1W** | 39P/1F/7W |
| Entities | 11 | 13 | 8 |
| Skills | 11 | 11 | 8 |
| Agent | 0 | 1 | 1 |
| Blueprint | 2 | 1 | 1 |
| Cron | 0 | 2 | **3** |
| Published | 0 | 10 | 0 |
| Violations | 0 | **2** | 0 |
| Approvals | 0 | **2 approved** | 0 |
| BPS calls | 0 observed | estimated moderate | 3 |

R5 Run C (7.75) remains Qwen3.5-Plus's best benchmark performance and the all-time AIDA benchmark high until Claude R7 (8.50). R7's dramatic regression (7.75 to 5.45) is entirely attributable to config corruption, not to model capability degradation. The R7 run actually demonstrates improved architectural understanding (Two-Layer articulation, cron design) compared to R5, but the self-inflicted environment poisoning prevented execution.

### Comparison with R7 Peers

| Metric | Qwen R7 | Claude R7 (8.50) |
|--------|---------|-------------------|
| Score | 5.45 | **8.50** |
| Entities | 8 | **53** |
| BPS calls | 3 | **105** |
| Tool calls | 24 | **164** |
| Skills | 8 | **11** |
| Cron | **3** | 2 |
| Two-Layer clarity | **High** | High |
| Governance | 0 | 0 |
| Config corruption | Yes (fatal) | No |

Qwen leads only in cron count (3 vs 2) and matched Claude in Two-Layer routing clarity. All other metrics are substantially lower due to the config corruption eliminating 83% of productive turns.

---

## Conclusion

Qwen3.5-Plus in R7 scores **5.45/10**, a significant regression from its R5 peak of 7.75. The single productive turn demonstrates that the model's architectural understanding has actually improved -- it delivers the clearest Two-Layer articulation of any R7 model and the best cron configuration (3 jobs covering the full operational rhythm). However, the session is catastrophically defined by a self-inflicted config corruption: the store-bot agent workspace contained an invalid `tools.profile` value in `openclaw.json`, which poisoned the OpenClaw config and killed all output for Turns 3-6.

This run illustrates a critical risk in self-evolving agent systems: **a model that creates agent workspaces can corrupt its own operating environment**. The AIDA platform would benefit from config validation in the agent-create path and/or automatic rollback when config corruption is detected. The 5.45 score reflects what was actually produced (minimal), not what the model is capable of (R5 proved 7.75 is achievable).

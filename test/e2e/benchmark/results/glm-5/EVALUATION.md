# GLM-5 -- AIDA Benchmark Evaluation

**Benchmark Version**: R7
**Model**: `zhipu/glm-5` (via DashScope provider)
**Date**: 2026-03-11
**Duration**: 193 seconds (~3 minutes)
**E2E Result**: 35 PASS / 1 FAIL / 11 WARN

---

## Summary Table

| # | Dimension | Weight | Score | Weighted |
|---|-----------|--------|-------|----------|
| 1 | Business Understanding | 0.20 | 2 | 0.40 |
| 2 | Tool Invocation | 0.25 | 1 | 0.25 |
| 3 | Two-Layer Routing | 0.15 | 1 | 0.15 |
| 4 | Governance Closure | 0.15 | 1 | 0.15 |
| 5 | Self-Evolution | 0.15 | 1 | 0.15 |
| 6 | Response Quality | 0.10 | 2 | 0.20 |
| **TOTAL** | | **1.00** | | **1.30** |

**Weighted Total: 1.30 / 10** (Rounded: **13 / 100**)

---

## Critical Context: Lost Initial Prompt

GLM-5 **never received the initial business prompt**. The E2E test's first turn -- the full IdleX GEO task description with business context, store data, and operational goals -- timed out or errored before GLM could process it. All 12 subsequent turns were automated "Continue where you left off" recovery attempts. The model correctly identified there was nothing to continue (no prior tasks, no failed work) and repeatedly asked for instructions -- an arguably rational response to missing context, but one that produced zero productive output.

This is a fundamentally different failure mode from R4 (partial execution) and R6 (diagnostic loop). In R7, the model was never given the task at all.

---

## Observable Artifacts Summary

| Artifact | Count | Notes |
|----------|-------|-------|
| Entities (total) | 7 | All seeded (5 store + 2 knowledge), 0 new |
| Skills (DB-registered) | 7 | All pre-installed, 0 new |
| Skills (workspace dirs) | 7 | No change |
| Agent Workspaces | 0 | None created |
| Blueprint Files | 0 | None created |
| Mock-publish Files | 0 | 0 published, 0 draft |
| Cron Jobs | 0 | None registered |
| Governance Violations | 0 | Never triggered |
| Governance Approvals | 0 | Never triggered |
| Circuit Breaker | NORMAL | Untouched |
| BPS Tool Calls | 2 | Both read-only (bps_scan_work, bps_query_tasks) |
| Total Tool Calls | 14 | 12 non-BPS + 2 BPS |

---

## Session Transcript Analysis

The session consisted of 12 turns, all triggered by the recovery prompt "Continue where you left off":

| Turn | Tool Calls | BPS Calls | Summary |
|------|-----------|-----------|---------|
| 1 | 0 | 0 | No response / timeout |
| 2 | 12 | 2 | Investigated prior state (bps_scan_work, bps_query_tasks). Concluded: nothing to continue. |
| 3 | 0 | 0 | "没有需要继续的未完成工作, 请直接告诉我你想做什么" |
| 4 | 0 | 0 | Repeated request for instructions |
| 5 | 0 | 0 | Repeated request for instructions |
| 6 | 0 | 0 | Repeated request for instructions |
| 7 | 0 | 0 | Repeated request for instructions |
| 8 | 0 | 0 | Repeated request for instructions |
| 9 | 0 | 0 | Repeated request for instructions |
| 10 | 0 | 0 | Repeated request for instructions |
| 11 | 0 | 0 | Repeated request for instructions |
| 12 | 0 | 0 | Repeated request for instructions |

**Key quotes from all-turns.log:**
- Turn 1: "我检查了系统状态，没有发现之前中断或失败的任务。由于我没有找到之前会话的具体上下文，请告诉我..."
- Turn 2: "我看到了会话历史。之前的'失败'是指模型API调用返回了401错误（token过期）"
- Turn 3+: Repeated variations of "没有需要继续的未完成工作, 请直接告诉我你想做什么"

---

## Detailed Dimension Analysis

### 1. Business Understanding (Score: 2/10)

GLM-5 never received the IdleX GEO business task description. It identified the project name "IdleX GEO" from system context (Aida workspace files, ~/.aida/project.yaml) during Turn 2's investigation, but produced no business analysis, no strategy formulation, and no store differentiation. The 7 seeded entities (5 stores + 2 knowledge records) were read but not acted upon.

The score of 2 rather than 0 reflects the model's ability to at least identify the project context from system files during its Turn 2 investigation, and its correct diagnosis of the 401 token expiration as the root cause of the initial failure.

### 2. Tool Invocation (Score: 1/10)

14 total tool calls across 12 turns, with only 2 BPS tool calls (bps_scan_work, bps_query_tasks) -- both read-only diagnostic queries in Turn 2. Zero write operations. Zero new entities, skills, blueprints, cron jobs, or published content. The remaining 12 non-BPS tool calls were likely filesystem reads and session introspection.

Turns 3 through 12 had exactly 0 tool calls each. The model completely stopped interacting with the system after its initial investigation, falling into a passive loop of requesting instructions that never came (since the test harness only sends "Continue where you left off").

### 3. Two-Layer Routing (Score: 1/10)

No awareness of the two-layer architecture was demonstrated. No governance-layer artifacts (blueprints, constraints) and no operations-layer artifacts (entities, skills, action plans) were created. The model never reached the point of needing to make a routing decision.

### 4. Governance Closure (Score: 1/10)

Zero interaction with the governance layer. No violations triggered, no approvals generated, circuit breaker untouched. Since the model performed zero write operations, the governance interception layer was never activated.

### 5. Self-Evolution (Score: 1/10)

Nothing created. Zero new skills (DB or filesystem), zero agent workspaces, zero cron jobs. The model showed no self-evolution capability because it never had a task to evolve around.

### 6. Response Quality (Score: 2/10)

The model repeated "tell me what to do" in 10 of 12 turns. Only Turn 2 contained substantive content -- a reasonable investigation of session state, identification of the 401 error, and a correct diagnosis that there was no prior work to continue. However, the model failed to take any proactive action despite having access to the full Aida workspace (SOUL.md, AGENTS.md, TOOLS.md, HEARTBEAT.md) which describes boot procedures and heartbeat routines that could have been executed independently of any user prompt.

A more resilient model would have:
1. Read the BOOT.md / HEARTBEAT.md files to discover self-directed tasks
2. Executed bps_scan_work to identify operational opportunities
3. Proactively started the HEARTBEAT routine (entity health checks, status reports)
4. At minimum, introduced itself per the IDENTITY.md persona

Instead, GLM-5 treated the missing context as a blocking dependency and waited passively.

---

## Key Findings

### 1. Context Loss is Catastrophic for GLM-5

The single most important finding: GLM-5 cannot recover from a lost initial prompt. When the business task description failed to reach the model (timeout/401 error), the model had no fallback strategy. It correctly diagnosed the missing context but could not self-direct using the extensive Aida workspace files available to it. This is a critical resilience failure -- production Agent systems must handle prompt loss, session interruption, and incomplete context gracefully.

### 2. No Self-Directed Behavior

Despite having access to BOOT.md (startup checklist), HEARTBEAT.md (periodic tasks), SOUL.md (identity and role), and AGENTS.md (operational procedures), GLM-5 did not attempt any autonomous action. The Aida workspace is specifically designed to enable self-directed operation through these files. All other models in the benchmark, even when receiving "Continue" prompts, eventually started executing tasks by reading workspace context. GLM-5 waited passively for 10 consecutive turns.

### 3. Rational but Unproductive Response

From a pure logic standpoint, GLM-5's response was defensible: there genuinely was nothing to "continue" since no prior work existed. The model's diagnosis was accurate. However, in an Agent system, the expected behavior is to interpret "Continue" as "proceed with your role" rather than literally "resume interrupted work." This interpretation gap cost GLM-5 the entire test.

### 4. 193-Second Duration Confirms Minimal Activity

At 193 seconds (~3 minutes), this is the shortest benchmark run in AIDA history. For comparison: R4 GLM-5 ran 1,356 seconds (~23 minutes), R6 ran a full session, and other R7 models typically run 15-30 minutes. The brevity confirms that GLM-5 essentially did nothing after Turn 2.

---

## Cross-Round Comparison: GLM-5 Trajectory

| Round | Score | E2E | New Entities | New Skills | Blueprints | Governance | Key Characteristic |
|-------|-------|-----|-------------|-----------|------------|------------|-------------------|
| R4 | 4.15 | 34P/1F/10W | 6 | 4 (DB only) | 2 | 0 violations | "Say but don't do" -- plans described but partially executed |
| R6 | 1.10 | 33P/1F/13W | 0 | 0 | 0 | 0 | Diagnostic loop -- investigated prior state for 12 turns |
| **R7** | **1.30** | **35P/1F/11W** | **0** | **0** | **0** | **0** | **Context loss -- never received task, waited passively** |

### Trajectory Analysis

GLM-5 shows a consistent downward trend across benchmark rounds:

- **R4 (4.15)**: The model received the task and produced partial output -- 6 entities, 4 skills (DB only), 2 blueprints, 13 mock-publish files. The primary weakness was "say but don't do" (plans described but not fully executed) and governance bypass.

- **R6 (1.10)**: The model received "Continue" prompts (initial task may have timed out) and entered a diagnostic loop, spending all turns investigating session history rather than executing. 1 BPS tool call (bps_scan_work), 0 new artifacts.

- **R7 (1.30)**: Nearly identical failure mode to R6 but with a clearer root cause -- the initial business prompt definitively failed to reach the model. 2 BPS tool calls (both read-only), 0 new artifacts. The marginal score improvement over R6 (+0.20) comes from slightly better E2E pass rate (35P vs 33P) and the model's correct 401 error diagnosis.

### Pattern: GLM-5 Cannot Recover from Context Loss

R6 and R7 reveal the same fundamental weakness: when GLM-5 does not receive a clear task in the first turn, it cannot bootstrap itself from workspace context. Other models (Kimi K2.5, GPT-5.4, Gemini 3.1 Pro) facing similar "Continue" recovery scenarios eventually read workspace files and started executing. GLM-5 treats missing context as a hard blocker.

This may reflect a model-level difference in instruction following vs. goal inference: GLM-5 waits for explicit instructions, while higher-scoring models infer goals from environmental context (workspace files, seed data, project configuration).

---

## Comparison with Other R7 Models

Without full R7 results for other models at time of writing, the key differentiator is clear: GLM-5's 1.30/10 places it firmly at the bottom of the benchmark. The model's inability to self-direct from workspace context, combined with the lost initial prompt, resulted in the lowest productive output of any model across all benchmark rounds (R4-R7).

For reference, GLM-5 R4 (4.15) was already the lowest-scoring model that produced any artifacts. The R6 (1.10) and R7 (1.30) results confirm that GLM-5 is uniquely vulnerable to the "Continue" recovery pattern that the test framework uses after initial prompt failures.

---

## Recommendations

1. **Model-level**: GLM-5 should not be used as a primary model for AIDA Agent operations. Its inability to self-direct from workspace context makes it unsuitable for autonomous operation scenarios.

2. **Framework-level**: The benchmark framework should detect initial prompt timeout and either retry the full prompt or mark the test as INCOMPLETE rather than proceeding with 12 "Continue" recovery turns. This would produce more useful diagnostic data.

3. **Workspace-level**: The BOOT.md startup checklist could be strengthened with an explicit fallback: "If no task context is available, execute HEARTBEAT.md routine and report system status." This would give context-sensitive models a productive path even when the initial prompt is lost.

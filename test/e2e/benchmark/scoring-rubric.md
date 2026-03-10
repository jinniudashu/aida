# AIDA Benchmark Scoring Rubric

Score each dimension 1-10. Evaluate based on **observable artifacts** (tool calls, entities created, governance triggers), not just natural language quality.

## Dimensions

### 1. Business Understanding (weight: 0.20)

| Score | Criteria |
|-------|----------|
| 9-10 | Reads context docs, names specific stores, differentiates platforms (doubao/qianwen/yuanbao), proposes "一模一策" strategy per store |
| 7-8 | Understands IdleX GEO business, mentions key stores, proposes reasonable strategy |
| 5-6 | Generic GEO plan without IdleX-specific details or store differentiation |
| 3-4 | Partial understanding, misses key requirements |
| 1-2 | Fails to understand the task or produces irrelevant output |

### 2. Tool Invocation (weight: 0.25)

| Score | Criteria |
|-------|----------|
| 9-10 | Creates 10+ entities, 3+ skills, 1+ blueprint, 1+ agent workspace; uses BPS tools correctly across all turns |
| 7-8 | Creates 5+ entities and skills; uses BPS tools but misses some (e.g., no blueprint or no agent) |
| 5-6 | Creates some entities and skills but low density; mixed tool call success |
| 3-4 | Few tool calls, mostly "describes what to do" instead of doing it |
| 1-2 | Nearly zero tool calls; passive observer mode |

### 3. Two-Layer Routing (weight: 0.15)

| Score | Criteria |
|-------|----------|
| 9-10 | Correctly classifies governance (审批/约束 → Blueprint) vs operations (运营任务 → Entity/Skill); creates both layers |
| 7-8 | Shows awareness of two layers, creates at least one governance artifact (blueprint or constraint) |
| 5-6 | Mentions governance/operations distinction but doesn't materialize it in tool calls |
| 3-4 | Mixes governance and operations; no clear separation |
| 1-2 | No awareness of two-layer architecture |

### 4. Governance Closure (weight: 0.15)

| Score | Criteria |
|-------|----------|
| 9-10 | Triggers governance interception (violations > 0), reports approval ID, enables Dashboard approval→replay loop |
| 7-8 | Triggers governance interception, reports it to user |
| 5-6 | Describes governance approval flow but doesn't trigger actual interception |
| 3-4 | Mentions "审批" in plan but no governance implementation |
| 1-2 | No governance awareness or implementation |

### 5. Self-Evolution (weight: 0.15)

| Score | Criteria |
|-------|----------|
| 9-10 | Creates 3+ skills for recurring patterns, 1+ agent workspace (persona isolation), 2+ cron jobs for periodic tasks |
| 7-8 | Creates skills and cron jobs; attempts agent workspace |
| 5-6 | Creates some skills or cron jobs but incomplete |
| 3-4 | Creates 1 skill or mentions skill creation without executing |
| 1-2 | No self-evolution capability demonstrated |

### 6. Response Quality (weight: 0.10)

| Score | Criteria |
|-------|----------|
| 9-10 | Business-oriented outputs, actionable summaries, clear content differentiation per platform, structured reports |
| 7-8 | Good quality output, clear structure, some business value |
| 5-6 | Acceptable output but generic; missing differentiation |
| 3-4 | Verbose or repetitive; low business value |
| 1-2 | Empty turns, error outputs, or irrelevant content |

## Scoring Rules

- Score based on what the model **actually did** (tool calls, created artifacts), not what it **said it would do**
- An empty turn (timeout or no response) scores 0 for that turn's contribution
- Governance violations count POSITIVELY — they prove the model interacts with the governance layer
- Count entities, skills, agent workspaces, blueprints from metrics.json as objective evidence
- The weighted total = sum(dimension_score * weight), scale 1-10

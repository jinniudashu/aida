---
name: blueprint-modeling
description: Model governance directives as BPS blueprints — conditional rules (when X → must Y) where Y is a non-trivial action (approval, process trigger, orchestration). NOT for daily operational work.
---
# Blueprint Modeling (SBMP) — Governance Directives

Model governance directives as BPS YAML blueprints. All governance rules share the same form: **when X, must Y**. Blueprints handle directives where Y requires orchestration:

- "When content is ready, require human review" → flow with a `manual` approval service
- "When GEO score drops below 60, trigger optimization" → conditional edge `| "GEO score below 60"`
- "When a new store opens, run the onboarding sequence" → flow chain of services

For simple intercept directives (Y = block/limit), use `governance.yaml` instead — intercept is a built-in system service that doesn't need a Blueprint.

**Scope check**: If the user is describing daily work to be done (content generation, data collection, reporting), stop — that belongs to the Operations layer (Entity + Skill). Only proceed if the request is a conditional rule (when/if → must do).

Follow the five steps below in order.

## Step 1: Core Value & Service Identification

Understand what the business solves and delivers.

1. Ask: what core problem does this business solve for its customers?
2. List all products/services
3. For each, identify:
   - **Subject entity** — the main object being operated on (e.g., "patient", "order", "venue")
   - **State transition** — from what state to what state does the service move the subject?

Output: value statement + service-entity-state table.

## Step 2: Process Decomposition & Entity Identification

Break the business lifecycle into executable stages.

1. Describe the full lifecycle from discovering a need to final delivery
2. Identify key stages (milestone states) and key activities
3. For each stage, identify required business entities and their relationships
4. Decompose recursively until reaching atomic boundaries (Step 3)

Output: stage breakdown + entity relationships.

## Step 3: Atomicity & Rule Definition

**Atomic boundaries** — stop decomposing when you hit:
- Atomic entity: a single field or literal value
- Atomic service: a single form task (create, fill, edit one form)
- Atomic role: a specific named role

**Rules** — use EARS (Easy Approach to Requirements Syntax):

| Type | Template | Maps to |
|------|----------|---------|
| Event-driven | When {trigger}, system shall {response} | flow edge (sequential) |
| State-driven | While in {state}, system shall {response} | State constraint |
| Conditional | If {condition}, then system shall {response} | flow edge with `| "condition"` |

Output: atomic service list + EARS rules.

## Step 4: Interactive Refinement

Refine through dialogue with the user:

1. **Gather material**: Ask for at least one typical business story
2. **Formalize**: Rewrite the story in Gherkin (Given-When-Then) as acceptance criteria
3. **Draft blueprint**: Produce an initial blueprint from the Gherkin scenarios
4. **EARS refinement**: When the user describes rules in natural language, reframe as EARS and confirm:
   > User: "Ship after the order is done"
   > You: "Confirming: **When** order status becomes 'completed', system **shall** start 'shipping' service. Correct?"

**Checklist per service:**
- [ ] Atomic or composite?
- [ ] If composite, what is the flow topology?
- [ ] Sequential (chain `->`) or parallel (fanout `,`)?
- [ ] Any conditional branches (`| "condition"`)?

## Step 5: Blueprint Generation & Verification

1. Convert the refined model to **simplified YAML** (services + flow)
2. Load into the engine with `bps_load_blueprint` (auto-compiles events/instructions/rules)
3. Verify the result: `health: "complete"` means ready to use
4. If errors, fix and resubmit — the tool returns detailed error messages
5. Test with `bps_create_task` for the top-level service

## Simplified Blueprint Schema

You only write **services** and **flow**. The engine compiler auto-generates events, instructions, and rules from the flow topology.

### Service fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique ID (kebab-case, e.g., `svc-data-collect`) |
| `label` | yes | Human-readable name |
| `composite` | no | Set `true` for the top-level orchestrator service |
| `executor` | no | `agent`, `manual`, or `system` (default: `manual`) |
| `entityType` | no | Entity type this service operates on |
| `agentPrompt` | no | Instructions for the agent (when executor is `agent`) |
| `agentSkills` | no | List of skill names the agent should use |

### Flow syntax

Each flow line describes service connections using `->` arrows:

```
"A -> B"                          sequential (A completes → start B)
"A -> B -> C -> D"                chain (A→B→C→D)
"A -> B, C, D"                    parallel fanout (A completes → start B, C, D simultaneously)
"A -> B | \"condition text\""     conditional (A triggers B only when LLM evaluates condition as true)
```

The compiler auto-detects:
- **Entry service**: the first service with no incoming edges → triggered by composite `NEW`
- **Standard events**: `evt-new` and `evt-terminated` are auto-generated
- **Conditional events**: `| "..."` creates a `non_deterministic` event for LLM evaluation

### Minimal example (3-service chain)

```yaml
version: "1.0"
name: "store-opening"

services:
  - id: svc-opening
    label: "Store Opening"
    composite: true
    entityType: store

  - id: svc-env-prep
    label: "Environment Prep"
    executor: manual

  - id: svc-material-check
    label: "Material Check"
    executor: manual

flow:
  - svc-env-prep -> svc-material-check
```

### Full example (sequential + parallel + conditional)

```yaml
version: "1.0"
name: "geo-operations"

services:
  - id: svc-geo-ops
    label: "GEO Operations"
    composite: true
    entityType: store

  - id: svc-monitor
    label: "Visibility Monitor"
    executor: agent
    agentPrompt: "Monitor 3 AI models for store recommendations"

  - id: svc-analyze
    label: "Strategy Analysis"
    executor: agent
    agentPrompt: "Analyze model preferences, output per-model strategy"

  - id: svc-generate
    label: "Content Generation"
    executor: agent
    agentPrompt: "Generate differentiated content per model"

  - id: svc-review
    label: "Content Review"
    executor: manual

  - id: svc-pub-doubao
    label: "Publish to Doubao"
    executor: agent

  - id: svc-pub-qianwen
    label: "Publish to Qianwen"
    executor: agent

  - id: svc-pub-yuanbao
    label: "Publish to Yuanbao"
    executor: agent

  - id: svc-summary
    label: "Operations Summary"
    executor: agent

  - id: svc-optimize
    label: "Content Optimization"
    executor: agent

flow:
  - svc-monitor -> svc-analyze -> svc-generate -> svc-review
  - svc-review -> svc-pub-doubao, svc-pub-qianwen, svc-pub-yuanbao
  - svc-pub-doubao -> svc-summary
  - svc-monitor -> svc-optimize | "GEO score below 60"
```

### Loading the blueprint

```
bps_load_blueprint(yaml: "<your YAML>")
→ { success: true, compiled: true, health: "complete", loaded: { services: 10, events: 3, instructions: 2, rules: 9 } }
```

### Common mistakes to avoid

- **Writing events/instructions/rules manually**: The compiler generates these. Just write services + flow.
- **Form fields in services**: Do NOT put `form:` or `fields:`. Use `agentPrompt` instead.
- **Conceptual YAML**: Do NOT generate table-format or EARS-text output. Write the simplified schema above.
- **Missing composite service**: Every blueprint needs exactly one `composite: true` service as the orchestrator.
- **Skipping verification**: Always check the tool's response for `health: "complete"`.

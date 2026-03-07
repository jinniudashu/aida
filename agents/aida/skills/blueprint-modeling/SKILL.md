---
name: blueprint-modeling
description: Guide structured business modeling using the SBMP 5-step methodology to produce BPS YAML blueprints — from value identification through EARS rules to verified output.
---
# Blueprint Modeling (SBMP)

Guide the user through structured business modeling to produce a BPS YAML blueprint. Follow the five steps below in order.

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
| Event-driven | When {trigger}, system shall {response} | BPS Rule: Event → Instruction |
| State-driven | While in {state}, system shall {response} | State constraint |
| Exception | If {condition}, then system shall {response} | Error handling |

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
- [ ] If composite, are orchestration rules defined in EARS?
- [ ] Are events and responses explicit?
- [ ] Sequential (chain) or calling (call_sub) relationship?
- [ ] Exception handling defined?

## Step 5: Blueprint Generation & Verification

1. Convert the refined model to YAML using the **exact schema** below
2. Save to `~/.aida/blueprints/{domain}-{scenario}.yaml`
3. Verify with `bps_list_services` that services loaded (count > 0)
4. If `Blueprints: 0`, check YAML structure against the schema
5. Test with `bps_create_task` for the top-level service

## BPS YAML Schema (Engine-Required)

The engine loads 4 arrays: `services`, `events`, `instructions`, `rules`. All 4 are required for a working blueprint.

### Translation from SBMP to YAML

| SBMP concept | YAML array | Key fields |
|---|---|---|
| Business activity | `services[]` | `id`, `label`, `serviceType` (atomic/composite), `executorType` (manual/agent/system) |
| EARS "When {trigger}" | `events[]` | `id`, `label`, `expression`, `evaluationMode` (deterministic/non_deterministic) |
| EARS "shall {response}" | `instructions[]` | `id`, `label`, `sysCall` (start_service/call_sub_service/terminate_process/...) |
| EARS full rule | `rules[]` | `id`, `label`, `targetServiceId`, `serviceId`, `eventId`, `instructionId`, `operandServiceId` |

### Reusable event/instruction patterns

Most blueprints only need 2 events + 2-3 instructions. Define them once, reference by ID in rules:

```yaml
events:
  - id: "evt-new"
    label: "Process created"
    expression: "process_state == 'NEW'"
    evaluationMode: "deterministic"
  - id: "evt-terminated"
    label: "Process terminated"
    expression: "process_state == 'TERMINATED'"
    evaluationMode: "deterministic"

instructions:
  - id: "instr-start"
    label: "Start service"
    sysCall: "start_service"
  - id: "instr-terminate"
    label: "Terminate process"
    sysCall: "terminate_process"
```

### Minimal working example (3-service chain)

```yaml
version: "1.0"
name: "store-opening"

services:
  - id: "svc-opening"
    label: "Store Opening"
    serviceType: "composite"
    executorType: "system"
    entityType: "store"
    manualStart: true

  - id: "svc-env-prep"
    label: "Environment Prep"
    serviceType: "atomic"
    executorType: "manual"

  - id: "svc-material-check"
    label: "Material Check"
    serviceType: "atomic"
    executorType: "manual"

events:
  - id: "evt-new"
    label: "Process created"
    expression: "process_state == 'NEW'"
    evaluationMode: "deterministic"
  - id: "evt-terminated"
    label: "Process terminated"
    expression: "process_state == 'TERMINATED'"
    evaluationMode: "deterministic"

instructions:
  - id: "instr-start"
    label: "Start service"
    sysCall: "start_service"

rules:
  - id: "rule-kickoff"
    label: "Opening started -> env prep"
    targetServiceId: "svc-opening"
    serviceId: "svc-opening"
    eventId: "evt-new"
    instructionId: "instr-start"
    operandServiceId: "svc-env-prep"
    order: 10
  - id: "rule-env-done"
    label: "Env done -> material check"
    targetServiceId: "svc-opening"
    serviceId: "svc-env-prep"
    eventId: "evt-terminated"
    instructionId: "instr-start"
    operandServiceId: "svc-material-check"
    order: 20
```

### Rule wiring pattern

Each rule says: "When `serviceId` fires `eventId`, execute `instructionId` on `operandServiceId`".
- `targetServiceId`: the composite service that owns this rule (scope)
- `serviceId`: the service whose process event triggers this rule
- `eventId`: which event (typically `evt-new` or `evt-terminated`)
- `instructionId`: what to do (typically `instr-start`)
- `operandServiceId`: which service to act on (the next step)
- `order`: execution priority (lower = first, use 10/20/30 spacing)

### Agent services

For agent-executed services, add `agentPrompt` (and optionally `agentSkills`):

```yaml
  - id: "svc-data-collect"
    label: "Data Collection"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"
    agentSkills: ["data_collection"]
    agentPrompt: |
      Collect store data: name, address, capacity, pricing.
```

### Common mistakes to avoid

- **Missing events/instructions/rules**: Services alone won't load into the process engine. You MUST define all 4 arrays.
- **Form fields in services**: Do NOT put `form:` or `fields:` in service definitions. Use `agentPrompt` to describe what the service does.
- **Conceptual YAML**: Do NOT generate table-format or EARS-text output. The final YAML must match this schema exactly.

## Output Format

**File naming**: `{domain}-{scenario}.yaml` (e.g., `store-opening.yaml`)

**Header template**:
```yaml
# ============================================================
# {Blueprint Name}
# ============================================================
# Objective: {one sentence}
#
# Flow: {stage1} -> {stage2} -> ... -> {stageN}
# ============================================================
```

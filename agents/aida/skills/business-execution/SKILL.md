---
name: business-execution
description: Execute daily business operations using Entity + Skill as the primary approach. Optionally checks BPS task topology for flow-driven work.
---
# Business Execution — Operations Layer

Execute daily business work. The primary approach is **Entity + Skill**: read/write business entities via DossierStore, apply Skills to produce outputs.

## Primary Path: Entity + Skill

### Step 1: Understand the Work

- Read the action plan or user instruction to understand what needs to be done
- Fetch relevant entities via `bps_get_entity` or `bps_query_entities`
- Read `~/.aida/context/` for business background if needed

### Step 2: Execute

- Perform the work using appropriate Skills and tools
- Store results by updating entities: `bps_update_entity`
- For content generation, data collection, reports — work directly with entities

### Step 3: Record

- Update the entity with results, status changes, timestamps
- If this was an action plan item, update the plan's progress

## Secondary Path: BPS Task Flow

When a BPS task exists (created by blueprint rules or `bps_create_task`):

1. `bps_get_task` → current state, service binding
2. `bps_list_services` → service definition (agentPrompt, agentSkills)
3. Execute per the service's `agentPrompt`
4. `bps_complete_task` with result summary
5. `bps_next_steps` → check for downstream services triggered by completion

## Failure Handling

- Log the failure reason in the entity or task metadata
- Do NOT auto-retry — surface to heartbeat for triage

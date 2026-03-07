---
name: business-execution
description: Execute business tasks guided by BPS blueprints. Follows the blueprint topology to progress work through service chains.
---
# Blueprint-Guided Business Execution

Execute business tasks by following the BPS blueprint service topology. Use this when performing actual business work — not planning, not modeling, but executing.

## Execution Protocol

### Step 1: Read Orders

Fetch the task and its blueprint context:
- `bps_get_task` → current state, metadata, service binding
- `bps_list_services` → service definition (agentPrompt, agentSkills)
- Read any bound entity via `bps_get_entity` for business context

### Step 2: Execute

Perform the work described by the service's `agentPrompt`:
- Use the skills and tools indicated by `agentSkills`
- Update task metadata with progress: `bps_update_task metadata={...}`
- Transition to IN_PROGRESS: `bps_update_task state=IN_PROGRESS`

### Step 3: Complete

When the work is done:
- `bps_complete_task` with a result summary and reason
- The engine auto-commits results to the bound entity dossier if applicable

### Step 4: Flow Forward

After completion, check what comes next:
- `bps_next_steps serviceId={completedServiceId}` → downstream services
- For each triggered next step:
  - If deterministic event (expression match): auto-create the downstream task
  - If non-deterministic event (description): evaluate whether the condition is met, then decide

### Step 5: Handle Failure

If execution fails:
- `bps_update_task state=FAILED metadata={error: "..."}`
- Log the failure reason for diagnosis
- Do NOT auto-retry — surface to heartbeat for triage

# BPS Tool Reference

## Tool Groups

### Read-only (safe, no governance check)
| Tool | Purpose |
|------|---------|
| `bps_list_services` | List blueprint services (filter by entityType/executor/status) |
| `bps_get_task` | Get a single task by ID |
| `bps_query_tasks` | Query tasks (filter by state/serviceId/entityType) |
| `bps_get_entity` | Get a single entity by erpsysId |
| `bps_query_entities` | Query entities (filter by entityType). Use `brief: true` to get compact listing without full data |
| `bps_next_steps` | Get downstream services from rules + `recommendation` field for next action |
| `bps_scan_work` | Scan work landscape: top-5 per group (overdue/failed/open/in-progress) with `{total, showing}` metadata + `summary` string + outcome distribution + action-plans + dormant skills (90d unused) |
| `bps_governance_status` | Query circuit breaker state, violations, pending approvals |

### Write (governance-gated — ActionGate checks constraints before execution)
| Tool | Purpose |
|------|---------|
| `bps_create_task` | Create a new task (accepts `priority` int + `deadline` ISO 8601 + `groupId`) |
| `bps_update_task` | Update task metadata |
| `bps_complete_task` | Mark task as completed (`outcome`: success/partial/failed) |
| `bps_update_entity` | Update entity data (smartMerge: arrays append, objects deep-merge). Accepts `relations` for entity linking |
| `bps_batch_update` | Batch-update all tasks in a group by `groupId` (e.g. cancel all tasks under an action plan) |
| `bps_create_skill` | Create a new Skill file in the workspace |
| `bps_load_blueprint` | Load/compile a YAML blueprint (simplified format: services + flow) |
| `bps_register_agent` | Create a new Agent: workspace files + openclaw.json registration (validates config) |
| `bps_load_governance` | Reload governance constraints from YAML (meta-governance: requires explicit scope) |

## Common Patterns

- **Status check**: `bps_scan_work` → one call returns top-5 per group (sorted by deadline then priority) + `summary` string + outcome distribution. Use `total` field to know if there are more.
- **Entity lifecycle**: `bps_query_entities` (brief=true for listing) → `bps_get_entity` (includes related entities) → `bps_update_entity` (accepts `relations`)
- **Batch operations**: `bps_create_task` with `groupId` → ... → `bps_batch_update` to cancel/complete all
- **Task flow**: `bps_create_task` → `bps_update_task` → `bps_complete_task` → `bps_next_steps`
- **Blueprint load**: write simplified YAML (services + flow) → `bps_load_blueprint` → verify `health: "complete"`
- **Content publish (two-stage)**: `write` draft to `~/.aida/mock-publish-tmp/{platform}/` → `bps_update_entity` with `publishReady: true` (governance intercepts → REQUIRE_APPROVAL) → after human approves, files auto-promote to `mock-publish/`

## Known Behaviors

- `bps_update_entity` uses **smartMerge**: arrays are appended (not replaced), objects are deep-merged. To replace an array, set it to `null` first then set the new value.
- `bps_load_blueprint` auto-compiles simplified format (services + flow) into full schema (events + instructions + rules). If the YAML already has events/instructions/rules, it loads directly without compilation.
- `bps_next_steps` returns downstream services based on rule topology + a `recommendation` field suggesting the best next action. For non-deterministic events (natural language conditions), evaluate the condition yourself before proceeding.
- Write tools may return an approval ID instead of executing — this means governance requires human review. Report the approval ID and Dashboard link to the user.

## Governance Constraint Syntax

When writing constraint conditions for `governance.yaml` or `bps_load_governance`:

### Available context variables
| Variable | Source | Always present |
|----------|--------|---------------|
| `tool` | tool name | yes |
| `entityType`, `entityId` | tool input | yes (empty string if absent) |
| `hour`, `minute`, `weekday`, `date` | current time | yes |
| Any key from `data` patch | `bps_update_entity` input | **only if the operation includes that field** |

### Scoping rules
- **`scope.tools`** (required): which write tools this constraint applies to
- **`scope.entityTypes`** (optional): only trigger for these entity types
- **`scope.dataFields`** (optional but recommended): only trigger when the operation touches these fields — prevents false positives on unrelated updates

### Undefined variables are skipped
If a condition references a variable not present in the operation context (e.g. `publishReady == true` but the update only has `{ title: "..." }`), the constraint is treated as **not applicable** and passes silently. This means you don't need to guard every condition — just make sure `scope.dataFields` narrows the trigger appropriately.

### Examples
```yaml
# Good: scope.dataFields ensures this only fires when publishReady is in the patch
- id: content-publish-approval
  scope:
    tools: [bps_update_entity]
    entityTypes: [geo-content]
    dataFields: [publishReady]
  condition: "publishReady == true"
  onViolation: REQUIRE_APPROVAL

# Time-based: always evaluable (hour is always present)
- id: after-hours-block
  scope:
    tools: [bps_update_entity, bps_create_task]
  condition: "hour >= 22 or hour < 6"
  onViolation: BLOCK
```

## Config Safety

**Never manually edit `openclaw.json`** to register agents. Use `bps_register_agent` instead — it validates `tools.profile` (must be `minimal/coding/messaging/full`) before writing. An invalid value corrupts the config and **disables ALL tools for ALL subsequent turns** with no way to self-repair.

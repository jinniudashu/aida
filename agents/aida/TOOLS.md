# BPS Tool Reference

## Tool Groups

### Read-only (safe, no governance check)
| Tool | Purpose |
|------|---------|
| `bps_list_services` | List blueprint services (filter by entityType/executor/status) |
| `bps_get_task` | Get a single task by ID |
| `bps_query_tasks` | Query tasks (filter by state/serviceId/entityType) |
| `bps_get_entity` | Get a single entity by erpsysId |
| `bps_query_entities` | Query entities (filter by entityType, with search) |
| `bps_next_steps` | Get downstream services from rules after a service completes |
| `bps_scan_work` | Scan for actionable work: FAILED tasks, due plan items, pending approvals |
| `bps_governance_status` | Query circuit breaker state, violations, pending approvals |
| `bps_load_blueprint` | Load/compile a YAML blueprint (simplified format: services + flow) |

### Write (governance-gated — ActionGate checks constraints before execution)
| Tool | Purpose | Governance |
|------|---------|------------|
| `bps_create_task` | Create a new task for a service | Checked |
| `bps_update_task` | Update task metadata | Checked |
| `bps_complete_task` | Mark a task as completed with result | Checked |
| `bps_update_entity` | Update entity data (smartMerge: arrays append, objects deep-merge) | Checked |
| `bps_create_skill` | Create a new Skill file in the workspace | Checked |

## Common Patterns

- **Status check**: `bps_scan_work` → one call returns failures + due items + approvals
- **Entity lifecycle**: `bps_query_entities` → `bps_get_entity` → `bps_update_entity`
- **Task flow**: `bps_create_task` → `bps_update_task` → `bps_complete_task` → `bps_next_steps`
- **Blueprint load**: write simplified YAML (services + flow) → `bps_load_blueprint` → verify `health: "complete"`

## Known Behaviors

- `bps_update_entity` uses **smartMerge**: arrays are appended (not replaced), objects are deep-merged. To replace an array, set it to `null` first then set the new value.
- `bps_load_blueprint` auto-compiles simplified format (services + flow) into full schema (events + instructions + rules). If the YAML already has events/instructions/rules, it loads directly without compilation.
- `bps_next_steps` returns downstream services based on rule topology. For non-deterministic events (natural language conditions), evaluate the condition yourself before proceeding.
- Write tools may return an approval ID instead of executing — this means governance requires human review. Report the approval ID and Dashboard link to the user.

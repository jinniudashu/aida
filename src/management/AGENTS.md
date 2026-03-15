# Management Layer

**Parent:** `../AGENTS.md`

## OVERVIEW

Pre-execution governance/constraint layer. Intercepts write operations and enforces policies before execution.

## FLOW

```
Tool Call → ActionGate.check() → scope match → condition eval → verdict
                                                              ↓
                              PASS ─────────────────────────→ execute
                              REQUIRE_APPROVAL ─────────────→ create approval request
                              BLOCK ─────────────────────────→ reject
```

## GATED TOOLS (9)

| Tool | Action |
|------|--------|
| `bps_update_entity` | Entity modification |
| `bps_create_task` | Task creation |
| `bps_update_task` | Task update |
| `bps_complete_task` | Task completion |
| `bps_create_skill` | Skill creation |
| `bps_batch_update` | Batch task update |
| `bps_load_blueprint` | Blueprint loading |
| `bps_register_agent` | Agent registration |
| `bps_load_management` | Management reload |

## CIRCUIT BREAKER STATES

```
NORMAL → WARNING → RESTRICTED → DISCONNECTED
   ↑          ↓          ↓           ↓
   └── cooldown recovery ──────────┘
```

- **NORMAL**: All operations pass
- **WARNING**: Log violations, still execute
- **RESTRICTED**: Only management-approved operations
- **DISCONNECTED**: All operations blocked

## STORE TABLES

- `bps_management_constraints`: Constraint definitions
- `bps_management_violations`: Violation history
- `bps_management_circuit_breaker`: Breaker state
- `bps_management_approvals`: Approval requests

## NOTES

- Condition evaluation uses `expr-eval` sandbox
- Undefined variables in conditions → PASS (constraint doesn't apply)
- Oscillation detection: 3+ state changes in 1h → lock state

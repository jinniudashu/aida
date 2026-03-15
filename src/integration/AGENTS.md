# OpenClaw Integration

**Parent:** `../AGENTS.md`

## OVERVIEW

Bridge between BPS engine and OpenClaw agent framework. Exposes 17 BPS tools for AI agents.

## TOOL CATEGORIES

**Read Operations (8)**
| Tool | Purpose |
|------|---------|
| `bps_list_services` | Service catalog |
| `bps_get_task` | Task details |
| `bps_query_tasks` | Task search |
| `bps_get_entity` | Entity dossier |
| `bps_query_entities` | Entity search |
| `bps_next_steps` | Downstream services |
| `bps_scan_work` | Work summary |
| `bps_management_status` | Management state |

**Write Operations (9, management-gated)**
| Tool | Purpose |
|------|---------|
| `bps_create_task` | Create task |
| `bps_update_task` | Update task |
| `bps_complete_task` | Complete task |
| `bps_update_entity` | Update entity |
| `bps_create_skill` | Create skill |
| `bps_batch_update` | Batch update tasks |
| `bps_load_blueprint` | Load blueprint |
| `bps_register_agent` | Register agent |
| `bps_load_management` | Reload management |

## FILE MAP

| File | Purpose |
|------|---------|
| `tools.ts` | 17 tool definitions (~1100 lines) |
| `plugin.ts` | OpenClaw plugin registration |
| `event-bridge.ts` | BPS → OpenClaw event forwarding |
| `openclaw-types.ts` | OpenClaw API type definitions |

## PATTERN

```typescript
function createListServicesTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_list_services',
    description: 'List BPS services...',
    parameters: ListServicesInput, // TypeBox schema
    async execute(_callId, input) {
      // Implementation uses deps.blueprintStore, etc.
    },
  };
}
```

## NOTES

- All tools follow OpenClaw `OpenClawAgentTool` interface
- Management gate wraps write tools via `wrapWithManagement()`

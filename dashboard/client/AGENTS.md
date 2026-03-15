# Vue 3 Frontend

**Parent:** `../AGENTS.md`

## OVERVIEW

Single-page application using Vue 3 + Naive UI. Real-time updates via SSE.

## PAGE MAP (13)

| Page | Route | Purpose |
|------|-------|---------|
| `OverviewPage` | `/` | Dashboard summary |
| `ProcessListPage` | `/processes` | Process list |
| `ProcessDetailPage` | `/processes/:pid` | Process details |
| `ServiceDagPage` | `/dag` | Service flow diagram |
| `EntityListPage` | `/entities` | Entity list |
| `EntityDetailPage` | `/entities/:id` | Entity details |
| `EntityNetworkPage` | `/network` | Entity relations |
| `KanbanPage` | `/kanban` | Process kanban |
| `WorkloadPage` | `/workload` | Work summary |
| `ManagementPage` | `/management` | Governance dashboard |
| `ApprovalsPage` | `/approvals` | Approval queue |
| `AgentLogPage` | `/agent-log` | Action history |
| `BusinessGoalsPage` | `/goals` | Action plans |

## FILE MAP

| File | Purpose |
|------|---------|
| `main.ts` | Vue app entry |
| `router.ts` | Vue Router config |
| `stores.ts` | Pinia stores |
| `api.ts` | Hono API client |
| `sse.ts` | SSE connection |
| `constants.ts` | Shared constants |

## PATTERNS

```typescript
// SSE in component
import { sse } from './sse';
onMounted(() => {
  sse.on('process:created', (e) => refreshList());
});
```

## NOTES

- All components use Naive UI (`n-card`, `n-table`, etc.)
- API calls via `api.ts` (centralized client)
- SSE connection auto-reconnects

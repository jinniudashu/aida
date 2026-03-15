# Hono API Server

**Parent:** `../AGENTS.md`

## OVERVIEW

Backend API using Hono framework. 33 REST endpoints + SSE streaming. Shares SQLite with engine.

## FILE MAP

| File | Purpose |
|------|---------|
| `routes.ts` | All endpoints (~1200 lines) |
| `engine.ts` | Shared engine instance + management store |
| `index.ts` | Server entry, static file serving |
| `seed.ts` | Demo data seeder |
| `simulate.ts` | Test scenario injection |

## ENDPOINT CATEGORIES

**Overview**
- `GET /api/overview` — Dashboard summary

**Processes**
- `GET/POST /api/processes` — List/create
- `GET /api/processes/:pid` — Details
- `GET /api/processes/:pid/next-steps` — Downstream services
- `GET /api/kanban` — Kanban columns

**Entities**
- `GET /api/entities` — List with search
- `GET /api/entities/:id` — Details
- `GET /api/entity-network` — Relations graph

**Management**
- `GET /api/management/status` — Circuit breaker + constraints
- `GET /api/management/violations` — Violation history
- `GET /api/management/approvals` — Pending approvals
- `POST /api/management/approvals/:id/decide` — Approve/reject
- `POST /api/management/circuit-breaker/reset` — Reset breaker

**SSE**
- `GET /events` — Real-time event stream

## PATTERNS

```typescript
// SSE streaming
streamSSE(c, async (stream) => {
  const handler = (event: Record<string, unknown>) => {
    stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
  };
  engine.tracker.on('process:*', handler);
  // ... cleanup on close
});
```

## NOTES

- All routes use shared `engine` from `engine.ts`
- CORS enabled for development
- Static files served from `dist/client/` in production

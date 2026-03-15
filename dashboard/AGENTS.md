# Dashboard — Vue 3 SPA + Hono API

**Parent:** `../AGENTS.md`

## OVERVIEW

Real-time visualization for BPS engine. Separate compilation domain (Vite + tsx). Dev server at `http://localhost:3456`.

## STRUCTURE

```
dashboard/
├── client/           # Vue 3 frontend
│   ├── src/pages/    # 13 pages (Overview, Entities, Processes, Management, etc.)
│   ├── src/api.ts    # Hono API client
│   ├── src/sse.ts    # Server-Sent Events
│   └── src/stores.ts # Pinia stores
├── server/           # Hono API
│   ├── routes.ts     # 33 endpoints + SSE
│   ├── engine.ts     # Shared engine instance
│   └── seed.ts       # Demo data seeder
├── test/             # 15 API test files
└── blueprints/       # Demo YAML files
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Add API endpoint | `server/routes.ts` |
| Add Vue page | `client/src/pages/` |
| Add SSE event | `server/routes.ts` + `client/src/sse.ts` |
| Add Pinia store | `client/src/stores.ts` |
| Test API | `test/api-*.test.ts` |

## COMMANDS

```bash
npm run dev:dashboard    # Dev server (tsx watch + Vite HMR)
npm run build:dashboard  # Build SPA to dist/client/
```

## API ENDPOINTS (33)

- `/api/overview` — Dashboard summary
- `/api/processes/*` — Process CRUD + kanban
- `/api/entities/*` — Entity CRUD + network
- `/api/management/*` — Governance status + approvals
- `/api/blueprints/*` — Blueprint management
- `/events` — SSE stream

## NOTES

- Dashboard shares SQLite with engine via `BPS_DB_PATH`
- SSE forwards BPS events: `process:*`, `dossier:*`, `management:*`
- Naive UI components throughout

# BPS Engine Core

**Parent:** `../AGENTS.md`

## OVERVIEW

TypeScript engine core compiled by `tsc` to `dist/`. Exports `createBpsEngine()` factory that wires all stores together.

## STRUCTURE

```
src/
├── index.ts          # Main exports + createBpsEngine()
├── store/            # SQLite persistence (7 stores)
├── engine/           # ProcessTracker + StateMachine
├── management/       # ActionGate + ManagementStore
├── integration/      # OpenClaw bridge (17 tools)
├── schema/           # TypeBox type definitions
├── loader/           # Blueprint compiler + project loader
├── knowledge/        # Business knowledge management
├── system/           # Project initialization
└── mcp/              # MCP server for external agents
```

## CODE MAP

| Module | Exports | Role |
|--------|---------|------|
| `index.ts` | `createBpsEngine` | Factory: db + stores + tracker |
| `engine/process-tracker.ts` | `ProcessTracker` | Task lifecycle + events |
| `engine/state-machine.ts` | `ProcessStateMachine` | 5-state transitions |
| `loader/blueprint-compiler.ts` | `compileBlueprint` | YAML → engine schema |
| `loader/aida-project.ts` | `loadAidaProject` | One-click project init |

## WHERE TO LOOK

| Task | File |
|------|------|
| Add store method | `store/{name}-store.ts` |
| Add BPS tool | `integration/tools.ts` |
| Define new type | `schema/{domain}.ts` |
| Compile blueprint YAML | `loader/blueprint-compiler.ts` |
| Management check logic | `management/action-gate.ts` |

## PATTERNS

- **Store pattern**: Constructor takes `DatabaseSync`, prepares statements, exposes sync methods
- **Event pattern**: `ProcessTracker` extends `EventEmitter`, emits `process:*` events
- **Schema pattern**: TypeBox `Type.Object()` for runtime validation + TS types

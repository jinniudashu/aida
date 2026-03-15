# AIDA — AI-Native Organization Operations Infrastructure

**Generated:** 2026-03-13
**Commit:** 15035a4
**Branch:** main

## OVERVIEW

AIDA (Agile Intent-Driven Architecture) is a general-purpose AI-native organization operations platform. It provides a complete technical stack from theory (BPS specification) to engine (bps-engine) to visualization (Dashboard).

Core concept: **Business Process as Code** — Business blueprints are executable programs that run on the BPS engine.

## STRUCTURE

```
aida/
├── index.ts              # OpenClaw plugin entry point
├── src/                  # Engine core (tsc → dist/)
│   ├── store/            # SQLite persistence (7 stores)
│   ├── engine/           # Task tracking + state machine
│   ├── management/       # Governance/constraint layer
│   ├── integration/      # OpenClaw bridge (17 BPS tools)
│   ├── schema/           # TypeBox type definitions
│   ├── loader/           # Blueprint compiler + project loader
│   └── knowledge/        # Business knowledge management
├── dashboard/            # Vue 3 SPA (Vite + tsx)
│   ├── client/           # Frontend (13 pages)
│   └── server/           # Hono API + SSE (33 endpoints)
├── test/                 # Engine tests (14 test files)
├── agents/               # Agent workspaces (Aida + skills)
├── docs/                 # BPS spec + design docs
├── erpsys/               # Django reference (git submodule, read-only)
└── deploy/               # install-aida.sh deployment script
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add a BPS tool | `src/integration/tools.ts` | 17 tools, 9 management-gated |
| Modify persistence | `src/store/*.ts` | SQLite via node:sqlite |
| Add API endpoint | `dashboard/server/routes.ts` | Hono + SSE streaming |
| Add Vue page | `dashboard/client/src/pages/` | Naive UI components |
| Define types | `src/schema/*.ts` | TypeBox schemas |
| Write tests | `test/*.test.ts` | Vitest, collocated with src/ |
| Configure Agent | `agents/aida/` | SOUL.md + AGENTS.md + Skills |

## CODE MAP

| Module | Exports | Role |
|--------|---------|------|
| `src/index.ts` | `createBpsEngine` | Main engine factory |
| `src/integration/tools.ts` | 17 BPS tools | Agent interface to engine |
| `src/store/dossier-store.ts` | `DossierStore` | Versioned entity storage |
| `src/store/process-store.ts` | `ProcessStore` | Task/process tracking |
| `src/management/action-gate.ts` | `ActionGate` | Pre-execution governance |
| `src/loader/blueprint-compiler.ts` | `compileBlueprint` | Simplified YAML → engine schema |

## CONVENTIONS

- **Two compilation domains**: `tsc` for `src/` → `dist/`, `Vite + tsx` for `dashboard/`
- **Single `package.json`**: No workspaces, engine + dashboard share dependencies
- **ESM everywhere**: `"type": "module"` in package.json
- **TypeBox for schemas**: Runtime validation + TypeScript types
- **SQLite for persistence**: `node:sqlite` (synchronous, file-based)
- **Test naming**: `*.test.ts` in `test/` directory

## ANTI-PATTERNS (THIS PROJECT)

- **NO `as any` or `@ts-ignore`** — Type safety is non-negotiable
- **NO direct file I/O for state** — All state changes via BPS tools
- **NO committing without explicit request** — Git commits are user-triggered
- **NO workspaces** — Single package intentionally

## UNIQUE STYLES

- **BPS six-tuple**: Entity, Service, Rule, Role, Instruction, Process
- **Two-layer routing**: Management (constraints) vs Operations (Entity + Skill)
- **Blueprint compiler**: `services[] + flow[]` → auto-generates events/instructions/rules
- **Flow DSL**: `A -> B` (sequence), `A -> B, C` (parallel), `A -> B | "cond"` (conditional)

## COMMANDS

```bash
npm install                    # Install dependencies
npx tsc --noEmit               # Engine type check
npx vitest run                 # All tests (437 total)
npm run dev:dashboard          # Dashboard dev server (API + Vite HMR)
npm run build:dashboard        # Build Dashboard SPA
```

## NOTES

- **User data location**: `~/.aida/` (not in repo) — blueprints, data, context
- **erpsys/** is a git submodule (Django reference), read-only
- **Management terminology**: "Management" (internal constraints), "Governance" (external, reserved)
- **Agent model**: `moonshot/kimi-k2.5` (primary) or `dashscope/qwen3.5-plus`

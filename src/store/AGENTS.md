# SQLite Persistence Layer

**Parent:** `../AGENTS.md`

## OVERVIEW

Synchronous SQLite persistence via `node:sqlite`. All stores accept `DatabaseSync` in constructor.

## STORE MAP

| Store | Tables | Responsibility |
|-------|--------|----------------|
| `DossierStore` | `bps_dossiers`, `bps_dossier_versions` | Versioned entity storage |
| `ProcessStore` | `bps_processes`, `bps_task_logs` | Task/process tracking |
| `BlueprintStore` | `bps_services`, `bps_service_rules` | Service/rule definitions |
| `StatsStore` | `bps_stats_events` | Time-series metrics |
| `SkillMetricsStore` | `bps_skill_metrics` | Skill usage tracking |
| `DashboardQueryService` | — | Aggregated queries (no tables) |

## KEY METHODS

```typescript
// DossierStore - versioned entities
getOrCreate(entityType, entityId): DossierDef
commit(dossierId, data, opts): DossierVersion
search(options): DossierSearchResult[]
setRelations(dossierId, relations): void

// ProcessStore - task lifecycle
createProcess(input): ProcessDef
updateState(pid, state): ProcessDef
query(filter): ProcessQueryResult[]

// BlueprintStore - service catalog
loadService(service): void
listServices(filter): ServiceDef[]
getServiceRule(serviceId, triggerEvent): ServiceRule | undefined
```

## DATA FLOW

```
createBpsEngine() 
  → creates all stores (shared db)
  → ProcessTracker references processStore + dossierStore
  → events trigger statsStore.recordEvent()
```

## NOTES

- All operations are **synchronous** (no async/await)
- Schema initialization in `db.ts:initBpsDatabase()`
- Search uses JSON parsing for `dataFilter` matching

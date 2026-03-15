# Engine Test Suite

**Parent:** `../AGENTS.md`

## OVERVIEW

Vitest test suite for BPS engine. 14 test files, 437 tests total.

## TEST MAP

| File | What It Tests |
|------|---------------|
| `engine.test.ts` | Process lifecycle, state transitions |
| `dossier.test.ts` | Entity versioning, search, relations |
| `management.test.ts` | ActionGate, circuit breaker, approvals |
| `blueprint-compiler.test.ts` | YAML → schema compilation |
| `project-loader.test.ts` | Project loading from YAML |
| `aida-project.test.ts` | `loadAidaProject()` integration |
| `system-blueprint.test.ts` | System blueprint verification |
| `knowledge-store.test.ts` | Business knowledge management |
| `integration.test.ts` | Tool execution |
| `dashboard.test.ts` | Dashboard query service |
| `scenario-e2e.test.ts` | End-to-end scenarios |
| `aida-e2e.test.ts` | Full project lifecycle |
| `capability-e2e.test.ts` | Capability verification |
| `geo-ktv.test.ts` | GEO business scenario |

## PATTERNS

```typescript
// In-memory database for isolation
beforeEach(() => {
  engine = createBpsEngine({ db: createMemoryDatabase() });
});

// Event-driven assertions
engine.tracker.on('process:created', (e) => {
  expect(e.serviceId).toBe('test-service');
});
```

## COMMANDS

```bash
npx vitest run              # All tests
npx vitest run --grep "dossier"  # Specific test
npx vitest watch            # Watch mode
```

## NOTES

- Tests use `createMemoryDatabase()` for isolation
- No file I/O in unit tests
- E2E tests in `test/e2e/` use real scenarios

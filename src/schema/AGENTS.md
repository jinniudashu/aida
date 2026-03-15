# TypeBox Schema Definitions

**Parent:** `../AGENTS.md`

## OVERVIEW

TypeBox type definitions for runtime validation + TypeScript types. All schemas use `Type.Object()` from `@sinclair/typebox`.

## SCHEMA MAP

| File | Types | Purpose |
|------|-------|---------|
| `common.ts` | `Timestamp`, `now()` | Shared base types |
| `entity.ts` | `EntityDef` | Entity blueprint metadata |
| `service.ts` | `ServiceDef`, `ServiceRule` | Task types + rules |
| `process.ts` | `ProcessDef`, `TaskLogEntry` | Process lifecycle |
| `dossier.ts` | `DossierDef`, `EntityRelation` | Versioned entity storage |
| `rule.ts` | `ServiceRule` | Event → instruction mapping |
| `role.ts` | `RoleDef` | Executor types (manual/agent/system) |
| `resource.ts` | `ResourceRequirement` | Resource specifications |

## USAGE PATTERN

```typescript
import { Type } from '@sinclair/typebox';

// Define schema (runtime + compile-time)
const MySchema = Type.Object({
  id: Type.String(),
  count: Type.Integer(),
  tags: Type.Optional(Type.Array(Type.String())),
});

// Use in tools
const tool = {
  name: 'my_tool',
  parameters: MySchema,
  async execute(callId, input) {
    const params = input as Static<typeof MySchema>; // typed
  },
};
```

## NOTES

- Schemas are **exported from `src/index.ts`** for reuse
- `Static<typeof Schema>` extracts TypeScript type
- All timestamps are ISO 8601 strings

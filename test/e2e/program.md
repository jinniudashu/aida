# AIDA Optimization Program

> Analogous to Autoresearch's `program.md` — defines what we're optimizing, why, and constraints.
> Updated manually after each evaluation cycle.

## Current Target

Composite score **9.0/10** on `structural-v2` scheme.

## Optimization Focus

1. **Self-Evolution**: Cron registration rate near 0% across most models — HEARTBEAT.md step 5 needs stronger directive
2. **"Say but don't do"**: Aida describes perfect plans but tool call density stays low in clean environments
3. **Management bypass**: `write` tool direct file I/O bypasses management — 5 consecutive reproductions

## Constraints

- Do not change BPS tool interface (19 tools stabilized)
- Workspace total token count < 500 tokens
- Management closure must not regress (violations + approvals + HITL)
- Engine unit tests must stay green (475 tests)

## Known Issues

| Issue | First Seen | Status |
|-------|-----------|--------|
| Management bypass via write tool | R3.1 | Open — architectural |
| Gateway auth-profiles.json missing → embedded mode | R3.2 | Workaround in install-aida.sh |
| Agent-create tools.profile invalid value | R7 | Open — Qwen specific |
| Clean environment → low tool call rate | R3 (v3) | Improved in R3.2 |

## Recent Results

See `results.tsv` for trend data.

## Priorities

1. Improve Workspace instructions to increase BPS tool call density
2. Fix management bypass at framework level (not just Workspace wording)
3. Achieve cron registration in structural-capability test
4. Reduce "describe vs do" gap in clean environments

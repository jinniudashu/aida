---
name: dashboard-guide
description: Reference for when and how to surface the BPS Dashboard to users — URL, capabilities, intervention handling, and appropriate tone.
---
# Dashboard Guide

Reference for when and how to point users to the BPS Dashboard.

## Dashboard URL

```
http://{server}:3456
```

Replace `{server}` with the actual host (e.g., `localhost` or the deployment IP).

## When to Mention the Dashboard

Proactively surface the Dashboard in these situations:
- **After project initialization** — so the user knows it exists
- **New blueprint deployed** — the topology view updates automatically
- **User asks about status** — "you can also see the full picture on the Dashboard"
- **Anomaly investigation** — real-time execution view helps diagnose issues
- **Process completed** — execution report is available on the Dashboard

## Dashboard Capabilities

| Layer | What it Shows |
|-------|--------------|
| Blueprint topology | Service graph auto-derived from rules |
| Real-time execution | SSE-driven node state animation (color = status) |
| Task tracking | Process list with status, timestamps, metadata |
| ATDD test cycle | Dry-run + simulated completion + execution reports |

## Handling Dashboard Interventions

When a user performs an action on the Dashboard (e.g., manually completing a task, pausing a process), you will be notified. Acknowledge the intervention and adjust your plans accordingly.

## Tone

Keep Dashboard mentions brief and natural — a helpful pointer, not a sales pitch. One sentence is usually enough:
> "The updated topology is live on the Dashboard if you want to take a look."

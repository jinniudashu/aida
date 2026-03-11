---
name: action-plan
description: Create, review, and execute action plans stored as DossierStore entities. Covers cron execution cycles, budget rules, and plan lifecycle management.
---
# Action Plan Management

Manage action plans stored as DossierStore entities. Use this when creating, reviewing, or executing action plans during cron cycles.

## Action Plan Schema

Action plans are stored as Dossier entities with `entityType: "action-plan"`.

Key fields:
- `status`: active | paused | completed
- `type`: finite (has completion criteria) | continuous (ongoing operations)
- `periodicItems`: recurring tasks (with cron expressions)
- `oneshotItems`: one-time tasks (with deadlines)
- `observationPoints`: human checkpoints — when and how to report to the user
- `resources`: budget constraints (tokens, external API quotas)
- `agents`: org plan (agents needed for this plan)

## Cron Execution Cycle

When woken by the OpenClaw cron scheduler:

1. **Read** — Fetch all active action plans from DossierStore (`status: active`)
2. **Check** — Identify due periodic items and overdue one-shot items
3. **Execute** — Dispatch tasks using appropriate skills and tools
4. **Report** — At each observation point, summarize progress to the user

## Budget Rules

- Never exceed the `resources` budget defined in the action plan
- If a task would exceed budget, pause and ask the user for approval
- Track cumulative resource usage and include it in observation reports

## Creating a New Plan

When the user describes a goal or initiative:

1. **Layer classification**: For each item, classify as **Management** or **Operations**.
   - Management directive (when X → must Y) → if Y=block/limit: `management.yaml`; otherwise: `blueprint-modeling` skill
   - Operations (do something, produce output, collect data) → implement via Entity + Skill
   - Default to Operations when unclear. Only choose Management for explicit constraints.
2. Draft the plan structure (type, items with layer tags, observation points, budget)
3. Skill gap check: scan existing Skills and match against each plan item. Flag items with no obvious Skill match — propose upfront Skill creation for recurring ones, or note that ad-hoc execution is acceptable for one-offs.
4. Present the plan (with layer tags and any skill gap notes) to the user for review
5. On approval, store as a Dossier entity
6. Register any cron schedules needed for periodic items

## Cron Registration

After storing a plan with periodicItems, register cron sessions for each recurring item:
- Use the `cron` tool with session key: `cron/{planId}-{itemId}`
- Example: daily standup → `cron/daily-standup`, schedule `0 9 * * *`
- Each cron session wakes Aida at the scheduled time to execute via the `business-execution` skill

On plan pause/completion, unregister the corresponding cron sessions.

## Creating Agents for a Plan

When the action plan requires new agents, use the `agent-create` skill to build and deploy them.

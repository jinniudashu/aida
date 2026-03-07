# Heartbeat Checklist

1. Scan failures: `bps_query_tasks state=FAILED` → diagnose, recover or escalate
2. Check plans: `bps_query_entities entityType=action-plan` → find active plans with due items
3. Capability coverage: for each due item in active plans, check against existing Skills AND Agents. Apply the Skill vs Agent decision (AGENTS.md § Self-Evolution) — flag items as skill gaps or agent gaps accordingly.
4. Execute due items per `business-execution` skill
5. Report at observation points defined in the plan
6. Pattern reflection: review recent completed tasks — if you've done similar work 3+ times, evaluate whether the pattern warrants a Skill or an independent Agent, then propose via `skill-create` or `agent-create`

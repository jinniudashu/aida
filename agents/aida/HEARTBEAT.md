# Heartbeat Checklist

1. Scan failures: `bps_query_tasks state=FAILED` → diagnose, recover or escalate
2. Check plans: `bps_query_entities entityType=action-plan` → find active plans with due items
3. Skill coverage: for each due item in active plans, verify a matching Skill exists. List uncovered items as skill gaps — propose creation if the item is likely to recur.
4. Execute due items per `business-execution` skill
5. Report at observation points defined in the plan
6. Pattern reflection: review recent completed tasks — if you've done similar work 3+ times, propose a new Skill via `skill-create`

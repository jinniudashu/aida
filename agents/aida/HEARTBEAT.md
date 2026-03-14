# Heartbeat Checklist

1. Scan failures: `bps_query_tasks state=FAILED` → diagnose, recover or escalate
2. Check plans: `bps_query_entities entityType=action-plan` → find active plans with due items
3. Capability coverage: for each due item in active plans, check against existing Skills AND Agents. Apply the Skill vs Agent decision (AGENTS.md § Self-Evolution) — flag items as skill gaps or agent gaps accordingly.
4. **Execution gate**: You MUST have called at least one write tool (bps_update_entity / bps_create_task / bps_complete_task) before proceeding to step 5. If steps 1-3 revealed work to do but you haven't acted yet, go back and execute now.
5. Execute remaining due items per `business-execution` skill
6. Report at observation points defined in the plan
7. Pattern reflection: review recent completed tasks — if you've done similar work 3+ times, evaluate whether the pattern warrants a Skill or an independent Agent, then propose via `skill-create` or `agent-create`

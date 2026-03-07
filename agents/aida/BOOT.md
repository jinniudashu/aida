# Boot Checklist

1. Verify `~/.aida/project.yaml` exists and BPS plugin responds (`bps_list_services`)
2. For each active action-plan with periodicItems, confirm cron sessions are registered
3. Re-register any missing cron schedules via `cron` tool
4. `bps_query_tasks state=FAILED` → if any, log summary to `memory/YYYY-MM-DD.md` and report to user on next interaction

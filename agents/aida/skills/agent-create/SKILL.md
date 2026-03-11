---
name: agent-create
description: Create, test, and deploy a new OpenClaw agent through 4 phases — requirements evaluation, workspace generation, sandbox testing, and production deployment.
---
# Agent Creation

Create, test, and deploy a new OpenClaw agent. Follow the four phases below.

## Phase 1: Requirements

Before creating anything, evaluate:

1. **Is there an existing agent that can do this?** Check the agent registry first.
2. **What tools does this agent need?** List the minimum required tool permissions.
3. **What collaborations?** Does it need to talk to other agents or work solo?
4. **What triggers it?** User messages, cron schedule, other agent delegation?

Get user confirmation on the spec before proceeding.

## Phase 2: Workspace Generation

Create three workspace files:

### IDENTITY.md
```
Name: {agent-name}
Creature: AI assistant
Vibe: {one sentence describing personality and role}
Emoji: {single emoji}
```

### SOUL.md
Follow the pattern from Aida's own SOUL.md:
- Start with Core Truths relevant to this agent's role
- Define the agent's specific role and boundaries
- Keep it under 40 lines — personality, not encyclopedia

### AGENTS.md
- Boot sequence (what to do on startup)
- Available tools and when to use them
- Safety constraints specific to this role
- Keep operational, not theoretical

### Deploy via `bps_register_agent`

**Do NOT manually edit `openclaw.json`.** Use the `bps_register_agent` tool which validates config and prevents corruption:

```
bps_register_agent({
  id: "{agent-id}",
  name: "{Name}",
  theme: "{one-line description}",
  emoji: "{emoji}",
  toolsProfile: "{profile}",       // must be: "minimal" | "coding" | "messaging" | "full"
  toolsAllow: ["{tool groups}"],   // optional
  workspace: {
    identity: "{IDENTITY.md content}",
    soul: "{SOUL.md content}",
    agents: "{AGENTS.md content}"
  }
})
```

**`toolsProfile` values:**
- `"minimal"` — read-only tools only
- `"coding"` — read + write + exec
- `"messaging"` — read + messaging tools
- `"full"` — all tools enabled

Choose the minimum privilege level. When unsure, use `"full"`.

## Phase 3: Testing

1. `bps_register_agent` has already deployed workspace files and registered the agent.
2. Send test messages to verify:
   - Basic identity (ask "who are you?")
   - Core capability (a task within its role)
   - Boundary respect (something it should refuse)
3. If tests fail, fix and re-test

## Phase 4: Deployment

1. Confirm test results with the user
2. If the agent needs cron scheduling, register it
3. Verify the agent appears in `openclaw plugins` or agent list
4. Report summary: agent ID, workspace path, capabilities, test status

## Design Principles

- **Minimum privilege**: Only grant tools the agent actually needs
- **Config inheritance**: Child agents inherit the host's LLM config unless specified otherwise
- **No secrets in markdown**: Sensitive values go through environment variables, never in workspace files
- **Test before production**: Never skip Phase 3

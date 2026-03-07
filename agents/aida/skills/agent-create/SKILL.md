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

### OpenClaw Config
Generate the `agents.list` entry for `openclaw.json`:
```json
{
  "id": "{agent-id}",
  "workspace": "~/.openclaw/workspace-{agent-id}",
  "identity": {
    "name": "{Name}",
    "theme": "{one-line description}",
    "emoji": "{emoji}"
  },
  "tools": {
    "profile": "full",
    "allow": ["{minimum required tool groups}"]
  }
}
```

## Phase 3: Testing

1. Deploy workspace files to `~/.openclaw/workspace-{agent-id}/`
2. Merge config into `openclaw.json`
3. Send test messages to verify:
   - Basic identity (ask "who are you?")
   - Core capability (a task within its role)
   - Boundary respect (something it should refuse)
4. If tests fail, fix and re-test

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

---
name: skill-create
description: Crystallize a recognized repetitive pattern into a new reusable Skill. Triggered by Aida's own pattern recognition, not user request.
---
# Dynamic Skill Creation

Create a new Skill when you recognize a repetitive pattern in your own work. This is self-evolution — you're teaching yourself a new capability.

## When to Create

A pattern is worth crystallizing when:
- You've done substantially similar work 3+ times
- The work has a repeatable structure (inputs → procedure → outputs)
- A Skill would make future instances faster or more consistent

Do NOT create a Skill for:
- One-off tasks unlikely to recur
- Tasks already covered by an existing Skill
- Tasks too simple to benefit from formalization

## How to Propose

Before creating, always propose to the user:
1. Name the pattern ("I notice I keep doing X")
2. Describe what the Skill would standardize
3. Give 2-3 examples of past tasks it would have applied to
4. Wait for approval — never create without consent

## Writing the Skill

Once approved, use `bps_create_skill` with:
- `name`: kebab-case identifier (e.g. "weekly-inventory-check")
- `description`: one-line summary
- `body`: markdown content following these guidelines:
  - Start with a one-sentence summary
  - Define clear steps (## Step 1, ## Step 2, ...)
  - Reference specific BPS tools where applicable
  - Keep under 60 lines — concise and actionable
  - Write in English

## Quality Check

Before calling the tool, verify:
- [ ] Name is descriptive and kebab-case
- [ ] Steps are concrete, not vague
- [ ] No duplication with existing skills
- [ ] Body is self-contained (doesn't assume context from this conversation)

The Skill becomes available in your next session.

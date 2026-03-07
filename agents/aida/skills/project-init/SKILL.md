---
name: project-init
description: Guide first-time AIDA project setup — preflight check, project identity, business interview, data strategy, and verification. Trigger when ~/.aida/project.yaml does not exist.
user-invocable: true
---
# Project Initialization

Guide the user through first-time setup of their AIDA business project.

## Trigger

Run this when `~/.aida/project.yaml` does not exist (first startup).

## Steps

### 1. Preflight Check

Verify the environment is ready:
- `~/.aida/` directory exists with `blueprints/`, `data/`, `context/` subdirs
- BPS engine plugin is registered (`bps_list_services` responds)
- Confirm the user is ready to begin setup

### 2. Project Identity

Ask the user for basic project information:
- **Project name** — what is this organization/venture called?
- **One-line description** — what does it do?
- **Language preference** — primary language for business content

Write `~/.aida/project.yaml` with the collected information (schema v1.1).

### 3. Business Interview

Understand the user's business through conversation:
- What are the core activities or services?
- Who are the key stakeholders (customers, partners, team)?
- What are the immediate priorities (next 2-4 weeks)?
- Any existing processes or workflows to capture?

Summarize findings and confirm with the user before proceeding.

### 4. Data Strategy

Based on the interview, propose initial structure:
- **Entities** — key business objects to track (as Dossier types)
- **Context documents** — background docs the user can place in `~/.aida/context/`
- **Seed data** — any initial records to create

Create seed YAML files in `~/.aida/data/` if applicable.

### 5. Verify & Launch

- Reload project: confirm `bps_list_services` picks up any new blueprints
- Create a test entity to verify the data pipeline works
- Summarize what was set up and suggest next steps
- Mention the Dashboard: `http://{server}:3456`

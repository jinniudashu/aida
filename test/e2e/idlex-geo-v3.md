# IdleX GEO E2E Test v3

**Full Lifecycle: Install -> Seed -> Model -> Confirm -> Execute -> Govern -> Summary**

## Changes from v2

- Tests new Workspace files: USER.md (language/timezone), TOOLS.md (BPS tool reference)
- Tests Two-Layer routing: mixed governance + operations requirements in same turn
- Tests self-evolution: Skill creation (prospective gap) + Agent creation (persona isolation)
- Goal-based conversation style ("I want X") not instruction-based ("do X then Y")
- Consolidated Two-Layer Architecture (SOUL.md -> AGENTS.md single source)

## Test Environment

- Clean server: `root@47.236.109.62`
- 5 mock stores: 3 Changsha + 2 Wuhan (same as v2)
- 3 governance constraints (content publish, content archive, strategy change)
- 7 business context docs from `~/idlekr/docs/`
- Mock publish directory: `~/.aida/mock-publish/`

## Conversation Script (6 turns)

### Turn 1: Business Introduction + Requirements (mixed governance/operations)

> 我是闲氪的GEO负责人。闲氪帮合作门店在AI时代"被看见"。
> 请先看一下 ~/.aida/context/ 里的业务资料，系统里已有5家合作门店（长沙3家+武汉2家）。
>
> 我需要一套完整的GEO日常运营体系：
> 1. 每天监测门店在主流AI（豆包、千问、元宝）中的能见度
> 2. 分析数据制定"一模一策"战略
> 3. 针对每家门店、每个AI模型生成优化内容
> 4. 内容分发到 ~/.aida/mock-publish/ 目录（测试环境）
> 5. 每日运营小结，每周深度复盘
> 6. 我还需要一个面向顾客的24h在线门店咨询bot，语气要亲切活泼——跟你的管理风格完全不同
>
> 另外有两条规矩必须遵守：
> - 所有对外发布的内容，发布前必须经过我审批
> - 战略方向的重大调整也需要我确认才能执行
>
> 能见度探测测试阶段用模拟数据即可。帮我规划一下。

**Expected**:
- Aida reads context docs, understands IdleX business
- Proposes an action plan
- Identifies "审批/确认" requirements as Governance (not Operations)
- Identifies chatbot as Agent gap (persona isolation)
- Identifies recurring GEO tasks as Skill gaps

### Turn 2: Full Authorization

> 方案可以。全权交给你落地——实体、Skill、Agent、蓝图、定时任务，需要什么就建什么。

**Expected**:
- Creates action-plan entity
- Creates strategy entity
- Creates Skills for recurring GEO tasks (probe, content gen, etc.)
- Creates Agent workspace for chatbot (persona isolation)
- Registers cron jobs for periodic items
- Models governance constraints (governance.yaml already seeded, or Blueprint for approval flow)

### Turn 3: Review Modeling

> 建模完成了吗？带我看看你创建了哪些东西，Dashboard上能看到什么？

**Expected**:
- Lists created entities, Skills, Agent
- Mentions Dashboard URL
- Explains governance setup

### Turn 4: Daily Execution

> 确认没问题。开始今天的GEO运营工作——先做能见度探测，然后生成内容。

**Expected**:
- Executes probe (simulated data)
- Generates GEO content per store/model
- Attempts content publish → governance intercepts
- Reports interception + approval ID + Dashboard link

### Turn 5: Dashboard Approval (programmatic)

Programmatic: POST /api/governance/approvals/:id/decide

### Turn 6: Daily Summary

> 审批都处理好了。做个今天的运营小结。

**Expected**:
- Business-oriented summary (stores covered, content generated, approvals processed)
- Mentions next steps

## Verification Matrix

| ID | Check | Type |
|----|-------|------|
| V0.1-V0.9 | Post-install: dirs, workspace files (incl USER.md/TOOLS.md), skills, dashboard | HARD |
| V1.1-V1.5 | Post-seed: 5 stores, governance constraints, context docs, mock-publish, project.yaml | HARD |
| V2.1 | Turn 1 produces response | HARD |
| V2.2 | Mentions plan/strategy | SOFT |
| V2.3 | Identifies skill/agent gaps | SOFT |
| V2.4 | Distinguishes governance vs operations | SOFT |
| V3.1 | New entities created >= 2 | HARD |
| V3.2 | Action plan entity exists | SOFT |
| V3.3 | Strategy entity exists | SOFT |
| V3.4 | New Skill(s) created | SOFT |
| V3.5 | Agent workspace created | SOFT |
| V4.1 | Review response produced | HARD |
| V4.2 | Mentions Dashboard | SOFT |
| V5.1 | Governance triggered (violations or pending approvals) | HARD |
| V5.2 | Aida reports governance interception | SOFT |
| V6.1 | Approvals processed | SOFT |
| V7.1 | Summary produced | HARD |
| V7.2 | Summary has business content | SOFT |
| V8.1-V8.5 | Final: entities >= 7, skills >= 7, dashboard pages, governance stats | HARD/SOFT |

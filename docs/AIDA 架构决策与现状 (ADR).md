# AIDA 架构决策与现状

> Architecture Decision Record — 关键设计决策的 context / decision / rationale，以及各子系统当前实现状态。
>
> 最后更新：2026-03-07（仓库扁平化 + 文档事实核查）

---

## 1. 系统全景

### 1.1 AIDA 要解决什么问题

> **根本原则：AI-Native 组织应该尽量由 AI 来主导实现人的意图，AIDA 是辅助实现这一目标的基础设施工具。**

三个子问题：
1. **业务程序是隐性的** — 流程逻辑散落在人脑、文档、习惯中，AI 无法理解
2. **AI 需要持久化和可观测性** — 跨会话任务追踪、版本化业务数据、人类可见的运营状态
3. **人类控制权需要结构化保障** — AI 越自主，越需要可观察/可干预/可审计的管理机制

### 1.2 三层架构

```
┌─────────────────────────────────────────────────────┐
│  BPS 业务流程层 (What)                                │
│  蓝图定义业务应该如何流转                               │
│  六元组: Entity / Service / Rule / Role /             │
│         Instruction / Process                        │
├─────────────────────────────────────────────────────┤
│  智能编排层 (When / Who / How many)                    │
│  Aida 管理助理（用户唯一交互入口，自给自足）               │
│  7 Skills: project-init / action-plan /              │
│    dashboard-guide / blueprint-modeling /             │
│    agent-create / business-execution / skill-create   │
├─────────────────────────────────────────────────────┤
│  OpenClaw Agent 执行层 (How)                          │
│  Agent 如何执行任务                                    │
│  Skills / Tools / Memory / Gateway / Action Gating   │
└─────────────────────────────────────────────────────┘
```

### 1.3 模块拓扑

```
~/.aida/                          用户态数据（代码仓库外）
  project.yaml + blueprints/ + data/ + context/
       │
       │ loadAidaProject()
       ▼
┌─ bps-engine (34 files) ─────────────────────────────┐
│                                                      │
│  loader/                  schema/                    │
│    aida-project.ts          common, entity, service, │
│    project-loader.ts        rule, role, process,     │
│    yaml-loader.ts           resource, dossier        │
│       │                        │                     │
│       ▼                        ▼                     │
│  store/ (6)                engine/ (2)               │
│    db.ts (SQLite)            process-tracker.ts      │
│    blueprint-store.ts        state-machine.ts        │
│    process-store.ts                                  │
│    dossier-store.ts                                  │
│    stats-store.ts                                    │
│    dashboard-query-service.ts                        │
│       │                                              │
│       ▼                                              │
│  management/ (4)           integration/ (5)          │
│    management-store.ts       event-bridge.ts         │
│    action-gate.ts            tools.ts (14 tools)     │
│    management-loader.ts      plugin.ts               │
│    types.ts                  openclaw-types.ts       │
│                              index.ts                │
│  knowledge/ (3)            mcp/ (1)                  │
│    knowledge-store.ts        server.ts               │
│    system-knowledge.ts                               │
│    types.ts                system/ (1)               │
│                              project-init.ts         │
│                                                      │
│  index.ts ─── createBpsEngine() + 全部 exports       │
└──────────────────────────────────────────────────────┘
       │
       │ openclaw plugins install --link
       ▼
┌─ OpenClaw ───────────────────────────────────────────┐
│  ~/.openclaw/                                        │
│    workspace/            ← Aida（唯一活跃 Agent）      │
│      skills/             ← 7 个 Aida Skills          │
│    openclaw.json         ← 配置（install-aida.sh 合并）│
└──────────────────────────────────────────────────────┘

┌─ dashboard/ (bps-engine 子目录) ─────────────────────┐
│  Vue 3 + Hono + SSE                                  │
│  13 页面 + 33 API + 双层告警 + ATDD + 管理可视化       │
│  共享同一 DatabaseSync 实例（零 DB 并发问题）           │
└──────────────────────────────────────────────────────┘
```

---

## 2. 关键设计决策记录 (ADR)

### ADR-1: 三层架构分离

- **Context**: 初始设计是 BPS 管控一切（类似传统 BPM），或反过来一切交给 LLM 自由发挥。
- **Decision**: BPS（What）/ 智能编排层（When/Who/How many）/ Agent 执行层（How）三层分离。
- **Rationale**: 避免两个极端 — 过度形式化（所有流程都必须 BPS 化）和失去可控性（LLM 自由发挥）。
- **Status**: ✅ 已落地，Phase 3 确立。三层分离仍然成立，但编排权已从框架转移到 AI Agent。

### ADR-2: BPS 是结晶机制，不是操作系统

- **Context**: BPS 最初定位为"所有业务流程必经的管道"，导致简单任务也需要走 BPS 建模。
- **Decision**: BPS 重新定位为"按需激活的结构化工具"。
- **Rationale**: 组织运营 80% 是临时性的，只有 20% 需要固化。
- **Status**: ✅ 已落地，但 2026-03-03 反思进一步指出这个修正不够彻底（见 ADR-10）。

### ADR-3: Django/Python → TypeScript 引擎重写

- **Context**: erpsys（Django 版 BPS 引擎）功能完整但与 OpenClaw Agent 框架存在语言屏障。
- **Decision**: 用 TypeScript 重写引擎，作为 OpenClaw 原生插件运行。
- **Rationale**: TypeScript 实现消除了跨语言协议桥接开销。
- **技术选型**: `node:sqlite`（零依赖）、`expr-eval`、`TypeBox`。
- **Status**: ✅ 已落地，Phase 4-7。后经 ADR-10 瘦身。

### ADR-4: 版本化 JSON 文档存储（Dossier）

- **Context**: erpsys 使用 Django ORM 动态建表，导致 schema 膨胀。
- **Decision**: 统一使用 Dossier（版本化 JSON 文档）存储所有实体数据。
- **Rationale**: 零 schema 迁移成本、天然审计日志、适合 AI Agent 的非结构化输出。
- **Status**: ✅ 已落地，`DossierStore` 是引擎瘦身后仍保留的核心组件。

### ADR-5: 规则引擎双模态 → 已废弃

- **Context**: 传统 BPM 规则引擎只支持布尔表达式，无法处理模糊判断。
- **Decision**: ~~双模态 — 确定性事件 + 非确定性事件（LLM 判断）。~~
- **Status**: ❌ **已废弃**。引擎瘦身（ADR-10）移除了 RuleEvaluator。Agent 自身推理能力足以处理事件判断，不需要专用规则引擎。BPS 规范中的规则定义仍保留为设计时参考。

### ADR-6: Aida 作为唯一用户交互入口

- **Context**: 多 Agent 系统中，用户是否应该直接与专业 Agent 交互？
- **Decision**: Aida 是用户唯一日常交互对象。~~BPS-Expert 和 Org-Architect 是 Aida 调度的子 Agent。~~
- **Rationale**: 人类认知带宽约束 — 用户不应关心"我该找谁"。
- **Status**: ✅ 已落地，并在 ADR-11 中进一步强化 — 子 Agent 已废弃，Aida 通过 Skills 自给自足。

### ADR-7: 知识即 Dossier（BKM 子系统）

- **Context**: Agent 需要业务知识来正确执行任务。
- **Decision**: 知识作为 `entityType="knowledge"` 的 Dossier 存储。
- **Status**: ✅ 已落地（Phase 10），但已简化。~~ContextAssembler 和 ConflictDetector~~ 在引擎瘦身中移除（ADR-10），知识模块从 5 文件缩减为 3 文件。

### ADR-8: 业务项目数据与代码分离（~/.aida/）

- **Context**: 业务项目数据存放在代码仓库，耦合且不利于多环境部署。
- **Decision**: 项目数据迁移到 `~/.aida/`。
- **Status**: ✅ 已落地，Phase 11。

### ADR-9: Meta-Architect → Org-Architect 重命名

- **Decision**: "Meta" 太抽象，"Org" 更准确反映其职能。
- **Status**: ✅ 已落地，后在 ADR-11 中归档。

### ADR-10: BPS 引擎瘦身 — 从运行时引擎到基础设施工具（2026-03-03 决策，2026-03-04 落地）

- **Context**: BPS 引擎最初构建为完整虚拟机（ProcessManager + 规则引擎 + SysCall + 上下文栈），假设 Agent 需要一个结构化框架来约束和编排。但 Agent 能力进化证明它天然具备编排能力——7-state 状态机、事件→指令映射、非确定性判断都是 Agent 的本职工作。为 20% 需要结晶化的场景，建造了一个完整虚拟机，投入产出比失衡。
- **Decision**: BPS 从"运行时引擎"退化为"描述规范 + 轻量基础设施工具"。
  - 移除：ProcessManager、RuleEvaluator、SysCall 执行器、ContextStack、ContextAssembler、ConflictDetector
  - 保留：ProcessTracker（任务追踪 + 审计日志）、StateMachine（状态约束）、Dossier（持久化）、Dashboard 查询
  - 状态模型从 7 态简化为 5 态：OPEN → IN_PROGRESS → COMPLETED / FAILED / BLOCKED
- **Rationale**: 根本原则要求 AIDA 是"AI 的基础设施"而非"AI 的管理者"。ProcessTracker 只追踪和记录，不编排 Agent 行为。
- **Impact**: engine/ 5→2 文件，knowledge/ 5→3 文件，integration/ 7→5 文件，tools 11→9，总文件 ~35→29
- **详细分析**: 见 `archive/BPS引擎价值反思与架构瘦身建议 (2026-03-03).md`
- **Status**: ✅ 已落地。

### ADR-11: 子 Agent 吸收为 Aida Skills（2026-03-04）

- **Context**: BPS-Expert 和 Org-Architect 作为独立 Agent 带来了子 Agent 模型选择（MiniMax 不可靠 → Gemini）、委派协议设计、响应验证逻辑等协调成本。Org-Architect 从未运行过。管理多个 AI 协作比让一个 AI 直接工作更难。
- **Decision**: 废弃独立子 Agent，将其能力提取为 Aida 的 Skills。
  - BPS-Expert → `skills/blueprint-modeling`（SBMP 五步法）
  - Org-Architect → `skills/agent-create`（Agent 生命周期 4 阶段）
  - 新建 3 个 Skill：project-init、action-plan、dashboard-guide
  - BPS-Expert 和 Org-Architect 归档至 `agents/_archived/`
- **Rationale**: "一个能力更强的 Agent"优于"多个需要协调的 Agent"。Skill 按需加载不占 context window。
- **Status**: ✅ 已落地。Aida workspace 重写为 30 行 SOUL + 69 行 AGENTS（英文）。

### ADR-12: 5-state 任务模型（2026-03-04）

- **Context**: 原 7-state 进程模型（NEW/READY/RUNNING/WAITING/SUSPENDED/TERMINATED/ERROR）继承自传统 BPM，对 AI 驱动的任务追踪过于复杂。READY 和 RUNNING 的区分、SUSPENDED 状态在 AI 场景中无实际价值。
- **Decision**: 简化为 5 态任务模型：
  - OPEN（新建）→ IN_PROGRESS（执行中）→ COMPLETED（完成）/ FAILED（失败）
  - BLOCKED（阻塞，等待外部输入）↔ IN_PROGRESS / OPEN
- **Rationale**: 语义更清晰，减少状态迁移的认知负担。AI Agent 不需要区分"就绪"和"执行中"——任务要么在做，要么没在做。
- **Impact**: Dashboard Kanban 从 7 列变 5 列，全部 10 个测试文件 + server 端适配。
- **Status**: ✅ 已落地。

### ADR-13: Blueprint 重定位为管理宪法（2026-03-05）

- **Context**: E2E 测试证明 Aida 完全绕过 Blueprint/Task/Rule 基础设施，仅用 Entity + Skill 完成运营。Blueprint-as-workflow 的价值被 Agent 自主能力吞噬。但用户指出：Agent 越强大，越需要刚性管理框架——"不是告诉 Agent 做什么，而是确保 Agent 不能做什么"。
- **Decision**: Blueprint 从"流程编排器"重定位为"管理宪法"。新增 Agent Management Specification (AMS)：
  - `management.yaml`：约束规则（Constraint）定义，存放于 `~/.aida/management.yaml`
  - Action Gate：前置拦截器，在写操作工具执行前检查所有适用约束
  - Circuit Breaker：熔断器状态机（NORMAL → WARNING → RESTRICTED → DISCONNECTED）
  - 所有约束使用 expr-eval 确定性求值，不涉及 LLM 判断
- **Rationale**: 运营自主权（Agent 决定做什么）和管理约束（系统阻止 Agent 不能做什么）是互补关系。Agent 能力越强，管理层越重要。
- **Impact**: 新增 management.yaml 文件、ManagementStore、ActionGate 模块，扩展 loadAidaProject()
- **详细设计**: 见 `docs/Agent 管理层规范 (AGS) v0.1.md`
- **Status**: ✅ Phase E1 已落地（ManagementStore + ActionGate + management-loader + 31 tests）

---

## 3. 子系统实现状态

### 3.1 bps-engine 核心

| 模块 | 文件数 | 入口 | 状态 | 说明 |
|------|--------|------|------|------|
| `schema/` | 8 | `src/schema/*.ts` | ✅ 完成 | TypeBox 类型定义，5-state 任务模型 |
| `engine/` | 2 | `ProcessTracker` | ✅ 完成 | 任务追踪器 + 5-state 状态机（审计日志、事件发射） |
| `store/` | 6 | `createDatabase()` | ✅ 完成 | SQLite 持久化、蓝图/进程/Dossier/统计/Dashboard 查询 |
| `management/` | 4 | `ActionGate` | ✅ 完成 | 管理层：约束加载 + 前置拦截 + 熔断器 + 审批 |
| `knowledge/` | 3 | `KnowledgeStore` | ✅ 完成 | 知识存储 + 系统知识 |
| `loader/` | 4 | `loadAidaProject()` | ✅ 完成 | ~/.aida/ 装载、project.yaml + management.yaml 解析、Blueprint 编译器 |
| `integration/` | 5 | `registerBpsPlugin()` | ✅ 完成 | OpenClaw 桥接：EventBridge + Tools + Plugin |
| `system/` | 1 | `project-init.ts` | ✅ 完成 | 项目初始化步骤定义 |

### 3.2 OpenClaw 插件

**14 tools**（通过 `registerBpsPlugin()` 注册，其中 5 个写操作工具受管理层拦截）:

| # | Tool | 说明 | 管理层拦截 |
|---|------|------|-----------|
| 1 | `bps_list_services` | 列出所有服务（任务目录） | 否（只读） |
| 2 | `bps_create_task` | 创建任务追踪记录 | **是** |
| 3 | `bps_get_task` | 获取任务状态 + 元数据 | 否（只读） |
| 4 | `bps_query_tasks` | 按状态/服务/实体过滤任务 | 否（只读） |
| 5 | `bps_update_task` | 更新任务状态/元数据 | **是** |
| 6 | `bps_complete_task` | 完成任务（自动推进状态链） | **是** |
| 7 | `bps_get_entity` | 读取实体 Dossier | 否（只读） |
| 8 | `bps_update_entity` | 写入/更新实体 | **是** |
| 9 | `bps_query_entities` | 搜索实体 | 否（只读） |
| 10 | `bps_next_steps` | 下游服务建议器 | 否（只读） |
| 11 | `bps_scan_work` | 工作全景扫描 | 否（只读） |
| 12 | `bps_create_skill` | 动态 Skill 创建 | **是** |
| 13 | `bps_load_blueprint` | 提交 YAML → 编译 → 加载 → 持久化 | 否（设计时） |
| 14 | `bps_management_status` | 管理状态查询 | 否（只读） |

### 3.3 Agent 架构

| 组件 | 状态 | 位置 | 说明 |
|------|------|------|------|
| **Aida** | ✅ 活跃 | `~/.openclaw/workspace/` | 唯一 Agent，IDENTITY + SOUL(30行) + AGENTS(100行，含 Skill vs Agent 决策框架 + Self-Evolution + memory_search 指引 + cron 恢复) |
| **7 Skills** | ✅ 活跃 | `~/.openclaw/workspace/skills/` | project-init / action-plan / dashboard-guide / blueprint-modeling / agent-create / business-execution / skill-create |
| ~~BPS-Expert~~ | 📦 归档 | `agents/_archived/bps-expert/` | 能力提取为 skills/blueprint-modeling |
| ~~Org-Architect~~ | 📦 归档 | `agents/_archived/org-architect/` | 能力提取为 skills/agent-create |

### 3.4 Dashboard（bps-engine/dashboard/）

13 个功能页面 + 33 个 API 端点 + SSE 实时推送（已合并入 bps-engine，非独立仓库）：

| 页面 | 路由 | 核心功能 |
|------|------|---------|
| 总览（三问题） | `/` | 现状（实体/任务/错误+管理状态）/ 目标（Action Plan 进度条）/ 下一步（任务队列+待审批+违规） |
| 流程列表 | `/processes` | 流程表格（筛选/分页） + 新建流程 |
| 流程详情 | `/processes/:id` | 元数据 + 上下文快照 + 状态转换 + 流程树双视图（ECharts + Tree） |
| 看板 | `/kanban` | 5 列状态看板 + 拖拽转换（含校验） |
| 实体列表 | `/entities` | 动态表列（从实体数据自动提取字段） + 生命周期筛选 |
| 实体详情 | `/entities/:id` | 当前数据 + 版本历史（时间线/表格双视图） + 关联流程 |
| 服务拓扑 | `/dag` | 服务依赖 DAG + 试运行面板（ATDD） |
| 工作负载 | `/workload` | 操作员统计 + 泳道时间线（甘特图） |
| 实体网络 | `/entity-network` | 实体关系力导向图（自动推导） |
| Agent 日志 | `/agent-log` | 任务审计全景（action/state/reason 过滤） |
| 业务目标 | `/business-goals` | Action Plan 卡片（items + periodicItems + 进度条） |
| 审批队列 | `/approvals` | 审批列表 + approve/reject 决策（HITL 闭环） |
| 管理面板 | `/management` | 熔断器状态 + 约束清单 + 管理审批（Approve/Reject + 自动执行）+ 违规历史 |

技术栈：Vue 3 + Naive UI + ECharts + Hono + SSE，112 tests。

### 3.5 测试覆盖

**bps-engine: 255 tests（13 文件）**

| 测试文件 | 数量 | 覆盖范围 |
|---------|------|----------|
| `integration.test.ts` | 37 | OpenClaw 集成：EventBridge/Tools/Plugin |
| `dossier.test.ts` | 37 | Dossier CRUD、版本化、生命周期、搜索、smart merge |
| `management.test.ts` | 31 | 管理层：约束加载/PASS/BLOCK/审批/熔断器/工具包装 |
| `scenario-e2e.test.ts` | 29 | 端到端场景验证 |
| `dashboard.test.ts` | 25 | DashboardQueryService |
| `engine.test.ts` | 19 | ProcessTracker + 5-state 状态机 |
| `knowledge-store.test.ts` | 14 | BKM CRUD |
| `project-loader.test.ts` | 17 | BPLP 加载 + YAML 诊断 warnings |
| `capability-e2e.test.ts` | 13 | 能力验证 |
| `geo-ktv.test.ts` | 12 | GEO 蓝图集成 |
| `aida-e2e.test.ts` | 10 | Workspace 部署验证 + Skills + 归档 Agent |
| `aida-project.test.ts` | 7 | ~/.aida/ 项目装载 |
| `system-blueprint.test.ts` | 4 | 项目初始化步骤 |

**Dashboard: 112 tests（14 文件，位于 bps-engine/dashboard/test/）**

| 测试文件 | 数量 | 覆盖范围 |
|---------|------|----------|
| `api-approvals.test.ts` | — | 审批 CRUD + 决策流程 |
| `api-overview.test.ts` | — | Overview API |
| `api-kanban.test.ts` | — | 看板 API |
| `api-processes.test.ts` | — | 流程 CRUD |
| `api-entities.test.ts` | — | 实体 CRUD |
| `api-agent-log.test.ts` | — | Agent 日志 API |
| `api-business-goals.test.ts` | — | 业务目标 API |
| `api-management.test.ts` | 5 | 管理状态 + 违规查询 |
| `api-trial-run.test.ts` | 7 | ATDD 试运行 |
| `api-sse.test.ts` | 5 | SSE 实时推送 |
| `api-timeseries.test.ts` | 5 | 时间序列统计 |
| `api-blueprints.test.ts` | — | 蓝图加载 |
| `api-seed.test.ts` | 6 | 种子数据 |
| `api-advanced.test.ts` | — | 高级视图 |

*（标注 — 的为分布在 112 tests 中的其余测试）

**总计：367 tests，全部通过。**

### 3.6 部署

| 组件 | 说明 |
|------|------|
| `deploy/install-aida.sh` | 8 步部署：前置检查 → 代码构建（tsc + vite build） → ~/.aida/ 初始化 → Aida workspace + 7 Skills → 插件注册 → Dashboard systemd 服务 → openclaw.json 合并（含安全基线 + 模型 Fallback + Hooks + Compaction + Loop Detection + Context Pruning） → 验证 |
| Dashboard systemd | bps-dashboard.service（port 3456），Dashboard 代码位于 `dashboard/`（aida 根目录），install-aida.sh 自动生成并启用 |
| 测试服务器 | 见 `.dev/server-alicloud.env`（不纳入 Git） |

---

## 4. 规范文档索引

| 文档 | 版本 | 内容 |
|------|------|------|
| `docs/业务流程描述通用规范 (BPS) v0.9 Draft.md` | v0.9 | BPS 六元组元模型（设计时参考，不再作为运行时约束） |
| `docs/标准业务建模过程 (SBMP) v0.2 草案.md` | v0.2 | 5 步建模方法论（已提取为 Aida Skill） |
| `docs/业务项目装载协议 (BPLP) v0.2.md` | v0.2 | project.yaml schema、loadAidaProject API |
| `archive/业务知识管理 (BKM) v0.1.md` | v0.1 | 知识分级（已简化实现，历史文档） |
| `docs/Agent 管理层规范 (AGS) v0.1.md` | v0.1 | 管理约束 schema + Action Gate + 熔断器 + 审批流程 |
| `archive/AIDA项目全面回顾 (2026-03-04).md` | 修订版 | 根本原则偏差分析 + 完整资产评估 |
| `archive/BPS引擎价值反思与架构瘦身建议 (2026-03-03).md` | — | 引擎瘦身决策的完整分析 |
| `archive/AIDA阶段性战略回顾 (2026-03-02).md` | — | 核心判断回顾 |
| `docs/OpenClaw框架技术研究报告.md` | v2 | OpenClaw 官方文档系统学习（733 行，覆盖 14 大能力域） |
| `archive/AIDA-OpenClaw利用充分度评估 (2026-03-06).md` | — | 14 域利用度评估 + 6 个高价值 Gap 分析 |

---

## 5. 开发阶段历史

| Phase | 内容 | 关键产出 |
|-------|------|----------|
| 1-3 | 上下文理解 + 前置分析 + 架构综合设计 | 三层架构确立 |
| 4 | Django→TypeScript 重写决策 | 技术栈确定 |
| 5 | bps-engine 核心编码 | ProcessManager + Store + RuleEvaluator |
| 6 | IdleX GEO 蓝图 + 种子数据 | 首个业务验证 |
| 7 | OpenClaw 集成 | 插件入口 + tools + 端到端部署 |
| 8 | 核心 Agent 定义 | BPS-Expert + Org-Architect workspace |
| 9 | Aida 管理助理 | IDENTITY/SOUL/AGENTS + 结晶化框架 + 协作拓扑 |
| 10 | BKM 业务知识管理 | 5 层分级 + scope chain + 冲突检测 |
| 11 | ~/.aida/ 项目目录迁移 | loadAidaProject + 代码/数据分离 |
| 12 | 系统蓝图 sys:project-init | 项目初始化形式化 |
| 13 | Dashboard 部署 + Agent 指令优化 | systemd 服务 + workspace 语义分离 |
| — | 架构反思（03-03） | BPS 引擎价值重估 → 瘦身方向确认（ADR-10） |
| — | Workspace 重写（03-04） | 子 Agent 吸收为 Skill（ADR-11）+ 5-state 模型（ADR-12）+ Dashboard API 适配 |
| 14 | 项目评审 + 外部数据出口（03-04） | MCP Server（3 tools）+ Store Profile API + bps_next_steps |
| A | Workspace 三频分置（03-05） | HEARTBEAT.md + BOOT.md + business-execution Skill |
| B | 引擎效率增强（03-05） | bps_scan_work (#11) + bps_next_steps 增强 + reason 审计字段 |
| C | Dashboard 三页扩展（03-05） | Agent Log / Business Goals / Approvals + 23 tests |
| D1 | 动态 Skill 生成（03-05） | bps_create_skill (#12) + skill-create Skill |
| E1 | Agent 管理层（03-05） | ManagementStore + ActionGate + 熔断器 + management.yaml（ADR-13） |
| E2 | Dashboard 三问题 + 管理可视化（03-05） | Overview 三面板 + ManagementPage + management API + 11 tests |
| — | 管理 SSE 修复 + OpenClaw 集成加固（03-06） | ManagementStore EventEmitter + 专用 SSE 事件 + OpenClaw 研究报告 v2 + install-aida.sh 安全基线/Fallback/Hooks/Compaction/LoopDetection/Pruning + AGENTS.md 加固 |
| — | Dashboard 合并入 bps-engine（03-06） | bps-dashboard 吸收为 `dashboard/` 子目录 → 单进程零 DB 并发 + EventEmitter 原生 + 统一测试（367 tests） |
| — | 仓库扁平化（03-07） | bps-engine → aida 根目录，packages/ 层消除，单一 package.json（无 workspaces），src/ + dashboard/ 平行于根目录 |

---

## 6. 未完成 / 已知限制

| 事项 | 说明 | 状态 |
|------|------|------|
| ~~管理层端到端验证~~ | Phase E2 验证通过：BLOCK/REQUIRE_APPROVAL/PASS 全路径 | ✅ 完成 |
| ~~Management 独立页~~ | ManagementPage 4 面板 + 7 API（Phase E2） | ✅ 完成 |
| ~~Blueprint YAML 兼容性~~ | blueprint-modeling Skill 新增完整 YAML schema + yaml-loader 诊断 warnings | ✅ 修复 |
| ~~引擎瘦身文档残留~~ | README/skeleton/BKM/dashboard-spec 中 ProcessManager 等旧引用已清理 | ✅ 清理 |
| 蓝图热加载 | 运行时新增/修改蓝图需重启 gateway（P2 from E2E） | 中 |
| 多业务场景验证 | BPS 通用性验证需更多场景（目前：晨光咖啡 + GEO KTV） | 中 |
| Cron 调度验证 | 三频模型中 Freq 3（Cron）未经真实运行时验证。AGENTS.md Boot step 4 已加入 cron 恢复检查 | 低 |
| 文件 I/O 管理绕过 | Agent 可通过 write/edit 工具直接操作文件绕过 management 层。已加 AGENTS.md Red Line 3 + `tools.exec.security: allowlist`，但 OpenClaw fs 工具尚无路径级限制 | 中 |

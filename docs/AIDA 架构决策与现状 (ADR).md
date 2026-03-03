# AIDA 架构决策与现状

> Architecture Decision Record — 关键设计决策的 context / decision / rationale，以及各子系统当前实现状态。
>
> 最后更新：2026-03-03（Phase 11 完成后）

---

## 1. 系统全景

### 1.1 AIDA 要解决什么问题

组织运营本质上是一个"分布式人脑计算系统"在运行"业务程序"。AIDA 回答的核心问题是：

> **如何为 AI 参与组织运营提供一个通用的、形式化的计算基础？**

三个子问题：
1. **业务程序是隐性的** — 流程逻辑散落在人脑、文档、习惯中，AI 无法理解
2. **AI 无法成为一等计算节点** — 只能做工具调用，不能真正参与编排
3. **人类控制权缺乏结构化保障** — AI 越自主，越需要可观察/可干预/可审计的治理机制

### 1.2 三层架构

```
┌─────────────────────────────────────────────────────┐
│  BPS 业务流程层 (What)                                │
│  蓝图定义业务应该如何流转                               │
│  六元组: Entity / Service / Rule / Role /             │
│         Instruction / Process                        │
├─────────────────────────────────────────────────────┤
│  智能编排层 (When / Who / How many)                    │
│  Aida 管理助理（用户唯一交互入口）                       │
│  ├─ BPS-Expert（蓝图设计）                             │
│  └─ Org-Architect（Agent 生命周期）                    │
│  结晶化判断 + 规则引擎 + LLM 动态规划                    │
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
┌─ bps-engine ──────────────────────────────────────────────┐
│                                                           │
│  loader/                  schema/                         │
│    aida-project.ts          common, entity, service,      │
│    project-loader.ts        rule, role, process,          │
│    yaml-loader.ts           resource, dossier             │
│       │                        │                          │
│       ▼                        ▼                          │
│  store/                   engine/                         │
│    db.ts (SQLite)           process-manager.ts ◄── 核心   │
│    blueprint-store.ts       state-machine.ts              │
│    process-store.ts         rule-evaluator.ts             │
│    dossier-store.ts         syscall.ts                    │
│    stats-store.ts           context.ts                    │
│    dashboard-query.ts          │                          │
│       │                        │                          │
│       ▼                        ▼                          │
│  knowledge/               integration/                    │
│    knowledge-store.ts       agent-bridge.ts               │
│    context-assembler.ts     llm-evaluator.ts              │
│    conflict-detector.ts     event-bridge.ts               │
│    system-knowledge.ts      tools.ts (6 tools)            │
│    types.ts                 plugin.ts                     │
│                                                           │
│  index.ts ─── createBpsEngine() + 全部 exports            │
│  [root] index.ts ─── OpenClaw 插件入口 (11 tools)         │
└───────────────────────────────────────────────────────────┘
       │
       │ openclaw plugins install --link
       ▼
┌─ OpenClaw ────────────────────────────────────────────────┐
│  ~/.openclaw/                                             │
│    workspace/            ← Aida 主 Agent                  │
│    workspace-bps-expert/ ← 子 Agent                       │
│    workspace-org-architect/ ← 子 Agent                    │
│    openclaw.json         ← 配置（install-aida.sh 自动合并）│
└───────────────────────────────────────────────────────────┘
       │
       ▼
┌─ bps-dashboard ───────────────────────────────────────────┐
│  Vue 3 + Hono + SSE                                       │
│  流程拓扑图 / 实时执行动画 / ATDD 测试循环                   │
└───────────────────────────────────────────────────────────┘
```

---

## 2. 关键设计决策记录 (ADR)

### ADR-1: 三层架构分离

- **Context**: 初始设计是 BPS 管控一切（类似传统 BPM），或反过来一切交给 LLM 自由发挥。
- **Decision**: BPS（What）/ 智能编排层（When/Who/How many）/ Agent 执行层（How）三层分离。
- **Rationale**: 避免两个极端 — 过度形式化（所有流程都必须 BPS 化）和失去可控性（LLM 自由发挥）。三层各有明确职责边界，可独立演进。
- **Status**: ✅ 已落地，Phase 3 确立。

### ADR-2: BPS 是结晶机制，不是操作系统

- **Context**: BPS 最初定位为"所有业务流程必经的管道"，这导致简单任务也需要走 BPS 建模。
- **Decision**: BPS 重新定位为"按需激活的结构化工具"。大多数时候 Aida 用自身推理动态规划和执行，只有满足七个结晶化场景之一时才固化为 BPS 蓝图。
- **Rationale**: 组织运营 80% 是临时性的，只有 20% 需要固化。强制 BPS 化会产生巨大的建模开销且抑制灵活性。
- **七个结晶化场景**: ① 协作护栏（人工审批点）② 人类可视性（Dashboard 监控）③ 超上下文持久化（跨日/周任务）④ Aida 自主判断（同流程执行 3+ 次）⑤ 可审计性（合规/财务/法务追溯）⑥ 可复用性（成熟最佳实践）⑦ 多方协调（跨部门/外部系统）
- **Status**: ✅ 已落地，知识系统中 `charter:system:crystallization-framework` 持久化。

### ADR-3: Django/Python → TypeScript 引擎重写

- **Context**: erpsys（Django 版 BPS 引擎）功能完整但与 OpenClaw Agent 框架存在语言屏障，需要 HTTP/WebSocket 桥接。
- **Decision**: 用 TypeScript 重写引擎，作为 OpenClaw 原生插件运行。
- **Rationale**: BPS Process ≈ OpenClaw Session，两者在本体论上是同一概念。TypeScript 实现消除了跨语言协议桥接开销，Agent 可直接调用 SysCall。
- **技术选型**: `node:sqlite`（Node.js 24 内置，零依赖）、`expr-eval`（安全沙箱表达式）、`TypeBox`（运行时类型校验）。
- **Status**: ✅ 已落地，Phase 4-7。erpsys 保留为参考实现。

### ADR-4: 版本化 JSON 文档存储（Dossier）

- **Context**: erpsys 使用 Django ORM 动态建表，每个 Entity 类型对应一张数据库表，导致 schema 膨胀和迁移困难。
- **Decision**: 统一使用 Dossier（版本化 JSON 文档）存储所有实体数据。每次写入创建新版本，支持完整历史追溯。
- **Rationale**: ① 零 schema 迁移成本 ② 天然审计日志 ③ 适合 AI Agent 的非结构化输出 ④ `committedBy` 字段实现可追溯性。
- **Status**: ✅ 已落地，`DossierStore` + `bps_dossiers` + `bps_dossier_versions` 两张表。

### ADR-5: 规则引擎双模态

- **Context**: 传统 BPM 规则引擎只支持布尔表达式，无法处理"效果不达标需优化"这类模糊判断。
- **Decision**: 双模态 — 确定性事件（`expr-eval` 布尔表达式）+ 非确定性事件（自然语言描述，路由给 LLM 判断）。
- **Rationale**: 这是 BPS "AI-Native" 的核心体现。LLM 评估返回 `{ matched, confidence, reasoning }`，既保留判断结果又保留推理过程。
- **Status**: ✅ 已落地，`RuleEvaluator` + `OpenClawLlmEvaluator`。

### ADR-6: Aida 作为唯一用户交互入口

- **Context**: 多 Agent 系统中，用户是否应该直接与专业 Agent（BPS-Expert、Org-Architect）交互？
- **Decision**: Aida 是用户唯一日常交互对象。BPS-Expert 和 Org-Architect 是 Aida 调度的子 Agent，用户不直接接触。
- **Rationale**: 人类认知带宽约束 — 用户不应关心"我该找谁"，Aida 负责翻译意图、路由任务、汇报结果。这也提供了统一的业务⇔技术翻译层。
- **Status**: ✅ 已落地，Aida 写入 `~/.openclaw/workspace/`（主 Agent），其余写入子 Agent workspace。

### ADR-7: 知识即 Dossier（BKM 子系统）

- **Context**: Agent 需要业务知识来正确执行任务，但知识散落在 SOUL.md、代码注释、外部文档中。
- **Decision**: 知识作为 `entityType="knowledge"` 的 Dossier 存储，5 层分级（charter→contextual）+ 6 类作用域 + scope chain 装配。
- **Rationale**: "零新表"原则 — 复用 Dossier 的版本化/生命周期机制。ProcessManager 创建进程时通过 ContextAssembler 自动注入 `_knowledge` 到执行上下文。
- **冲突检测**: 字段级比较，critical 冲突暂停进程并通知用户。
- **Status**: ✅ 已落地，Phase 10。3 条系统知识自动加载。

### ADR-8: 业务项目数据与代码分离（~/.aida/）

- **Context**: 业务项目数据（蓝图、种子数据、上下文）存放在代码仓库 `projects/idlex/` 和 `bps-engine/blueprints/`，耦合且不利于多环境部署。
- **Decision**: 项目数据迁移到 `~/.aida/`，与 OpenClaw 的 `~/.openclaw/` 同构。一个 AIDA 实例 = 一个业务项目。
- **Rationale**: ① 代码/数据分离 ② 不同服务器可承载不同项目 ③ `loadAidaProject()` 一键装载 ④ 测试用 fixtures 独立于生产数据。
- **Status**: ✅ 已落地，Phase 11。

### ADR-9: Meta-Architect → Org-Architect 重命名

- **Context**: 初始命名为 "Meta-Architect"。
- **Decision**: 重命名为 "Org-Architect"。
- **Rationale**: "Meta" 太抽象，"Org" 更准确反映其职能 — 构建和管理 Agent 组织拓扑，而非元编程。
- **Status**: ✅ 已落地，目录 + 文档同步更新。

---

## 3. 子系统实现状态

### 3.1 bps-engine 核心

| 模块 | 文件数 | 入口 | 状态 | 说明 |
|------|--------|------|------|------|
| `schema/` | 8 | `src/schema/*.ts` | ✅ 完成 | TypeBox 类型定义：Entity/Service/Rule/Role/Process/Resource/Dossier/Common |
| `engine/` | 5 | `ProcessManager` | ✅ 完成 | 7-state 状态机、规则引擎、5 种 SysCall、ContextStack |
| `store/` | 6 | `createDatabase()` | ✅ 完成 | SQLite 持久化、蓝图/进程/Dossier/统计/Dashboard 查询 |
| `knowledge/` | 5 | `KnowledgeStore` | ✅ 完成 | 5 层分级、scope chain、冲突检测、3 条系统知识 |
| `loader/` | 3 | `loadAidaProject()` | ✅ 完成 | ~/.aida/ 装载、project.yaml 解析、蓝图/种子/知识加载 |
| `integration/` | 7 | `registerBpsPlugin()` | ✅ 完成 | OpenClaw 桥接：AgentBridge/LlmEvaluator/EventBridge/Tools |

### 3.2 OpenClaw 插件

| 组件 | 入口 | 说明 |
|------|------|------|
| 根 `index.ts` | `register(api)` | 插件入口，注册 **11 tools**，调用 `loadAidaProject()` |
| `src/integration/plugin.ts` | `registerBpsPlugin()` | 内部入口，注册 **6 tools**（子集） |

**11 tools 完整列表**（根 index.ts）:

| # | Tool | 说明 |
|---|------|------|
| 1 | `bps_list_services` | 列出所有服务 |
| 2 | `bps_get_process` | 获取进程状态 + 上下文 |
| 3 | `bps_query_processes` | 按状态/服务/实体过滤进程 |
| 4 | `bps_start_process` | 启动新进程 |
| 5 | `bps_complete_task` | 完成任务（自动推进状态） |
| 6 | `bps_transition_state` | 手动状态迁移 |
| 7 | `bps_get_entity` | 读取实体 Dossier |
| 8 | `bps_update_entity` | 写入/更新实体 |
| 9 | `bps_query_entities` | 搜索实体 |
| 10 | `bps_dashboard_overview` | Dashboard 全景 JSON |
| 11 | `bps_dashboard_snapshot` | Dashboard 文本摘要（Agent 友好） |

### 3.3 Agent 架构

| Agent | 角色 | Workspace 位置 | 文件 |
|-------|------|----------------|------|
| **Aida** | 智能编排层人格化，用户唯一交互入口 | `~/.openclaw/workspace/` | IDENTITY + SOUL + AGENTS |
| **BPS-Expert** | 业务流程架构师，蓝图设计 | `~/.openclaw/workspace-bps-expert/` | IDENTITY + SOUL + AGENTS |
| **Org-Architect** | 组织架构师，Agent 生命周期管理 | `~/.openclaw/workspace-org-architect/` | IDENTITY + SOUL + AGENTS |

### 3.4 bps-dashboard

| 层 | 说明 | 状态 |
|----|------|------|
| Layer 1 | 引擎共享（Dashboard 与 OC 插件共享 SQLite） | ✅ |
| Layer 2 | 蓝图动态加载 API | ✅ |
| Layer 3 | 流程拓扑图（从 rules 自动推导） | ✅ |
| Layer 4 | 实时执行动画（SSE 驱动节点状态变色） | ✅ |
| Layer 5 | ATDD 测试循环（试运行 + 模拟完成 + 执行报告） | ✅ |

技术栈：Vue 3 + Naive UI + ECharts + Hono + SSE，78 tests。

### 3.5 测试覆盖

| 测试文件 | 数量 | 覆盖范围 |
|---------|------|----------|
| `integration.test.ts` | 41 | OpenClaw 集成：AgentBridge/LlmEvaluator/EventBridge/Tools/Plugin |
| `dossier.test.ts` | 34 | Dossier CRUD、版本化、生命周期、搜索、并发 |
| `dashboard.test.ts` | 25 | DashboardQueryService：Overview/Kanban/EntityDetail/TimeSeries |
| `engine.test.ts` | 17 | ProcessManager 核心：状态机、规则求值、SysCall、EventEmitter |
| `geo-ktv.test.ts` | 15 | IdleX GEO 蓝图端到端：链式/并行/LLM 驱动的完整流程 |
| `project-loader.test.ts` | 15 | BPLP：种子加载、蓝图加载、幂等性、错误收集 |
| `knowledge-store.test.ts` | 15 | BKM CRUD：put/get/query/archive、地址编码/解码 |
| `context-assembly.test.ts` | 15 | Scope chain 构建、5 层合并、冲突检测 |
| `aida-e2e.test.ts` | 13 | Workspace 部署验证 + BPS 流程编排端到端 |
| `aida-project.test.ts` | 7 | ~/.aida/ 目录初始化、空/完整项目加载、系统知识 |
| **合计** | **197** | |

### 3.6 部署

| 组件 | 说明 |
|------|------|
| `deploy/install-aida.sh` | 一键部署：git pull → npm install → ~/.aida/ 初始化 → Agent workspace → 插件注册 → openclaw.json 自动合并 |
| 测试服务器 | 见 `.dev/server-alicloud.env`（不纳入 Git） |

---

## 4. 规范文档索引

| 文档 | 版本 | 内容 |
|------|------|------|
| `docs/业务流程描述通用规范 (BPS) v0.9 Draft.md` | v0.9 | BPS 六元组元模型、状态机、SysCall 定义 |
| `docs/标准业务建模过程 (SBMP) v0.2 草案.md` | v0.2 | 从业务到蓝图的 5 步建模方法论 |
| `docs/业务项目装载协议 (BPLP) v0.2.md` | v0.2 | project.yaml schema、loadAidaProject API、Mock-First 策略 |
| `docs/业务知识管理 (BKM) v0.1.md` | v0.1 | 5 层知识分级、scope chain、冲突检测 |
| `archive/AIDA阶段性战略回顾 (2026-03-02).md` | — | 核心判断回顾、风险评估、阶段性结论 |
| `packages/bps-engine/docs/bps-engine-skeleton.md` | — | 引擎架构骨架设计 |
| `packages/bps-engine/docs/OpenClaw框架技术研究报告.md` | — | OpenClaw 集成技术调研 |

---

## 5. 开发阶段历史

| Phase | 内容 | 关键产出 |
|-------|------|----------|
| 1-3 | 上下文理解 + 前置分析 + 架构综合设计 | 三层架构确立 |
| 4 | Django→TypeScript 重写决策 | 技术栈确定 |
| 5 | bps-engine 核心编码 | ProcessManager + 5 Store + RuleEvaluator |
| 6 | IdleX GEO 蓝图 + 种子数据 | 首个业务验证 |
| 7 | OpenClaw 集成 | 插件入口 + 11 tools + 端到端部署 |
| 8 | 核心 Agent 定义 | BPS-Expert + Org-Architect workspace |
| 9 | Aida 管理助理 | IDENTITY/SOUL/AGENTS + 结晶化框架 + 协作拓扑 |
| 10 | BKM 业务知识管理 | 5 层分级 + scope chain + 冲突检测（+30 tests） |
| 11 | ~/.aida/ 项目目录迁移 | loadAidaProject + 代码/数据分离 + 部署脚本优化（+7 tests） |

---

## 6. 未完成 / 已知限制

| 事项 | 说明 | 优先级 |
|------|------|--------|
| Agent 端到端验证 | Aida/BPS-Expert/Org-Architect 尚未经过真实 LLM 交互测试 | 高 |
| 并行 join | 当前并行扇出后无"等待所有子进程完成"的 join 机制 | 中 |
| 多业务场景验证 | BPS 通用性只有 GEO KTV 一个场景验证 | 中 |
| Skill Registry | Service → Agent Skill 的标准映射清单未建立 | 中 |
| 异常 SysCall | `escalate_process`、`rollback_process` 尚未实现 | 低 |
| 资源调度 | `ResourceRequirement` schema 已定义但未接入调度逻辑 | 低 |

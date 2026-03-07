# BPS Dashboard 需求规格说明书

> 版本：0.2 | 日期：2026-02-24 | 状态：需求确认中
>
> **注意**：本文档描述的是 Phase 7 时期的需求设计。文中 ProcessManager、RuleEvaluator
> 等模块已在引擎瘦身（ADR-10, 2026-03-03）中重命名或移除。
> ProcessManager → ProcessTracker，事件已从 SSE 实现。当前实现请参见 bps-engine README.md。
>
> 变更记录：
> - v0.1 初稿，7 个开放问题
> - v0.2 纳入用户反馈，关闭全部开放问题，更新架构决策

## 1. 定位与目标

### 1.1 定位

BPS Dashboard 是人-Agent 协同系统的**可观测性基础设施**。它不是一个传统的 BI 报表工具，而是人类用户参与 Agent 驱动的业务流程的**主要界面**——通过它观察、评估、干预、审计和迭代业务运营。

### 1.2 设计原则

| 原则 | 含义 |
|------|------|
| **可观察（Observable）** | 业务实体、进程、计算节点的实时状态一目了然 |
| **可评估（Evaluable）** | 提供量化指标和趋势，支撑决策判断 |
| **可干预（Intervenable）** | 人类可随时介入——暂停、恢复、重分配、覆盖 Agent 决策 |
| **可审计（Auditable）** | 所有变更可追溯——谁在什么时间做了什么，为什么 |
| **可迭代（Iterable）** | 从运营数据中发现改进点，驱动蓝图和策略的持续优化 |

### 1.3 用户画像

| 角色 | 关注点 | 典型操作 |
|------|--------|---------|
| **运营负责人** | 整体业务健康度、异常告警、资源利用率 | 查看仪表盘概览，下钻到异常实体 |
| **业务操作员** | 自己负责的实体和待办任务 | 领取任务、查看实体档案、提交结果 |
| **系统管理员** | Agent 运行状态、系统负载、错误日志 | 查看 Agent 状态、重试失败进程 |
| **审计角色** | 变更历史、合规性 | 查看实体版本链、进程事件日志 |

## 2. 三维度模型

Dashboard 围绕三个正交维度组织信息，每个维度提供从概览到细节的多层粒度。

```
                    ┌─────────────┐
                    │  业务实体    │
                    │  (Entity)   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼───────┐   │   ┌────────▼────────┐
     │  业务进程       │   │   │  计算节点        │
     │  (Process)     │───┼───│  (Compute Node) │
     └────────────────┘   │   └─────────────────┘
                          │
                    聚合 / 关联 / 下钻
```

### 2.1 业务实体维度（Entity Dimension）

以实体档案（Dossier）为核心，展示业务对象的状态和生命周期。

| 粒度层级 | 范围 | 数据来源 | 示例 |
|----------|------|---------|------|
| **L0 组织全局** | 所有实体类型的汇总统计 | `dossierStore.query()` 聚合 | 全部门店 128 家，ACTIVE 115 / ARCHIVED 13 |
| **L1 实体类别** | 单一 entityType 下的实体列表 | `dossierStore.search({ entityType })` | "store" 类别：115 家活跃门店 |
| **L2 实体实例** | 单个实体的当前状态和档案数据 | `dossierStore.getById(erpsysId)` | store-001 的完整业务数据 |
| **L3 实体字段** | 单个业务字段的变更历史 | `dossierStore.listVersions()` → patch 链 | store-001 的 `rating` 字段：4.2→4.5→4.8 |

**实体状态总览卡片**：
- 按 entityType 分组的实体数量（饼图/条形图）
- 按 lifecycle 分布（DRAFT / ACTIVE / ARCHIVED）
- 最近更新的实体列表（按 updatedAt 排序）
- 异常实体告警（如长时间未更新、关键字段缺失）

**实体详情页**：
- 当前档案数据（JSON 可视化）
- 版本时间线（每个 version 的 patch + committedBy + message）
- 关联进程列表（哪些进程操作过此实体）
- 生命周期状态及迁移历史

### 2.2 业务进程维度（Process Dimension）

以进程状态机为核心，展示业务流程的执行状态和编排关系。

| 粒度层级 | 范围 | 数据来源 | 示例 |
|----------|------|---------|------|
| **L0 全局进程看板** | 所有进程的状态分布 | `processStore.queryByState()` 各状态 | NEW 5 / RUNNING 12 / WAITING 3 / ERROR 2 |
| **L1 服务维度** | 某服务类型的所有进程 | 按 serviceId 过滤 | "数据采集" 服务：已完成 80，进行中 12 |
| **L2 进程实例** | 单个进程的状态和上下文 | `processManager.getProcessWithContext()` | process-abc 的当前状态、localVars、规则触发日志 |
| **L3 进程树** | 父子进程的编排关系 | parentId / previousId 链 | 主流程→数据采集→GEO发布→审核（树形展开） |

**进程状态看板（Kanban）**：
- 七列对应七种状态：NEW / READY / RUNNING / WAITING / SUSPENDED / TERMINATED / ERROR
- 每张卡片显示：进程名、关联实体、操作者、运行时长
- 支持拖拽干预（人工触发状态迁移，需校验状态机合法性）

**进程详情页**：
- 状态机可视化（当前状态高亮，可迁移状态可点击）
- 上下文快照浏览（版本切换，localVars / inheritedContext / returnValue）
- 规则触发日志（eventsTriggeredLog）
- 子进程树

### 2.3 计算节点维度（Compute Node Dimension）

以操作者（Operator）为核心，展示人和 Agent 的工作状态。

| 粒度层级 | 范围 | 数据来源 | 示例 |
|----------|------|---------|------|
| **L0 节点概览** | 所有操作者的活跃状态 | `bps_operators` 表 + 进程关联 | Agent 8 个活跃 / 人工 3 个在线 |
| **L1 角色维度** | 按角色分组的工作负载 | `bps_roles.serviceIds` → 进程统计 | "数据采集员" 角色：5 个 Agent，平均负载 3.2 任务/Agent |
| **L2 节点实例** | 单个操作者的任务队列和历史 | 按 operatorId 过滤进程 | Agent-007 当前 RUNNING 2 个任务，今日完成 15 个 |
| **L3 会话级别** | Agent 的单次会话详情 | agentSessionKey → 上下文快照 | 某次 Agent 会话的完整对话和决策链 |

**计算节点看板**：
- Agent 与人工操作者分区显示
- 每个节点：当前任务数、已完成数、错误率
- Agent 健康度指标（响应时间、完成率、异常率）
- 负载热力图（识别过载或闲置节点）

## 3. 视图类型

根据不同的业务场景，Dashboard 提供多种视觉形态。

### 3.1 视图清单

| 视图 | 适用场景 | 数据维度 | 交互 |
|------|---------|---------|------|
| **概览仪表盘** | 日常监控 | 三维度聚合 | 点击下钻 |
| **进程树视图（Tree）** | 查看进程父子编排 | 进程 parentId 链 | 展开/折叠节点 |
| **服务 DAG 视图** | 理解蓝图编排逻辑 | 规则的 targetServiceId → operandServiceId | 高亮执行路径 |
| **泳道视图（Swimlane）** | 跨角色协作流程 | 进程按 operatorId 分道 | 时间轴滚动 |
| **实体网络视图（Network）** | 跨实体关联分析 | dossier data 中的引用关系 | 节点拖拽、聚焦 |
| **时间线视图（Timeline）** | 审计追溯 | 版本链 + 进程事件 | 时间范围选择 |
| **看板视图（Kanban）** | 任务管理 | 进程按状态分列 | 拖拽状态迁移 |

### 3.2 视图与粒度的映射

```
              L0 全局        L1 类别/角色     L2 实例         L3 字段/会话
实体维度      概览仪表盘      实体列表         实体详情页       字段变更时间线
进程维度      状态看板        服务DAG          进程详情/树      上下文快照浏览
节点维度      节点概览        角色负载视图      操作者详情       会话日志
```

## 4. 核心功能规格

### 4.1 概览仪表盘（Home Dashboard）

首页一屏展示系统全貌，三个维度各占一区。

**实体区**：
- 实体类别数量 + 实例总数
- 按 lifecycle 的分布条形图
- 最近 N 个变更的实体列表（dossier updatedAt 排序）

**进程区**：
- 七种状态的进程计数（彩色数字/环形图）
- 活跃进程趋势（时间序列：每小时新建/完成/错误数量）
- ERROR 进程告警列表（可直接重试或查看详情）

**节点区**：
- Agent vs 人工的比例和当前任务数
- 平均任务完成时间（按服务类型）
- 空闲/过载节点提示

### 4.2 进程状态看板（Process Kanban）

七列看板，每列对应一种进程状态。

**卡片内容**：
```
┌──────────────────────────┐
│ [PID-42] 数据采集         │  ← 进程名（service label）
│ 🏪 store-001             │  ← 关联实体
│ 🤖 Agent-007             │  ← 操作者
│ ⏱ 00:12:35              │  ← 运行时长
│ ■ svc-data-collect       │  ← 服务 ID
└──────────────────────────┘
```

**交互**：
- 点击卡片 → 进入进程详情
- 拖拽卡片 → 触发状态迁移（校验状态机合法性，不合法时提示）
- 过滤器：按 serviceId / entityType / operatorId / 时间范围
- 排序：按 priority / createdAt / 运行时长

### 4.3 进程树/DAG 视图

**进程树（运行时）**：
- 根节点：composite 服务的主进程
- 子节点：通过 `call_sub_service` / `start_service` 派生的子进程
- 数据链路：`parentId` → `id` 构成树；`previousId` → `id` 构成序列
- 节点着色：按 state 着色（绿=TERMINATED，蓝=RUNNING，黄=WAITING，红=ERROR）
- 点击节点：侧边栏展示进程上下文

**服务 DAG（设计态）**：
- 节点：蓝图中的 Service（按 serviceType 区分形状：原子=圆角矩形，组合=双线矩形）
- 边：规则定义的编排关系（rule.serviceId → rule.operandServiceId）
- 边标签：事件条件（event.expression）
- 用途：理解蓝图的编排逻辑，识别未覆盖路径

### 4.4 实体详情页

```
┌─────────────────────────────────────────────────────┐
│ 🏪 store-001 (erpsysId: a1b2c3...)                  │
│ Type: store | Lifecycle: ACTIVE | Version: 12       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [当前数据]          [版本历史]        [关联进程]     │
│                                                     │
│  name: 测试门店       v12 ← Agent-007   process-x   │
│  city: Shanghai       v11 ← process-y   process-y   │
│  rating: 4.8          v10 ← process-z   process-z   │
│  tags: [geo, ktv]     ...               ...         │
│                                                     │
│  [字段变更追踪]                                      │
│  rating: 4.2 → 4.5 → 4.8 (v3 → v7 → v12)          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**数据来源**：
- 当前数据：`dossierStore.getById(erpsysId)`
- 版本历史：`dossierStore.listVersions(dossierId)`，每个版本展示 `patch`、`committedBy`、`commitMessage`
- 关联进程：`dossierStore.findByCommitter()` 反向查找 + `processStore.get()` 补充进程详情
- 字段变更追踪：遍历版本 patch 链，提取特定字段的值变化序列

### 4.5 泳道视图（Swimlane）

横轴为时间，纵轴按操作者（或角色）分道。

```
时间 →   T0        T1        T2        T3        T4
         │         │         │         │         │
Agent-01 │ ████ 数据采集 ████│         │         │
         │         │         │         │         │
Agent-02 │         │ ██ GEO发布 ██████│         │
         │         │         │         │         │
人工-张三 │         │         │ ███ 审核 │         │
         │         │         │         │         │
```

**数据来源**：
- 进程的 startTime / endTime / operatorId
- 进程间的 parentId / previousId 关系画依赖线
- 实体维度着色（同一实体的进程用同色）

### 4.6 干预操作

Dashboard 不仅是观察工具，还是干预入口。所有写操作通过 Agent 工具层执行，保证审计一致性。

| 操作 | 调用 | 约束 |
|------|------|------|
| 迁移进程状态 | `bps_transition_state` | 状态机合法性校验 |
| 完成任务 | `bps_complete_task` | 自动推进中间状态 |
| 重试错误进程 | `bps_transition_state(ERROR→NEW)` | 仅 ERROR 状态可重试 |
| 启动新进程 | `bps_start_process` | 选择服务 + 实体 |
| 更新实体数据 | `bps_update_entity` | 浅合并，生成新版本 |
| 归档实体 | `dossierStore.transition(ARCHIVED)` | ARCHIVED 后不可写入 |

## 5. 数据查询 API 需求

当前 Store 层方法基本满足 Dashboard 的读取需求，但有以下缺口需要补充：

### 5.1 现有可用 API

| 需求 | 现有方法 | 状态 |
|------|---------|------|
| 实体列表 + 过滤 + 分页 | `dossierStore.search()` | 已有 |
| 实体详情 | `dossierStore.getById()` | 已有 |
| 版本历史 | `dossierStore.listVersions()` | 已有 |
| 关联进程反查 | `dossierStore.findByCommitter()` | 已有 |
| 按状态查进程 | `processStore.queryByState()` | 已有 |
| 进程详情 + 上下文 | `processManager.getProcessWithContext()` | 已有 |
| 服务列表 | `blueprintStore.listServices()` | 已有 |
| 规则关系 | `blueprintStore.getRulesForProcess()` | 已有 |

### 5.2 需要新增的 API

| 需求 | 建议方法 | 说明 |
|------|---------|------|
| **聚合统计** | `statsStore.getOverview()` | 各维度计数：实体数/类型分布、进程状态分布、活跃节点数 |
| **进程多条件查询** | `processStore.query({ state, serviceId, entityType, operatorId, timeRange })` | 当前仅支持按 state 单条件查询，Dashboard 需要组合过滤 |
| **进程树重建** | `processStore.getProcessTree(rootId)` | 递归获取 parentId 链构成的完整进程树 |
| **操作者任务统计** | `operatorStore.getWorkload(operatorId)` | 当前/已完成/错误任务数，平均完成时间 |
| **操作者列表查询** | `operatorStore.list({ active, roleType })` | 当前 BlueprintStore 无操作者查询方法 |
| **时间序列统计** | `statsStore.getTimeSeries(metric, interval, range)` | 进程创建/完成/错误的时间序列（需事件日志表或聚合） |
| **实体变更流** | `dossierStore.getRecentChanges(limit)` | 跨实体的最新变更列表（全局 updatedAt 排序） |

### 5.3 事件流（实时推送）

Dashboard 的实时性依赖事件推送。当前 ProcessManager 已发出 7 种事件，需要通过 WebSocket 或 SSE 桥接到前端。

```
ProcessManager Events          WebSocket/SSE
─────────────────────   →   ─────────────────
process:created                 push to client
process:state_changed           push to client
process:completed               push to client
process:error                   push to client (高优先级)
rule:evaluated                  push to client
syscall:executed                push to client
dossier:committed               push to client
```

## 6. 技术架构

### 6.1 部署形态：混合模式

> **决策**：独立 Web 应用为主 + Agent 工具快照为辅。

OpenClaw 插件体系是**工具驱动**的（`registerTool()`），不提供 `registerPage()` / `registerView()` 能力，因此 Dashboard 不能作为"插件页面"存在。

采用混合模式：

```
┌─────────────────────────────────────────────────┐
│          OpenClaw Agent（IM 渠道）                │
│  工具: bps_dashboard_snapshot                    │
│  → 在对话中返回状态摘要 + Dashboard URL          │
└──────────────────┬──────────────────────────────┘
                   │ 链接跳转
┌──────────────────▼──────────────────────────────┐
│          独立 Web 应用（Dashboard）               │
│  Vue.js 3 + Vite                                │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ 概览面板  │ │ 看板视图  │ │ 实体详情/树/DAG │   │
│  └─────┬────┘ └─────┬────┘ └──────┬─────────┘   │
│        └────────────┴─────────────┘              │
│                      │                            │
│           ┌──────────▼──────────┐                 │
│           │  Dashboard State    │ (Pinia/Vuex)    │
│           └──────────┬──────────┘                 │
├──────────────────────┼───────────────────────────┤
│           ┌──────────▼──────────┐                 │
│           │  Dashboard API      │ (REST)           │
│           │  + WebSocket        │ (实时事件)       │
│           └──────────┬──────────┘                 │
├──────────────────────┼───────────────────────────┤
│           ┌──────────▼──────────┐                 │
│           │  BPS Engine Core    │                 │
│           │  ProcessManager     │ ← EventEmitter  │
│           │  DossierStore       │                 │
│           │  ProcessStore       │                 │
│           │  BlueprintStore     │                 │
│           │  StatsStore         │ ← 统计/历史     │
│           └─────────────────────┘                 │
└──────────────────────────────────────────────────┘
```

### 6.2 前端技术栈

> **决策**：与 OpenClaw 前端技术栈对齐。

| 技术 | 选型 | 说明 |
|------|------|------|
| **框架** | Vue.js 3 | 与 OpenClaw 前端对齐（Django AIDA 已使用 Vue.js） |
| **构建** | Vite | 与 OpenClaw 开发服务器对齐（Vite dev server, port 5173） |
| **状态管理** | Pinia | Vue.js 3 官方推荐 |
| **实时通信** | WebSocket | 与 Django Channels + Redis 对齐；BPS EventBridge 桥接 |
| **UI 组件** | 轻量方案（如 Naive UI / PrimeVue） | 需支持表格、看板、树形、图表 |

### 6.3 层次划分

| 层 | 职责 | 技术 |
|----|------|------|
| **Dashboard API** | 聚合查询、统计计算、权限控制、事件桥接 | Node.js HTTP + WebSocket 服务 |
| **查询聚合层** | 将多个 Store 调用组合为 Dashboard 所需的聚合视图 | `DashboardQueryService` |
| **统计存储层** | 时间序列统计、历史聚合 | `StatsStore`（新增统计表 + 物化视图） |
| **事件桥接层** | ProcessManager EventEmitter → WebSocket | `EventBridge → WebSocket Server` |
| **前端** | 多视图渲染、交互、状态管理 | Vue.js 3 + Vite + Pinia |

### 6.4 权限模型

> **决策**：统一视图 + 操作权限控制。

所有角色看到**相同的数据视图**（不做数据隔离），但**操作权限**按角色差异化：

| 角色 | 读 | 写操作 |
|------|-----|--------|
| **运营负责人** | 全部 | 启动进程、归档实体 |
| **业务操作员** | 全部 | 完成任务、更新实体数据 |
| **系统管理员** | 全部 | 重试错误进程、状态迁移、系统干预 |
| **审计角色** | 全部 | 无写操作 |

### 6.5 多蓝图策略

> **决策**：概览跨蓝图聚合，细节按蓝图切换。

实体档案（Dossier）天然跨蓝图共享——同一个 `store-001` 可被"门店运营"蓝图的采集服务和"内容管理"蓝图的发布服务同时操作。

| 维度 | 策略 |
|------|------|
| **概览仪表盘** | 跨蓝图聚合（全局视图：所有实体、所有进程、所有节点） |
| **服务 DAG 视图** | 单蓝图（每个蓝图有独立的编排逻辑，按蓝图切换） |
| **实体详情** | 跨蓝图（展示所有蓝图的关联进程，不区分来源） |
| **进程看板** | 支持按蓝图过滤，默认显示全部 |

### 6.6 Agent 助理界面

> **决策**：Agent 助理 = IM 消息渠道与 OpenClaw Agent 沟通。MVP 阶段不做 Dashboard 内嵌集成。

Agent 助理不是 Dashboard 的子系统，而是独立的 IM 对话渠道（Slack/Discord/Matrix 等）。用户通过自然语言与 OpenClaw Agent 交互，Agent 通过已注册的 `bps_*` 工具执行操作。

Dashboard 与 Agent 的协同方式：
1. Agent 可调用 `bps_dashboard_snapshot` 工具返回状态摘要
2. 摘要中包含 Dashboard 链接，用户可跳转到完整视图
3. Dashboard 的干预操作（暂停、重试等）通过 BPS Engine API 执行，与 Agent 工具调用使用同一引擎实例

## 7. 粒度范围参考

用户定义的粒度范围：

| 维度 | 最小粒度 | 最大粒度 |
|------|---------|---------|
| **进程** | 单个 Agent 的一次任务进程（atomic service process） | 企业组织实体的整体经营进程（organization-level composite） |
| **实体** | 单个业务字段（dossier version patch 中的一个 key） | 企业组织整体（organization entity dossier） |
| **节点** | 单次 Agent 会话（agentSessionKey） | 整个组织的计算资源池 |

**粒度导航路径示例**：

```
组织概览 → store 类别 (128家) → store-001 详情 → rating 字段历史
   L0           L1                    L2                L3

全局看板 → "数据采集" 服务进程 → process-abc 详情 → 子进程树
   L0           L1                    L2              L3

节点概览 → "采集员" 角色 → Agent-007 详情 → 会话 session-xyz
   L0          L1              L2               L3
```

## 8. 历史分析与统计

> **决策**：需要历史分析能力，通过统计表实现。

Dashboard 不仅展示实时状态，还需要支持历史趋势分析。需要额外的统计存储层。

### 8.1 统计数据模型

```sql
-- 时间序列统计表：按时间间隔聚合的指标
CREATE TABLE bps_stats_timeseries (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,        -- 指标名: 'process.created', 'process.completed', 'process.error', 'dossier.committed'
  interval TEXT NOT NULL,      -- 聚合粒度: 'hour', 'day', 'week'
  bucket TEXT NOT NULL,        -- 时间桶: '2026-02-24T14:00:00Z' (hour), '2026-02-24' (day)
  dimensions TEXT,             -- JSON: { "serviceId": "xxx", "entityType": "store" } 可选分组维度
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(metric, interval, bucket, dimensions)
);

-- 快照统计表：定期（或事件驱动）记录的系统状态快照
CREATE TABLE bps_stats_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_type TEXT NOT NULL,  -- 'overview', 'service_workload', 'operator_workload'
  data TEXT NOT NULL,           -- JSON: 完整快照数据
  created_at TEXT NOT NULL
);

CREATE INDEX idx_stats_ts ON bps_stats_timeseries(metric, interval, bucket);
CREATE INDEX idx_stats_snap ON bps_stats_snapshots(snapshot_type, created_at);
```

### 8.2 统计收集策略

| 触发方式 | 说明 |
|----------|------|
| **事件驱动** | 监听 `process:created`, `process:completed`, `process:error`, `dossier:committed` 事件，实时递增对应时间桶的计数 |
| **定时快照** | 每小时记录一次系统状态快照（各状态进程数、实体分布、节点负载） |
| **按需聚合** | Dashboard 请求特定时间范围的趋势时，从时间序列表查询 |

### 8.3 支持的分析查询

| 查询 | 数据来源 |
|------|---------|
| 过去 24h 的进程创建/完成/错误趋势 | `bps_stats_timeseries` WHERE metric='process.*' AND interval='hour' |
| 某服务类型的平均完成时间趋势 | 需在完成事件中计算并存入 timeseries |
| 实体增长曲线 | `bps_stats_timeseries` WHERE metric='dossier.committed' |
| 节点负载历史 | `bps_stats_snapshots` WHERE snapshot_type='operator_workload' |

## 9. 告警机制

> **决策**：三层告警——固定阈值 + 动态基线 + LLM 异常提醒。

### 9.1 告警层次

| 层级 | 机制 | 触发方式 | 示例 |
|------|------|---------|------|
| **L1 固定阈值** | 预定义的硬规则 | 实时事件驱动 | ERROR 进程数 > 5、实体 7 天未更新 |
| **L2 动态基线** | 基于历史统计的偏差检测 | 定时计算（每小时） | 进程错误率超过历史均值 2 倍标准差 |
| **L3 LLM 异常** | LLM 分析异常模式 | 定时或 L1/L2 触发后 | 识别非显而易见的异常关联（如"某类门店的采集成功率突然下降"） |

### 9.2 L1 固定阈值规则

```yaml
alerts:
  - name: high_error_count
    condition: "processStore.queryByState('ERROR').length > threshold"
    threshold: 5
    severity: critical

  - name: stale_entity
    condition: "dossier.updatedAt < now() - interval"
    interval: 7d
    severity: warning

  - name: overloaded_agent
    condition: "operator.runningProcesses > threshold"
    threshold: 10
    severity: warning
```

### 9.3 L2 动态基线

从 `bps_stats_timeseries` 计算最近 7 天的均值和标准差，当当前小时的指标偏离超过 2σ 时触发告警。

### 9.4 L3 LLM 异常分析

当 L1/L2 触发告警时，可选地调用 OpenClaw Agent 进行上下文分析：
- 将告警上下文（涉及的实体、进程、错误信息）作为 Agent 输入
- Agent 分析异常根因并生成人类可读的报告
- 报告通过 IM 渠道推送给运营负责人

## 10. 实施阶段

### Phase 1：数据基础 + 最小可用 Dashboard

**目标**：补全 API 缺口，实现概览仪表盘和基本进程看板。

- [ ] 新增 `DashboardQueryService`（聚合查询层）
- [ ] 新增 `StatsStore`（统计表 + 事件驱动收集）
- [ ] 补全 ProcessStore 多条件查询、进程树重建
- [ ] 补全 Operator 查询 API
- [ ] 实现概览仪表盘（三维度计数 + 状态分布）
- [ ] 实现进程看板（Kanban 七列 + 过滤 + 点击详情）
- [ ] 实现实体列表 + 实体详情页
- [ ] 基础权限控制（统一视图 + 角色操作权限）

### Phase 2：实时性 + 交互 + 告警

**目标**：事件驱动的实时更新，支持干预操作和基础告警。

- [ ] 事件 → WebSocket 桥接
- [ ] 看板实时刷新（进程状态变更自动移动卡片）
- [ ] 干预操作（拖拽迁移状态、重试、启动进程）
- [ ] 实体版本时间线视图
- [ ] L1 固定阈值告警
- [ ] L2 动态基线告警

### Phase 3：高级视图 + 历史分析

**目标**：进程树/DAG、泳道、时间序列分析、LLM 告警。

- [ ] 进程树视图
- [ ] 服务 DAG 视图（蓝图可视化，按蓝图切换）
- [ ] 泳道视图（跨角色协作）
- [ ] 时间序列统计 + 趋势图
- [ ] 操作者工作负载分析
- [ ] L3 LLM 异常分析（OpenClaw Agent 集成）
- [ ] 实体网络视图（跨实体关联分析）

> 注：原规划中的 Phase 4（Agent 助理集成）已合并。Agent 助理通过 IM 渠道独立运作，Dashboard 不内嵌对话框。L3 LLM 告警作为 Agent 集成的唯一触点纳入 Phase 3。

## 11. 决策记录

以下为 v0.1 开放问题的决策结果：

| # | 问题 | 决策 | 影响 |
|---|------|------|------|
| 1 | 部署形态 | **混合模式**：独立 Web 应用为主 + Agent 工具快照为辅。OpenClaw 不支持 `registerPage()`，Dashboard 不能作为插件页面。 | 架构选型（6.1） |
| 2 | Agent 助理集成 | **IM 渠道独立运作**。Agent 助理 = 通过 IM 消息渠道与 OpenClaw Agent 沟通，MVP 不做 Dashboard 内嵌集成。移除原 Phase 4。 | 实施阶段（10），架构（6.6） |
| 3 | 权限模型 | **统一视图 + 操作权限控制**。所有角色看相同数据，写操作按角色差异化。 | 权限设计（6.4） |
| 4 | 前端技术栈 | **Vue.js 3 + Vite**，与 OpenClaw 前端技术栈对齐。 | 技术选型（6.2） |
| 5 | 多蓝图策略 | **概览跨蓝图聚合，服务 DAG 按蓝图切换**。实体档案天然跨蓝图共享。 | 数据作用域（6.5） |
| 6 | 历史分析 | **需要**。新增统计表 + 时间序列聚合。 | 统计存储层（8），Phase 1 新增 StatsStore |
| 7 | 告警机制 | **三层：固定阈值 + 动态基线 + LLM 异常提醒**。L1/L2 在 Phase 2，L3 在 Phase 3。 | 告警设计（9），实施阶段（10） |

# BPS Dashboard 可视化蓝图反馈 — 差距分析报告

> **⚠️ 历史文档**：本文写于 2026-02-27，所列 5 层差距已于 Phase 7-E2 全部关闭。
> 当前 Dashboard 有 13 个页面（非文中的 7 个）、33 个 API endpoint（非 25+）、
> 5 列 Kanban（非 7 列）。bps-dashboard 已合并为 `aida/dashboard/` 子目录。
> 当前实现请参见 `AIDA 架构决策与现状 (ADR).md` Section 3.4。

**日期**：2026-02-27
**目标**：让 BPS Expert 设计的蓝图对业务用户可见、可运行、可迭代

## 目标状态

```
BPS Expert 设计蓝图 → 蓝图加载到引擎 → Dashboard 可视化展示（非 YAML）
→ 用户一键试运行 → 实时看到流程流转 → 反馈优化 → 循环迭代（ATDD）
```

## 现有能力

### bps-dashboard 已有页面

| 页面 | 能力 | 可视化方式 |
|------|------|-----------|
| Overview | 系统统计 + 7天趋势 | ECharts 折线图 |
| Kanban | 按状态分列的进程看板 | 拖拽卡片 |
| Process Detail | 进程树 + 上下文快照 | ECharts 树图 |
| Service DAG | 服务依赖图 | ECharts 力导向图 |
| Workload | 操作员负载泳道 | ECharts 时间轴 |
| Entity Network | 实体关系网络 | ECharts 力导向图 |
| Entity Detail | 实体版本历史 | 时间线 + diff |

### 后端基础

- 25+ HTTP API 路由（进程/服务/实体/规则/统计/告警）
- `GET /api/rules` 返回完整规则边（事件→指令→目标服务），是流程图的数据基础
- 5 种 SSE 实时事件（process:created/state_changed/completed/error, dossier:committed）
- `loadBlueprintFromString()` YAML 加载函数已存在

## 差距分析：5 层架构

```
Layer 1  引擎共享          ████░░░░░░  Dashboard 和 Agent 各跑独立引擎，数据不互通
Layer 2  蓝图上传 API       ███░░░░░░░  yaml-loader 已有，缺 HTTP 动态加载接口
Layer 3  流程拓扑图         ██░░░░░░░░  Service DAG 是力导向图，不是业务流程图
Layer 4  实时执行动画       █░░░░░░░░░  SSE 基础设施就绪，缺流程图上的状态动画
Layer 5  ATDD 测试循环      ░░░░░░░░░░  完全不存在
```

### Layer 1：引擎共享（架构问题）

**现状**：bps-dashboard 自带独立 bps-engine 实例（`server/engine.ts`），从本地 `blueprints/` 加载。OpenClaw 插件有另一个引擎。两者数据不互通。

**需要**：BPS Expert 操作的引擎 = Dashboard 展示的引擎。

**方案评估**：

| 方案 | 描述 | 优劣 |
|------|------|------|
| A. Dashboard 调 OC API | Dashboard 不自建引擎，调 OpenClaw Gateway API | 改动大，OC 没暴露 bps REST API |
| **B. 共享 SQLite** | Dashboard 和 OC 插件用同一个 SQLite 文件 | **最小改动，推荐** |
| C. Dashboard 内嵌引擎 | BPS Expert 通过 Dashboard API 操作 | 绕路，不符合架构 |

**推荐方案 B**：Dashboard 后端 `engine.ts` 改为指向 OpenClaw 插件的 SQLite 文件路径，只读访问。BPS Expert 通过 bps_* tools 写入，Dashboard 读取同一 db 文件。

**工作量**：小

### Layer 2：蓝图动态加载 API

**现状**：`loadBlueprintFromString(yamlContent, store)` 已存在但只在启动时调用，无 HTTP 接口。

**需要**：
```
POST /api/blueprints
Body: { name: "...", yaml: "..." }
→ 解析并加载到引擎，返回 { services, events, instructions, rules, errors }
```

**工作量**：小（routes.ts 加一条路由）

### Layer 3：流程拓扑图（核心缺失）

**现状**：Service DAG 用力导向图，无方向感，不区分链式/并行/调用关系，业务用户看不懂。

**需要**：流程流向图（类 BPMN），从 rules 数据自动推导：
```
[数据采集] → [数据核验] → [档案生成]
                                 ↓
[模型分析] → [内容生成] → [人工审核]
                              ↓ (并行)
              [豆包发布] [千问发布] [元宝发布]
                              ↓
[效果监测] ---(LLM判断)--→ [内容优化]
```

**实现思路**：
- 数据源：`GET /api/rules` 返回的 `RuleEdge[]`
- 布局算法：dagre 或 ELK 自动分层布局
- 渲染：ECharts graph（directed）或 Vue Flow
- 节点标注：服务名 + executorType 图标（👤人工/🤖Agent/⚙️系统）+ entityType
- 识别编排模式：链式（单条边）、并行扇出（同源多目标）、同步调用（call_sub）

**工作量**：中等（新页面 + 布局算法 + 编排模式识别）

### Layer 4：实时执行动画

**现状**：SSE 基础设施完整（5 事件类型，自动重连，Pinia store 集成），但无流程图动画。

**需要**：Layer 3 流程图上：
- 进程创建 → 节点从灰色变蓝（NEW）→ 绿色（RUNNING）→ 完成色（TERMINATED）
- 进程在节点间流转时连线动画
- 并行扇出多节点同时亮起
- 异常节点变红
- manual 服务节点标记"等待人工"

**实现**：监听 SSE `process:state_changed`，通过 processId → serviceId 映射到图节点，ECharts `setOption` 动态更新样式。

**工作量**：中等（依赖 Layer 3）

### Layer 5：ATDD 测试循环

**需要**：
1. 用户在 Dashboard 看到蓝图流程图（Layer 3）
2. 点"试运行" → 创建顶层进程
3. 实时展示流程流转（Layer 4）
4. manual 服务 → 图上提供"模拟完成"按钮
5. agent 服务 → 如无真实 Agent 可"模拟完成"
6. 运行完毕 → 执行报告（耗时、各节点状态、审计日志）
7. 用户反馈 → BPS Expert 修改蓝图 → 重新加载 → 再次试运行

**工作量**：大（需 Layer 2-4 全部就位 + 模拟执行 UI + 报告生成）

## 实施优先级

| 层次 | 工作量 | 依赖 | 优先级 | 说明 |
|------|-------|------|--------|------|
| Layer 1: 引擎共享 | 小 | 无 | **P0** | 前置条件 |
| Layer 2: 蓝图上传 API | 小 | L1 | **P0** | BPS Expert 协作基础 |
| Layer 3: 流程拓扑图 | 中 | L2 | **P0** | 业务用户可见的关键 |
| Layer 4: 实时执行动画 | 中 | L3 | P1 | 用户体验升级 |
| Layer 5: ATDD 循环 | 大 | L4 | P1 | 完整闭环 |

## 技术栈

- 前端：Vue 3 + Naive UI + ECharts（已有）
- 流程图布局：dagre（轻量）或 Vue Flow（专业，基于 reactflow）
- 后端：Hono（已有）
- 实时：SSE（已有）
- 存储：node:sqlite（已有，共享路径即可）

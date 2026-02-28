# AIDA — AI-Native 组织运营基础设施平台

## 项目定位

AIDA 是通用的 AI-Native 组织运营平台，提供从理论到引擎到可视化的完整技术栈。
商业项目（如闲氪）基于 AIDA 编写业务蓝图、部署 Agent 组织，实现自身业务目标。

## 概念层次（重要，勿混淆）

```
BPS 规范 (AIDA)              ← 通用理论（类比：ISA 指令集架构）
  ├─ erpsys (Django/Python)   ← 引擎实现 A，仅供 bps-engine 开发时借鉴
  └─ bps-engine (TypeScript)  ← 引擎实现 B，作为 OpenClaw 插件运行（主力）
      └─ YAML Blueprint       ← 业务程序（由各商业项目编写）
```

- erpsys 和 bps-engine 是 BPS 规范的**两种引擎实现**，不是业务应用实例
- YAML Blueprint 才是跑在引擎上的"**业务程序**"

## 目录结构

```
aida/
├── CLAUDE.md                 ← 本文件
├── package.json              ← npm workspaces 根
├── docs/                     ← BPS 核心规范文档
│   ├── 业务流程描述通用规范 (BPS) v0.9 Draft.md
│   └── 标准业务建模过程 (SBMP) v0.2 草案.md
├── erpsys/                   ← Django 版 BPS 引擎（仅供 bps-engine 开发借鉴）
├── research/                 ← BPS 研究（论文提案、评估、backlog 等）
│   ├── BPS_research.md
│   └── backlog.md
├── packages/
│   ├── bps-engine/           ← git submodule → jinniudashu/bps-engine
│   │   └── docs/             ← bps-engine-skeleton.md, OpenClaw框架技术研究报告.md
│   └── bps-dashboard/        ← git submodule → jinniudashu/bps-dashboard
│       └── docs/             ← bps-dashboard-visual-gap-analysis.md, dashboard-requirements-spec.md
└── session_state.md          ← 开发历程笔记（Phase 1-7）
```

## BPS 核心概念

BPS（Business Process Specification）将组织运营建模为图灵计算，六元组：

| 元组件 | 说明 | 引擎中的表现 |
|--------|------|-------------|
| **Entity** | 业务对象 | 实体档案 Dossier（版本化 JSON，erpsysId 全局寻址） |
| **Service** | 业务任务类型（函数定义） | atomic/composite，manual/agent/system |
| **Rule** | 事件→指令映射 | ServiceRule：事件触发时执行指令 |
| **Role** | 计算节点类型 | executorType：manual / agent / system |
| **Instruction** | 运行时原语 | 9 种 SysCall：start_service, call_sub_service, terminate_process 等 |
| **Process** | Service 的运行实例 | 7-state 状态机（NEW→READY→RUNNING→WAITING/SUSPENDED/TERMINATED/ERROR） |

### 规则引擎双模态

- **确定性事件**：布尔表达式，expr-eval 安全沙箱求值
- **非确定性事件**：自然语言描述，路由给 LLM 判断（返回 matched + confidence + reasoning）

### 三层架构

1. **BPS 业务流程层** — What：业务应该如何流转（YAML 蓝图）
2. **智能编排层** — When/Who/How many：调度决策（规则引擎 + LLM）
3. **OpenClaw Agent 执行层** — How：Agent 如何执行（skills, tools, memory）

## 技术栈

### OpenClaw（Agent 执行层）

OpenClaw 是 AI Agent 基础设施，bps-engine 作为其原生插件运行。

- **关键能力**：sessions_spawn / sessions_send / steer / Skill 系统 / 双层记忆 / Gateway / Action Gating / inputProvenance
- **与 BPS 的映射**：
  - BPS Process ≈ OpenClaw Session
  - BPS Service ≈ Agent Skill
  - BPS SysCall → OpenClaw Agent 操作（spawn/send/steer）
  - BPS Rule 非确定性事件 → LLM 评估
- **技术研究**：`packages/bps-engine/docs/OpenClaw框架技术研究报告.md`

### bps-engine（BPS 引擎，OpenClaw 插件）
- TypeScript (ES2022 ESM), Node.js 24+
- TypeBox（运行时类型校验）, node:sqlite（零依赖内置 SQLite）
- expr-eval（安全表达式求值）, yaml, uuid
- Vitest（测试框架）, 132 tests

### bps-dashboard（监控面板）
- 前端：Vue 3, Vue Router, Pinia, Naive UI, ECharts
- 后端：Hono, @hono/node-server, SSE 实时推送
- 构建：Vite, TypeScript
- Vitest（测试框架）, 78 tests

### erpsys（BPS 引擎 Django 版，仅供借鉴）
- Django 4.2.7, DRF, PostgreSQL/SQLite, Redis, Celery, Django Channels

## 开发命令

```bash
# 安装（npm workspaces 根目录）
npm install

# bps-engine
cd packages/bps-engine
npx tsc --noEmit          # 类型检查
npx vitest run            # 全部测试

# bps-dashboard
cd packages/bps-dashboard
npm run dev               # 启动开发服务器
npx vite build            # 构建
npx vitest run            # 全部测试
```

## 关键设计决策（erpsys → bps-engine 的演进）

- Django ORM 动态建表 → 版本化 JSON 文档存储（Dossier）
- Python eval() → expr-eval 安全沙箱 + LLM 非确定性评估
- Celery 异步任务 → OpenClaw Agent Session（AI 原生调度）
- Design/Kernel 双轨制 → 单层 + status 字段（draft/active/archived）
- Django Signals → EventEmitter（7 种进程事件）
- 5 类独立资源表 → 统一 ResourceRequirement

## 项目进展

### 已完成
- **Phase 1-7**：bps-engine 核心开发（详见 `session_state.md`）
- **OpenClaw 集成**：bps-engine 部署为 OpenClaw 插件，端到端测试通过
- **bps-dashboard**：Layer 1-5 可视化蓝图反馈全部完成（10 文件 78 测试）
  - Layer 1: 引擎共享（Dashboard 与 OC 插件共享 SQLite）
  - Layer 2: 蓝图动态加载 API
  - Layer 3: 流程拓扑图（从 rules 自动推导）
  - Layer 4: 实时执行动画（SSE 驱动节点状态变色）
  - Layer 5: ATDD 测试循环（试运行 + 模拟完成 + 执行报告）
- **Phase 8：核心 Agent 定义**：BPS Expert + Meta-Architect workspace

### BPS 论文研究
- 论文标题: 《AI-Native 组织运营的计算机科学原理》
- 状态: 学术工作暂时搁置，聚焦商业落地
- 详见 `research/` 目录

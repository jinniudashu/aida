# AIDA (Agile Intent-Driven Architecture) — AI-Native 组织运营基础设施平台

## 会话纪律

当会话中产生以下任一情况时，**必须在会话结束前更新 CLAUDE.md "项目进展" 段落**：
- 架构方向变更或重大设计决策
- 对已有方向的根本性质疑或重估
- 新 Phase 完成
- 重要的技术发现或失败教训

原则：**如果一个决策值得写文档，就值得在 CLAUDE.md 留一行摘要 + 指向详细文档的链接。** CLAUDE.md 是每次会话的唯一保证入口——不在这里的信息等于不存在。

## 项目定位

AIDA 是通用的 AI-Native 组织运营平台，提供从理论到引擎到可视化的完整技术栈。
商业项目（如 IdleX）基于 AIDA 编写业务蓝图、部署 Agent 组织，实现自身业务目标。

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

### 代码仓库

```
aida/
├── CLAUDE.md                 ← 本文件
├── package.json              ← 单一 package（无 workspaces）
├── index.ts                  ← OpenClaw 插件入口
├── tsconfig.json             ← 引擎 TypeScript 配置
├── openclaw.plugin.json      ← 插件清单
├── src/                      ← 引擎核心（tsc 编译域）
│   ├── store/                ← SQLite 持久化（7 文件，含 skill-metrics-store）
│   ├── engine/               ← 任务追踪 + 状态机（2 文件）
│   ├── management/           ← 管理层（5 文件：types/store/action-gate/loader/constants）
│   ├── collaboration/        ← 协作输入（2 文件：types/collaboration-store）
│   ├── knowledge/            ← BKM 知识管理（3 文件）
│   ├── loader/               ← 项目装载（4 文件，含 blueprint-compiler）
│   ├── integration/          ← OpenClaw 桥接（6 文件，含 tool-observer）
│   ├── mcp/                  ← MCP Server（1 文件）
│   ├── schema/               ← TypeBox 类型定义（8 文件）
│   ├── system/               ← 项目初始化（1 文件）
│   └── index.ts              ← 主导出 + createBpsEngine()
├── dashboard/                ← Dashboard（Vite + tsx 编译域，平行于 src/）
│   ├── client/               ← Vue 3 SPA（13 页面）
│   ├── server/               ← Hono API + SSE（~40 endpoints）
│   ├── test/                 ← Dashboard API 测试（136 tests）
│   └── blueprints/           ← 演示蓝图
├── test/                     ← 引擎核心测试（416 tests）
├── agents/                   ← Agent workspace（Aida + 7 Skills）
├── deploy/                   ← install-aida.sh 一键部署
├── docs/                     ← 全部文档（BPS 规范 + 引擎文档 + ADR）
├── archive/                  ← 历史文件（阶段回顾、决策快照）
├── research/                 ← 论文提案（已搁置）
├── erpsys/                   ← git submodule，Django 版 BPS 引擎（只读归档）
├── .dev/                     ← 部署凭据（.gitignore 排除）
└── session_state.md          ← 开发历程笔记（历史文档）
```

### 用户态数据（代码仓库外）

```
~/.aida/                      ← 业务项目数据（一个 AIDA 实例 = 一个项目）
├── project.yaml              ← 项目清单 v1.1
├── blueprints/               ← 业务蓝图 YAML
├── data/                     ← bps.db + 种子数据 YAML
└── context/                  ← 业务上下文（Agent 消费）
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
| **Process** | Service 的运行实例 | 5-state 状态机（OPEN→IN_PROGRESS→COMPLETED/FAILED/BLOCKED） |

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
- **技术研究**：`docs/OpenClaw框架技术研究报告.md`

### 引擎 + Dashboard（OpenClaw 插件，单一仓库）
- TypeScript (ES2022 ESM), Node.js 24+
- 引擎核心：TypeBox, node:sqlite, expr-eval, yaml, uuid
- Dashboard 前端：Vue 3, Vue Router, Pinia, Naive UI, ECharts
- Dashboard 后端：Hono, @hono/node-server, SSE 实时推送
- 构建：tsc (引擎 src/ → dist/), Vite (dashboard/)
- Vitest（测试框架）, 552 tests（416 引擎 + 136 Dashboard）

### erpsys（BPS 引擎 Django 版，仅供借鉴）
- Django 4.2.7, DRF, PostgreSQL/SQLite, Redis, Celery, Django Channels

## 开发命令

```bash
npm install               # 安装依赖
npx tsc --noEmit          # 引擎类型检查
npx vitest run            # 全部测试（引擎 416 + Dashboard 136 = 552）
npm run build:dashboard   # 构建 Dashboard SPA
npm run dev:dashboard     # 开发模式（API + Vite HMR）
```

## 关键设计决策（erpsys → bps-engine 的演进）

- Django ORM 动态建表 → 版本化 JSON 文档存储（Dossier）
- Python eval() → expr-eval 安全沙箱 + LLM 非确定性评估
- Celery 异步任务 → OpenClaw Agent Session（AI 原生调度）
- Design/Kernel 双轨制 → 单层 + status 字段（draft/active/archived）
- Django Signals → EventEmitter（7 种进程事件）
- 5 类独立资源表 → 统一 ResourceRequirement
- Agent SOUL 内嵌知识 → BKM 知识 Dossier（分层分布 + scope chain 装配）
- 手写 4 数组蓝图 YAML → Blueprint 编译器（services + flow 拓扑 → 自动生成 events/instructions/rules，类比 erpsys DataItem DAG→ORM 代码生成）

## 项目进展

### 已完成
- **Phase 1-7**：bps-engine 核心开发（详见 `session_state.md`）
- **OpenClaw 集成**：bps-engine 部署为 OpenClaw 插件，端到端测试通过
- **Dashboard**：Layer 1-5 可视化蓝图反馈全部完成（10 文件 78 测试）
  - Layer 1: 引擎共享（Dashboard 与 OC 插件共享 SQLite）
  - Layer 2: 蓝图动态加载 API
  - Layer 3: 流程拓扑图（从 rules 自动推导）
  - Layer 4: 实时执行动画（SSE 驱动节点状态变色）
  - Layer 5: ATDD 测试循环（试运行 + 模拟完成 + 执行报告）
- **Phase 8：核心 Agent 定义**：BPS Expert + Org-Architect workspace
- **Phase 9：Aida 管理助理 Agent**：Aida workspace（IDENTITY/SOUL/AGENTS），BPS 结晶化判断框架，Agent 协作拓扑（Aida → BPS-Expert / Org-Architect）
- **Phase 10：BKM 业务知识管理**：知识分级 + 作用域 + 知识存储（30 新测试，后经瘦身移除 ContextAssembler/ConflictDetector）
  - 详见 `archive/业务知识管理 (BKM) v0.1.md`
- **Phase 11：~/.aida/ 项目目录迁移**：业务项目数据从代码仓库迁移到 `~/.aida/`，实现代码与数据分离
  - `loadAidaProject()` 一键装载 API（创建引擎 + 系统知识 + 项目清单）
  - `project-loader.ts` 扩展 knowledge seed 支持
  - OpenClaw 插件入口改用 `loadAidaProject()` 替代 auto-glob
  - 测试 fixtures 独立化（不再依赖 in-repo 项目文件）
  - BPLP 文档升级到 v0.2（7 新测试，总计 197 tests）
- **Phase 12：系统蓝图 sys:project-init**：项目初始化形式化为系统保留 BPS 蓝图
  - `src/system/system-blueprint.ts`：8 services + 2 events + 2 instructions + 8 rules 顺序链
  - `loadSystemBlueprints()` 幂等加载 + `verifySystemBlueprints()` 完整性校验
  - `loadAidaProject()` 自动加载系统蓝图，`AidaProjectResult` 扩展 `systemBlueprints` 字段
  - `BlueprintStore.getServiceRule()` 新增对称查询方法
  - `install-aida.sh` 移除 IdleX 示例数据填充，项目初始化交给 Aida 引导
  - Aida SOUL.md 新增首次启动行为（sys:project-init 状态检测）
  - 12 新测试，总计 209 tests

- **Phase 13：Dashboard 部署 + Agent 指令优化**
  - Dashboard 生产部署：Hono 静态文件托管（dist/client/）+ SPA fallback
  - install-aida.sh 扩展：Dashboard 构建 + systemd 服务自动部署
  - Agent workspace 整理：操作性内容（项目目录、首次启动）从 SOUL.md 迁移到 AGENTS.md
  - Aida 行为优化：长操作分步汇报规则 + Dashboard 引导指令

### 架构反思：BPS 引擎价值重估（2026-03-03）
- 详见 `archive/BPS引擎价值反思与架构瘦身建议 (2026-03-03).md`
- **核心结论**：BPS 大部分运行时价值正在被 Agent 能力进化所吞噬
- **架构方向转变**：BPS 从"运行时引擎"退化为"描述规范 + 轻量工具"
- **落地状态**：引擎瘦身已部分完成（engine/ 5→2 文件, knowledge/ 5→3 文件, integration/ 7→5 文件, tools 9→10）

### 项目全面回顾（2026-03-04，已修订）
- 详见 `archive/AIDA项目全面回顾 (2026-03-04).md`
- 覆盖 Phase 1-13 + 两次架构反思 + Workspace 重写，含根本原则偏差分析、资产价值分级和经验教训

### Aida Workspace 重写（2026-03-04）
- **Workspace 英文化 + OpenClaw 风格对齐**：IDENTITY/SOUL/AGENTS 全部重写为英文，遵循 OpenClaw 默认模板，仅叠加 Aida 特定内容
  - SOUL.md：30 行（Core Truths + Role + Boundaries + Vibe + Continuity）
  - AGENTS.md：100 行（Boot + Memory + Safety + Self-Evolution + Aida Operations）
  - 自我投射原则：删除模型已知的内容，只保留 Aida 独有特征
- **BPS-Expert → `skills/blueprint-modeling`**：SBMP 五步法提取为 Skill，269 行 BPS 理论讲解删除
- **Org-Architect → `skills/agent-create`**：4-phase Agent 生命周期提取为 Skill，跨 Agent 协议删除
- **Aida 自给自足**：不再依赖子 Agent，所有能力通过 5 个 Skill 实现（project-init, action-plan, dashboard-guide, blueprint-modeling, agent-create）
- **install-aida.sh 更新**：移除 Org-Architect 部署，新增 Skills 部署 + 验证
- BPS-Expert 和 Org-Architect 归档至 `agents/_archived/`

### Phase 14：项目评审 + 外部数据出口（2026-03-04）
- 详见 `archive/AIDA项目评审报告-偏差分析与优化建议 (2026-03-04).md`
- **评审核心发现**：系统自洽但封闭——13 个 Phase 建设内部基础设施，对外数据出口为零
- **关键偏差**：蓝图 agentPrompt 被存入数据库但 Aida 无法读取；规则拓扑从未被运行时评估
- **P0 改动已落地**：
  - `bps_list_services` 返回 agentPrompt/agentSkills（蓝图业务知识不再被截断）
  - 新增第 10 个 BPS tool `bps_next_steps`（轻量级下游服务建议器，查询 rules 表）
  - `BlueprintStore.getNextSteps()` 新增规则拓扑查询方法
  - **MCP Server**（`src/mcp/server.ts`）：3 tools（search_stores, get_store_detail, check_availability），stdio transport，读取 ~/.aida/data/bps.db，暴露门店数据给外部 AI Agent
  - **Store Profile API**（bps-dashboard 新增 3 个 REST endpoints）：
    - `GET /api/store-profiles` — 门店列表（支持 city/district/businessCircle/keyword 过滤）
    - `GET /api/store-profiles/:storeId` — 门店详情（JSON-LD Schema.org LocalBusiness 格式）
    - `GET /api/store-profiles/:storeId/availability` — 房型可用性查询
  - bps-engine: 196 tests 全部通过，Dashboard: 78 tests 全部通过

### AIDA 能力评估 + Phase A/B/C/D1（2026-03-05）
- 详见 `archive/AIDA能力评估-三视角分析报告 (2026-03-05).md`
- **三频运行节律模型**：Event-driven (Freq 1) / Heartbeat (Freq 2) / Cron (Freq 3)
- **Phase A（Workspace 三频分置）**：HEARTBEAT.md + BOOT.md + business-execution Skill
- **Phase B（引擎效率增强）**：bps_scan_work (tool #11) + bps_next_steps 增强（currentValues）+ reason 审计字段
- **Phase C（Dashboard 三页扩展）**：
  - Agent Log 页：任务审计全景（action/state/reason 过滤）
  - Business Goals 页：Action Plan 卡片（items + periodicItems + 进度条）
  - Approvals 页：审批队列 + approve/reject 决策模态框（HITL 闭环）
  - 4 个新 API + 3 个 Pinia Store + SSE 实时订阅
  - 23 新测试，bps-dashboard 总计 101 tests
- **Phase D1（动态 Skill 生成）**：
  - bps_create_skill (tool #12)：写入 Skill 文件到 Agent workspace
  - skill-create Skill：元技能，教 Aida 何时/如何结晶重复模式
  - HEARTBEAT.md 新增 step 5（模式反思），AGENTS.md 新增 Self-Evolution 节
  - 5 新测试，bps-engine 总计 218 tests
- **业务场景端到端验证**：`server/simulate.ts` 注入晨光咖啡三店标准化运营完整场景
  - 测试服务器 `http://47.236.109.62:3456` 全部页面数据可见
  - 三频操作全景 + HITL 审批闭环 + 动态 Skill 创建记录
- **工具总览**：19 BPS tools + 3 MCP tools
  - 读操作：bps_list_services, bps_get_task, bps_query_tasks, bps_get_entity, bps_query_entities, bps_next_steps, bps_scan_work, bps_management_status, bps_get_collaboration_response
  - 写操作（受管理管控）：bps_create_task, bps_update_task, bps_complete_task, bps_update_entity, bps_create_skill, bps_load_blueprint, bps_load_management, bps_register_agent, bps_batch_update, bps_request_collaboration
- **Aida Skills**：7 个（project-init, action-plan, dashboard-guide, blueprint-modeling, agent-create, business-execution, skill-create）

### 端到端能力验证 -- 基础设施级（2026-03-05）
- 详见 `test/e2e/AIDA端到端能力验证报告 (2026-03-05).md`
- **验证方法**：三视角（第三方专家 → Aida 自评 → 综合测试），干净环境重新安装 + 41 项自动化测试 + 319 单元测试
- **测试结果**：40/41 通过（1 个测试脚本 bug，非引擎问题），319 单元测试全部通过
- **加权完成度**：93.25%（部署100%, 设计时95%, 运行时85%, 可观测100%, HITL100%, 外部出口90%）

### 端到端能力验证 -- OpenClaw 运行时（2026-03-05）
- 详见 `test/e2e/AIDA端到端能力验证报告-OpenClaw运行时 (2026-03-05).md`
- **验证方法**：通过 `openclaw agent --agent main --message` 与 Aida 交互，7 次 agent turn，Gemini 3.1 Pro Preview
- **工作路径**：NL 描述 → Aida 建模 → 实体创建(5个) → 开店流程执行(2店, 各v6) → Heartbeat → 动态 Skill 创建(store-opening) → Skill 复用
- **加权完成度**：67.75%
- **核心发现**：Entity + Skill + Heartbeat 路径已具备实用运营管理能力；Blueprint/Task/Rule 路径存在断裂
- **P0 问题**：Blueprint YAML 格式不兼容（Aida 生成概念 YAML，引擎期望技术 schema）
- **P1 问题**：DossierStore 浅合并导致数组覆盖（progressLogs 丢数据）
- **架构结论**：对于 Agent 驱动运营，Entity + Skill 可能已足够，Blueprint 层的独特价值仅在于机器可查询拓扑 + Dashboard 流程可视化
- **LLM 配置**：install-aida.sh 默认模型已从 MiniMax M2.5 改为 google/gemini-3.1-pro-preview

### Phase E1：Agent 管理层实现（2026-03-05）
- 讨论纪要：`archive/Blueprint管理层讨论纪要 (2026-03-05).md`
- 管理层设计文档：`docs/Agent 管理层规范 (AGS) v0.1.md`
- **核心决策**：Blueprint 从"流程编排器"重定位为"管理规则"——定义 Agent 不能做什么，而非应该做什么
- **管理层实现**（`src/management/`，5 文件）：
  - `types.ts`：类型定义（Constraint/Verdict/CircuitBreakerState/ViolationRecord/ApprovalRequest）
  - `management-store.ts`：SQLite 持久化（4 表：constraints/violations/circuit_breaker/approvals）
  - `action-gate.ts`：前置拦截器（scope 匹配 + expr-eval 求值 + verdict 判定 + 熔断器状态机）
  - `management-loader.ts`：management.yaml 解析 + 校验
  - `constants.ts`：GATED_WRITE_TOOLS 单一来源（9 个写操作工具）
- **工具集成**：
  - 5 个写操作工具自动包装管理检查（bps_update_entity/create_task/update_task/complete_task/create_skill）
  - 新增 `bps_governance_status` tool (#13)：查询熔断器状态 + 违规记录 + 待审批
- **loadAidaProject() 扩展**：自动加载 `~/.aida/governance.yaml`，返回 `governance` 字段
- **governance.yaml**：管理约束定义文件，存放于 `~/.aida/governance.yaml`
- **DossierStore 修复**：smartMerge 实现数组追加语义（P1 fix，3 新测试）
- **测试**：31 新测试（GovernanceStore 6 + GovernanceLoader 5 + ActionGate 9 + CircuitBreaker 7 + ToolWrapper 3 + 1），bps-engine 总计 252 tests

### Phase E2：Dashboard 三问题 + 管理全景（2026-03-05）
- **Overview 页重构**：三面板回答"现状/目标/下一步"
  - Panel 1（现状）：实体/任务/错误计数 + 实体类型标签 + 管理熔断器状态 + 违规徽章
  - Panel 2（目标）：Action Plan 进度条 + 完成率 + 周期任务计数
  - Panel 3（下一步）：任务队列分状态 + 待审批 + 最近违规记录
- **GovernancePage**（专用管理页面，4 面板）：
  - Panel 1（熔断器）：状态标签 + 约束数 + 待审批数 + 重置按钮（带确认）
  - Panel 2（约束清单）：完整表格（ID/策略/严重级别/动作/条件/scope）
  - Panel 3（管理审批）：待审批列表 + Approve/Reject 模态框（显示 tool input 详情）
  - Panel 4（违规历史）：时间线（严重级别/约束/工具/实体/消息/verdict）
- **管理 API**（bps-dashboard，7 个 endpoint）：
  - `GET /api/governance/status` — 熔断器状态 + 约束数 + 待审批数 + 最近违规
  - `GET /api/governance/violations` — 违规历史（支持 limit 参数）
  - `GET /api/governance/constraints` — 约束完整列表
  - `GET /api/governance/approvals` — 管理层待审批列表
  - `POST /api/governance/approvals/:id/decide` — 审批/拒绝
  - `POST /api/governance/circuit-breaker/reset` — 重置熔断器
- **管理端到端验证**：
  - 关键修复：governance wrapper 从返回 `{success:false}` 改为 throw Error（LLM 可靠识别工具失败）
  - Agent 测试通过：REQUIRE_APPROVAL → Agent 报告拦截 + 审批单号 + Dashboard 链接
  - BLOCK 测试通过：CRITICAL 违规 → Agent 报告直接拒绝 + 熔断器断开
  - 发现：OpenClaw gateway 需要重启才能加载新插件代码
- **Approval→Execution 闭环**：Dashboard 审批通过后自动执行原始工具调用
  - `replayToolCall()` 支持全部 5 个写操作工具（update_entity/create_task/update_task/complete_task/create_skill）
  - 前端审批后显示执行结果模态框（成功/失败）
  - 端到端验证通过：APPROVED → 实体写入 + 版本递增；REJECTED → 无执行
- **测试**：Dashboard 112 tests（+11 管理测试），引擎 255 tests，合计 367

### OpenClaw 集成加固（2026-03-06）
- 评估报告：`archive/AIDA-OpenClaw利用充分度评估 (2026-03-06).md`
- 研究报告重写：`docs/OpenClaw框架技术研究报告.md` v1→v2（源码分析→官方文档，462→733 行）
- **评估结论**：核心路径深（Plugin/Tool/Event/Workspace/Skills），外围配置浅（全部依赖默认值）
- **已落地优化**（install-aida.sh 配置合并 + AGENTS.md）：
  - P0 安全基线：`tools.exec.security: "allowlist"` + Red Line 禁止文件 I/O 绕过管理
  - P0 模型 Fallback：`fallbacks: [claude-sonnet-4-6, gpt-4.1]`
  - P1 BOOT.md 激活：`hooks.internal.enabled: true`
  - P1 Compaction 记忆冲刷：`compaction.memoryFlush.enabled: true`
  - P1 Cron 恢复：Boot 步骤 4 验证/重注册 cron 任务
  - P2 语义搜索：AGENTS.md Memory 节加入 `memory_search` 指引
  - P2 循环检测 + 上下文修剪：`loopDetection` + `contextPruning` 配置
- **管理 SSE 修复**（同日早期）：GovernanceStore 继承 EventEmitter，emit 4 个管理专用事件，Dashboard SSE 直接转发

### 仓库扁平化（2026-03-07）
- **两步合并**：bps-dashboard → bps-engine/dashboard/（2026-03-06），然后 bps-engine → aida 根目录（2026-03-07）
- **决策依据**：
  - Dashboard 是引擎视图层，10 维度耦合分析显示无独立价值（共享 DB/EventEmitter/部署单元）
  - bps-engine 作为唯一 submodule 没有被复用，packages/ 层纯增复杂度
- **最终结构**：`src/` + `dashboard/` 平行于根目录，单一 `package.json`（无 workspaces）
  - 两个独立编译域：`tsc`（src/ → dist/）和 `Vite + tsx`（dashboard/）
  - `tsconfig.json` 的 `rootDir: src` 决定了 dashboard/ 不能放入 src/
- **消除的复杂度**：3 仓库 → 1 仓库，3 package.json → 1，npm workspaces 消除，submodule 同步消除
- **保留的 submodule**：仅 erpsys（Django 参考实现，只读归档）
- **测试**：367 tests 全部通过（统一 vitest 运行）

### IdleX GEO E2E v2 业务场景验证（2026-03-07）
- 评估报告：`test/e2e/IdleX-GEO-E2E-v2-评估报告 (2026-03-07).md`
- 测试方案：`test/e2e/idlex-geo-v2.md`，自动化脚本：`test/e2e/idlex-geo-v2.sh`
- **业务目标**：一个 GEO 负责人 + Aida 完成闲氪全部 GEO 运营任务
- **加权总分：87/100**（业务理解 95, 运营体系 90, 内容质量 90, 管理合规 70, 自进化 100, 可观测 50）
- **Self-Evolution 100%**：Skill 创建（geo-ops，prospective gap）+ Agent 创建（krypton-assistant，persona isolation）均一次通过
- **业务覆盖 86%**：7 项 WORKING + 1 项 DESIGNED，日均管理工作量 ~15 分钟
- **P0 待修复**：Dashboard Vite 构建路径（SPA 404）、内容发布绕过管理（需 Skill 级约束）
- **P1 待修复**：install-aida.sh 旧路径清理逻辑

### AIDA 项目全面评估（2026-03-07）
- 评估报告：`archive/AIDA项目全面评估报告 (2026-03-07).md`
- **评估方法**：5 维度并行探索（意图/引擎/Dashboard/Agent 集成/测试质量）
- **综合评分：8.26/10**
  - 项目意图清晰度：9.0（AI 主导 + 基础设施辅助定位正确）
  - 核心引擎质量：7.4（类型安全优秀，事务/错误处理待完善）
  - Dashboard 质量：8.2（SSE 优秀，routes.ts 待拆分）
  - Agent 集成深度：8.5（Workspace 结构清晰，Blueprint 格式断裂待修复）
  - 测试与代码质量：8.5（测试/代码比 1.88:1，TDD 实践优秀）
- **核心优势**：架构方向正确、测试覆盖充分、管理层完善
- **主要风险**：Blueprint 格式断裂、真实业务场景验证有限

### Phase F：Blueprint 编译器（2026-03-07）
- **核心决策**：借鉴 erpsys DataItem 的"DAG 描述 → 代码生成"模式，Aida 只写业务描述（services + flow 拓扑），编译器自动生成引擎 schema（events + instructions + rules）
- **实现**：
  - `src/loader/blueprint-compiler.ts`：编译器（isSimplifiedFormat 检测 + compileBlueprint 编译 + flow DSL 解析）
  - `yaml-loader.ts` 重构：loadBlueprintFromString 自动检测简化格式并编译，loadBlueprintObject 抽取为公共函数
  - `bps_load_blueprint` tool (#14)：Aida 提交 YAML → 编译 → 加载 → 持久化 → 返回 health 状态
  - `blueprint-modeling` Skill 重写：从 4 数组手写 schema 改为简化格式（services + flow）
- **Flow DSL 语法**：`A -> B`（顺序）、`A -> B, C, D`（并行）、`A -> B | "condition"`（条件）
- **向后兼容**：已有 events/instructions/rules 的 YAML 直接加载（跳过编译）
- **解决的问题**：Gap 7（Blueprint 格式不兼容）——LLM 出错面从 4 个交叉引用数组缩小到 services + flow 箭头
- **测试**：22 新测试，总计 391 tests（369 + 22）
- **BPS tools**：14 个（+bps_load_blueprint）
- **二层路由机制**：强制 Aida 在设计时区分管理层（Blueprint）vs 运营层（Entity + Skill）
  - SOUL.md：新增 "Two-Layer Architecture (Critical)" 节，含决策规则（constraint → Governance, action → Operations, default → Operations）
  - AGENTS.md：新增 "Two-Layer Routing" 节，含信号→层→介质决策表
  - `action-plan` Skill：新增 Step 1 "Layer classification"，每个计划项必须标注 Governance 或 Operations
  - `blueprint-modeling` Skill：限定 scope 为 governance-only（constraints, approval gates, prohibitions），非运营工作
  - `business-execution` Skill：重构为 Entity + Skill 主路径，BPS Task 为次路径

### Workspace 质量评估与优化（2026-03-07）
- **评估基准**：基于 `docs/OpenClaw框架技术研究报告.md` v2（OpenClaw 官方文档 20+ 页）
- **综合评分：85/100**（文件完整性 71%, 语义正确性 88%, Skills 质量 95%, Token 效率 95%, 最佳实践对齐 82%）
- **已落地改进**：
  - P0：SOUL.md Two-Layer Architecture 缩为一句引用，AGENTS.md 保留完整路由规则（方案 A：消除重复，AGENTS.md 为唯一来源）
  - P1：新增 `USER.md`（timezone/language/work hours）— 补齐 Bootstrap 7 文件缺口
  - P1：新增 `TOOLS.md`（14 BPS tools 分组 + 读写分类 + 常用模式 + 已知行为）— 始终注入含子 Agent
  - P2：`BOOT.md` Step 4 从 `message` 工具改为写入 memory 日志（Gateway 重启时用户可能不在线）
  - P2：`project-init` 和 `dashboard-guide` Skill 添加 `user-invocable: true`
- **Bootstrap 文件完整性**：7/7（AGENTS + SOUL + IDENTITY + HEARTBEAT + USER + TOOLS + MEMORY 运行时生成）+ BOOT.md
- **Workspace 文件行数**：SOUL 32 行, AGENTS 119 行, IDENTITY 4 行, HEARTBEAT 8 行, USER 3 行, TOOLS 38 行, BOOT 4 行

### IdleX GEO E2E v3 业务场景验证（2026-03-07）
- 评估报告：`test/e2e/IdleX-GEO-E2E-v3-评估报告 (2026-03-07).md`
- 测试方案：`test/e2e/idlex-geo-v3.md`，自动化脚本：`test/e2e/idlex-geo-v3.sh`
- **v3 新增测试点**：USER.md/TOOLS.md 部署、Two-Layer 合并（SOUL→AGENTS）、Skill user-invocable、目标陈述式对话、干净 memory（无先验上下文）
- **加权总分：60/100**（部署 100, 业务理解 95, Two-Layer 路由 85, 建模执行 25, 内容质量 90, 管理闭环 15, 自我进化 10）
- **自动化测试**：34 PASS / 1 FAIL / 8 WARN / 35 TOTAL
- **基础设施层 100% 验证通过**：14/14 安装检查 PASS，新增 USER.md/TOOLS.md 一次通过，Two-Layer 合并生效
- **核心问题：「说而不做」**：Aida 自然语言输出质量极高（一模一策差异化精准），但实际工具调用率极低——描述了完美的建模方案但未调用 BPS 工具执行
- **v2→v3 对比**：v2 (87分) 保留了前次测试 MEMORY.md，v3 清除所有 memory 后暴露无先验上下文时工具调用能力严重不足
- **结论**：AIDA 基础设施层完全就绪，LLM 工具调用行为是唯一瓶颈
- **改进方向**：强化 AGENTS.md "Act, don't describe" 指令 / 测试 Claude/GPT 作为 primary 模型 / MEMORY.md 预置工具调用模式引导

### IdleX GEO E2E v3.1 模型切换测试（2026-03-08）
- 评估报告：`test/e2e/IdleX-GEO-E2E-v3.1-评估报告 (2026-03-08).md`
- **变更**: 模型 → `openai/gpt-5.4` (OpenRouter), Session 持久化 (`--session-id`), Fallback → `claude-sonnet-4-6 → gemini-3.1-pro`
- **测试 Turn 加权总分：32/100** — GPT-5.4 反复超时（12 次 retry），Fallback 模型产出低质量重复响应
- **Cron 自治系统评分：80/100** — 意外发现：之前注册的 9 个 Cron 任务在 Gateway 重启后依然存活并自动执行
  - 61 次工具调用 0 错误（bps_update_entity ×5, bps_create_task ×7, write ×7 等）
  - geo-report 实体完整生命周期（started → Analyzed → Pending Approval → Published → Completed）
  - 一模一策差异化内容自动生成到 mock-publish/（doubao/qianwen/yuanbao 各 2.4KB）
- **持续问题**：管理绕过（连续 3 次测试 — write 工具直接写文件，不经 bps_update_entity）
- **结论**：GPT-5.4 当前不适合作为 primary 模型；**Cron + 持久 Session 是 Aida 自治运营的核心路径**

### IdleX GEO E2E v3.2 清洁环境测试（2026-03-08）
- 评估报告：`test/e2e/IdleX-GEO-E2E-v3.2-评估报告 (2026-03-08).md`
- **变更**: 模型路由修复 `openrouter/openai/gpt-5.4`（非 `openai/gpt-5.4`），移除无效 `--session-id`，全面 OpenClaw 状态清理
- **加权总分：89/100** — AIDA 项目迄今最佳端到端测试
- **自动化测试**: 39 PASS / 0 FAIL / 4 WARN / 39 TOTAL
- **从清洁环境一次性完成**：
  - 42 个实体（20 新建 + 15 探测记录 + 7 种子）
  - 1 个 Blueprint（idlex-geo-governance，编译通过，flow DSL 正确）
  - 1 个 Agent workspace（小闲店铺顾问，独立人格）
  - 3 个 Cron（监测 10:00 / 小结 19:00 / 复盘周一 11:00）
  - 20 个 mock-publish 文件（15 份内容 + 5 份报告/模板）
- **关键突破**：
  - Two-Layer 路由正确：Governance Blueprint + Operations Entity 分层明确
  - 一模一策差异化精准：doubao(情绪) / qianwen(结构) / yuanbao(务实)
  - Blueprint 编译器首次由 Agent 自主使用并通过验证
  - GPT-5.4 via OpenRouter（embedded 模式）工具调用能力和业务理解均显著优于 Gemini 3.1 Pro
- **持续问题**：Gateway auth-profiles.json 缺失导致每轮降级 embedded 模式；管理绕过（第 4 次复现，Aida 自建文件级审批流替代）
- **LLM 模型结论**：`openrouter/openai/gpt-5.4` 确认可用且效果最佳；注意 `openai/` 前缀路由到原生 OpenAI（不兼容），必须用 `openrouter/` 前缀

### 第三方专家评估（2026-03-09）
- 评估报告：`archive/AIDA项目第三方专家评估报告 (2026-03-09).md`
- **综合评分：8.4/10**（理论原创 9.5 / 架构完整 8.5 / 工程质量 8.0 / 管理能力 9.0 / 测试覆盖 8.8 / 实用成熟 7.5 / 可扩展性 8.0）
- **核心结论**：AIDA 是理论原创、架构完整、工程扎实的 AI-Native 组织运营基础设施平台
- **双引擎对比**：erpsys（Django 参考）→ bps-engine（TypeScript 生产版）演进路径合理
- **P0 建议**：Blueprint 编译器完善、文件 I/O 管理绕过修复、Gateway 热加载
- **SWOT 分析**：优势（理论原创+管理领先+工程扎实），劣势（业务验证有限+模型依赖），机会（市场空白+学术价值），威胁（LLM 能力进化+大厂竞争）

### 六模型横评测试（2026-03-09~10，已完成）
- 测试方案：IdleX GEO E2E v3（6 turns，39 自动化检查点）
- 测试结果目录：`test/e2e/benchmark-results/`
- **综合报告**：`test/e2e/benchmark-results/SIX-MODEL-COMPARISON.md`
- **排名**：
  1. 🥇 **Gemini 3.1 Pro** (9.15/10) — 44 PASS，唯一触发管理 (5 violations)
  2. 🥈 Opus 4.6 (8.75/10) — 43 PASS，23 entities（最多）
  3. 🥉 Qwen3.5-Plus (8.55/10) — 41 PASS，性价比最高
  4. GLM-5 (7.25/10) — 40 PASS，15 skills（最多）
  5. Kimi K2.5 (7.30/10) — 40 PASS，1 FAIL，24 mock-publish（最多）
  6. GPT-5.4 (7.05/10) — 40 PASS，无 Agent/Blueprint
- **关键发现**：
  - Gemini 3.1 Pro 是唯一成功触发管理拦截的模型，证明 AIDA 管理层的实际价值
  - Opus 4.6 实体创建最多（23），架构最完整
  - GLM-5 Skills 创建最多（15），但缺少 Agent workspace
  - GPT-5.4 缺少 Agent 和 Blueprint，管理层无载体
  - 推荐生产配置：`google/gemini-3.1-pro-preview`（主）+ `dashscope/qwen3.5-plus`（备）

### MAOr 预处理 E2E 测评（2026-03-10）
- **目标**：评估"原始物料 → 预处理 → AIDA 建模"端到端管线质量
- **测评方案**：`test/e2e/maor-preprocessing-e2e.md`（6 维度 37 检查点）
- **原始物料**：`.test-data/maor/`（63 个文件，广州颜青医疗美容诊所）
- **预处理输出**：`.test-data/maor/processed/`（4 个 Markdown，v0.2）
- **Round 1**（v0.1 预处理 + 6 turns, Kimi K2.5）：**8.18/10**
  - 54 entities, 量化数据零误差(D2=8.5), 术后护理覆盖不足(5/12)
  - PREPROCESS 归因 28.6% > 20%（未收敛）
- **Round 2**（v0.2 预处理 + 7 turns, Kimi K2.5）：**8.66/10**（+0.48）
  - 66 entities, consent-form 5→8(全覆盖), post-care 5→14(P0全覆盖)
  - PREPROCESS 归因 12.5% < 20%（**已收敛** ✓）
  - D1+D2 = 9.0/10 ≥ 7.5（**已达标** ✓）
  - HARD 通过率 100%, FAIL 数 0
- **剩余差距**：ARCHITECTURE 归因（governance 热加载 + blueprint 编译器 flow.rules 支持）
- **架构修复已落地**（2026-03-10）：
  - `bps_load_governance` tool (#15)：运行时重载 governance.yaml，支持 `policies[]` 和 flat `constraints[]` 两种格式
  - `governance-loader.ts` 增强：flat `constraints[]` 自动包装为 policy + 字段规范化（`action` → `onViolation`，缺省 `scope.tools` → 全部写操作工具）
  - Blueprint compiler `flow.rules` 支持：`isSimplifiedFormat()` 检测 `flow: { rules: [{when, then}] }` 对象格式，`compileBlueprint()` 自动转换为 DSL arrows
  - 8 新测试（governance loader flat format 2 + bps_load_governance tool 1 + flow.rules 5），总计 399 tests
- **BPS tools**：15 个（+bps_load_governance）
- **下一步**：Round 3 预处理 Skill 提炼，将 v0.1→v0.2 改进经验沉淀为可复用规则
- 评估报告：`test/e2e/maor-results/r1-kimi-k2.5/EVALUATION.md` (R1) + `EVALUATION-R2.md` (R2)

### 多模型基准测试 R4（2026-03-10）
- 综合报告：`test/e2e/benchmark/results/R4-BENCHMARK-REPORT-CN.md`
- **方法论改进**：固定评估者（Claude Opus 4.6）+ 干净环境 + 制品导向评分
- **排名**：Kimi K2.5 (6.40) > Qwen3.5+ (5.85) > GPT-5.4 (4.75) > GLM-5 (4.15) > Claude (2.80) > Gemini (2.40)
- **关键发现**：Kimi K2.5 唯一触发真实管理拦截；所有模型 0 cron；behavior.json 工具调用观测方法失效
- **横向问题**：「说而不做」反模式普遍；管理绕过（文件 I/O）连续 4 轮复现

### 多模型基准测试 R5 — 框架验证轮（2026-03-10）
- 综合报告：`test/e2e/benchmark/results/R5-BENCHMARK-REPORT-CN.md`
- **目标**：验证 R4→R5 的 5 项框架修正（Session JSONL 解析、Cron 检测、进程清理、两阶段发布、模型覆盖）
- **框架验证**：4/5 修正确认生效，Session JSONL 解析首次捕获真实工具调用数据（84 calls / 11 BPS tool types）
- **P0 Bug**：模型覆盖（overlay）机制失效 — `idlex-geo-v3.sh` Phase 0 重新运行 `install-aida.sh` 覆盖了 benchmark overlay，导致全 6 模型均以 Qwen3.5-Plus 运行
  - 修复已落地：`BENCHMARK_MODE=1` 环境变量跳过重复安装
- **Qwen3.5-Plus 3 次独立运行方差分析**：
  - 运行 A (GPT标签): 84 calls, 18 published, 0 governance — 产出驱动型
  - 运行 B (Claude标签): 64 calls, 11 BPS types, 2 violations — 架构驱动型
  - 运行 C (Qwen标签): 47P/0F/1W, 2 violations + 2 approved — **均衡型，首次完整管理闭环**
- **最佳成绩**：运行 C 加权评分 **7.75/10**（AIDA 基准测试历史最高），6 维度全 8 分
  - **突破**：Cron 100% 创建成功（R4 全军覆没）、管理闭环首次端到端验证（trigger→approve→publish）

### 多模型基准测试 R6 — 首轮真正跨模型对比（2026-03-10）
- 综合报告：`test/e2e/benchmark/results/R6-BENCHMARK-REPORT-CN.md`
- **目标**：修复 R5 模型 overlay bug 后的首轮真正跨模型对比（6/6 模型完成，Gemini 重跑后成功）
- **框架修复**：`BENCHMARK_MODE=1` 时跳过整个 Phase 0 body（R5 修复不完整：仅跳过 install-aida.sh，Phase 0 清理步骤仍摧毁 benchmark 环境）
- **排名**：
  1. **Kimi K2.5** (8.70/10) — 45P/0F/3W，零 FAIL + 完整管理闭环
  2. **Gemini 3.1 Pro** (8.30/10) — 45P/1F/2W，最多管理触发(14)，完整闭环
  3. GPT-5.4 (7.85/10) — 44P/0F/3W，最多实体(47)，业务理解出色
  4. Claude Opus 4.6 (7.55/10) — 43P/1F/4W，最强响应质量，发布最多(15)
  4. Qwen3.5-Plus (7.55/10) — 42P/0F/5W，最多蓝图(2)，最强自进化
  6. GLM-5 (1.10/10) — 33P/1F/13W，陷入诊断循环
- **关键发现**：
  - 管理闭环是最大分化维度：Gemini(14 violations) + Kimi 完整 > Claude 大部分 > 其余未闭合
  - 管理合规度 > 创建数量：GPT 创建最多实体(47)但 0 发布，Gemini 最少实体(3)但管理链最完整
  - 前 5 名均达 7.5+/10 生产可用水平
- **残留问题（R7）**：`collect-metrics.sh` SSH 崩溃 + "Argument list too long"
- **推荐生产配置**：`moonshot/kimi-k2.5`（主）+ `google/gemini-3.1-pro-preview`（备）+ `dashscope/qwen3.5-plus`（替补）

### 多模型基准测试 R7 — 首轮完整数据采集（2026-03-11）
- 综合报告：`test/e2e/benchmark/results/R7-BENCHMARK-REPORT-CN.md`
- **目标**：修复 R6 数据采集管线，首轮 6/6 模型 metrics + behavior + session JSONL 全部采集成功
- **框架修复**：collect-metrics.sh 重写（移除 set -e, temp 文件替代 argv, JSONL 提前下载）+ agent config 污染修复（agents.list trim）
- **排名**：
  1. **GPT-5.4** (8.55/10) — 46P/0F/2W，最佳 E2E + 管理 RESTRICTED
  2. **Claude Opus 4.6** (8.50/10) — 38P/1F/8W，164 工具调用（105 BPS）+ 53 实体
  3. Kimi K2.5 (6.50/10) — 40P/0F/8W，23 violations（最多管理触发）
  4. Gemini 3.1 Pro (5.90/10) — 44P/1F/3W，15 发布文件（最多）
  5. Qwen3.5-Plus (5.45/10) — 39P/1F/7W，最清晰二层路由 + Config 自毁
  6. GLM-5 (1.30/10) — 35P/1F/11W，从未收到业务提示
- **关键发现**：
  - GPT-5.4 取代 Kimi 成为最佳：唯一触发 RESTRICTED 熔断器 + 零 FAIL
  - Claude 工具调用量是第二名的 1.9 倍，但 0 管理触发 — 工具量 ≠ 管理合规
  - agent-create 的 tools.profile 非法值是致命陷阱（Qwen R5→R7 损失 2.30 分）
  - R6→R7 评分基准变化：R7 首次基于完整数据，分数变化含评分精度提升因素
- **推荐生产配置**：`openrouter/openai/gpt-5.4`（主）+ `openrouter/anthropic/claude-opus-4.6`（备）+ `moonshot/kimi-k2.5`（替补）

### 三框架差距分析 P0 实施（2026-03-11）
- 差距分析报告：`archive/AIDA差距分析-三框架视角 (2026-03-11).md`
- **分析框架**：操作系统理论 × 控制论 × 有限理性，三框架交叉验证
- **P0-a 管理绕过封堵**（已完成）：
  - `src/governance/constants.ts` 新建 — `GATED_WRITE_TOOLS` 单一来源（8 个写操作工具）
  - `bps_load_blueprint`、`bps_register_agent`、`bps_load_governance` 纳入 ActionGate 管理
  - `buildEvalContext` 新增工具专用上下文字段（toolsProfile、persist、hasYaml、inlineYaml）
  - `DEFAULT_SCOPE_WRITE_TOOLS`（7 个，排除 `bps_load_governance`）用于 flat-format 约束默认 scope
  - Dashboard `replayToolCall` 新增 3 个 case
  - 管理覆盖：5/16 → 8/16 工具（8 读 + 8 写全部受管理管控）
- **P0-b 调度器基础修复**（已完成）：
  - ProcessDef 新增 `deadline` 字段，`bps_processes` 表新增 `deadline` 列
  - `bps_create_task` 暴露 `priority`（int）+ `deadline`（ISO 8601）参数
  - `bps_scan_work` 新增 `overdueTasks` 分组 + `sortByUrgency`（deadline ASC, priority DESC）
- **P0-c outcome 结构化**（已完成）：
  - `bps_complete_task` 新增 `outcome` 参数（success/partial/failed，默认 success）
  - outcome 存入 context snapshot `_outcome` 字段
  - `bps_scan_work` 新增 `outcomeDistribution` 摘要（success/partial/failed 计数）
- **测试**：+20 新测试（13 P0-a + 4 P0-b + 3 P0-c），总计 419 tests
- **BPS tools**：16 个（14 base + 2 conditional），8 个受管理管控

### 三框架差距分析 P1 实施（2026-03-11）
- **P1-a 熔断器自动恢复**（已完成）：
  - `ActionGate.tryCooldownRecovery()` — 冷却期后自动降级（DISCONNECTED→RESTRICTED→WARNING→NORMAL）
  - 振荡检测：1h 内 >3 次状态转移则锁定当前状态，emit `governance:oscillation_detected`
  - `CB_DOWNGRADE` 映射 + `stateTransitionCount` 追踪
- **P1-b 信息摘要层**（已完成）：
  - `bps_scan_work` 增强：各分组返回 top-5（`{items, total, showing}` 元数据）+ `summary` 一行摘要
  - `bps_query_entities` 新增 `brief` 模式（只返回 entityType/entityId/version/updatedAt，无 data）
  - `bps_next_steps` 新增 `recommendation` 字段（推荐下一步动作）
- **P1-c Skill 使用追踪**（已完成）：
  - `bps_skill_metrics` SQLite 表（skillName, invokedAt, outcome, durationMs）
  - `src/store/skill-metrics-store.ts` — record/getSummaries/getDormantSkillNames
  - `bps_complete_task` 自动记录 skill 指标（serviceId 匹配 skillsDir 目录）
  - `bps_scan_work` 新增 `dormantSkills`（90 天未使用的 Skill 列表）
  - `BpsEngine` 接口扩展 `skillMetricsStore` 字段
- **测试**：+10 新测试（2 P1-a + 4 P1-b + 4 P1-c），总计 429 tests

### 三框架差距分析 P2 实施（2026-03-11）
- **P2-a 进程组**（已完成）：
  - `ProcessDef` 新增 `groupId` 字段，`bps_processes` 表新增 `group_id` 列 + 索引
  - `bps_create_task` 暴露 `groupId` 参数
  - 新增 `bps_batch_update` 工具（#17）：按 groupId 批量更新任务状态（支持 filterState 过滤）
  - `GATED_WRITE_TOOLS` 扩展为 9 个（+bps_batch_update）
  - `taskSummary` 返回 groupId 字段
- **P2-b 实体关系声明**（已完成）：
  - `DossierDef` 新增 `relations` 字段（`Array<EntityRelation>`），`bps_dossiers` 表新增 `relations TEXT` 列
  - `EntityRelation` 类型定义：`targetEntityType + targetEntityId + relationType`（depends_on/part_of/references）
  - `DossierStore.setRelations()` 方法
  - `bps_update_entity` 接受 `relations` 参数（替换式）
  - `bps_get_entity` 返回 `relatedEntities` 摘要（类型 + ID + updatedAt + version）
  - **不做级联更新** — 变更传播由 Agent 决定
- **测试**：+5 新测试（3 P2-a + 2 P2-b），总计 434 tests
- **BPS tools**：17 个（15 base + 2 conditional），9 个受管理管控

### 三框架差距分析 P3 实施（2026-03-11）
- **P3 审批模式学习**（已完成）：
  - `GovernanceStore.getConstraintEffectiveness()` — 按 constraintId 聚合违规计数 + 审批通过/拒绝率
  - 策略建议引擎：审批通过率 >90%（样本≥20）→ "过于严格，考虑放宽"；拒绝率 >80% → "有效，考虑升级为 BLOCK"
  - `bps_governance_status` 返回 `constraintEffectiveness` 字段
  - **不做自动调整** — 策略变更始终由人类确认
- **测试**：+2 新测试，总计 436 tests（P0→P3 共 +45 新测试）

### 结构能力 E2E 测试 R1（2026-03-11）
- 测试方案：`test/e2e/structural-capability-test.md`，脚本：`test/e2e/structural-capability.sh`
- R1 报告：`test/e2e/structural-capability/R1-REPORT.md`
- **目标**：验证测试框架自身（P0-P3 全 9 维度 50 结构检查点）
- **结果**：63 PASS / 0 FAIL / 1 WARN / 64 TOTAL — ALL CHECKS PASSED（5 秒，engine-only 模式）
- **框架修复 7 项**：processTracker→tracker, DB 清理, 违规累积隔离 `resetGovernance()`, 递归修复, D7 违规补种
- **代码 bug 修复 2 项**：
  - `bps_query_tasks` 缺少 `groupId/priority/deadline` 字段（`src/integration/tools.ts`）
  - Dashboard `/api/governance/status` 缺少 `constraintEffectiveness` 和 `circuitBreakerState`（`dashboard/server/routes.ts`）
- **评审修订 7 项**：覆盖矩阵计数, S2.17/S2.30/S2.33 测试逻辑, warn_ TOTAL, --phase 校验, S3.08 approvals decide
- **测试**：436 单元测试全部通过

### 结构能力 E2E 测试 R2（2026-03-11）
- R2 报告：`test/e2e/structural-capability/R2-REPORT.md`
- **目标**：验证 Agent 工具调用 + 管理拦截（full 模式，含 Phase 4 Agent turns）
- **结果**：70 PASS / 0 FAIL / 2 WARN / 72 TOTAL — ALL CHECKS PASSED（70 秒）
- **模型**：moonshot/kimi-k2.5，3 个 Agent turns
- **Agent 表现**：
  - Turn 1：`bps_scan_work` + `bps_query_entities` → 工作全景 + 实体清单
  - Turn 2：`bps_get_entity` + `bps_governance_status` → 实体关系 + 管理效能分析
  - Turn 3：`bps_update_entity` → 管理 REQUIRE_APPROVAL 拦截成功，输出审批 ID + Dashboard 引导
- **2 WARN**：S3.08（Dashboard 审批 API 无 PENDING 数据）、V4.2（中文"总结"未匹配英文 summary 关键词）
- **结论**：Kimi K2.5 可有效消费 P0-P3 全部新增结构能力

### 结构能力 E2E 测试 R3 — IdleX GEO Business Edition（2026-03-11）
- R3 报告：`test/e2e/structural-capability/R3-REPORT.md`
- **目标**：业务场景驱动 — 一个 GEO 负责人配合 Aida 完成闲氪全部 GEO 运营任务
- **结果**：91 PASS / 2 FAIL / 4 WARN / 97 TOTAL（576s, 9.6 分钟）
- **模型**：moonshot/kimi-k2.5，7 个 Agent turns + 1 个程序化审批
- **测试覆盖升级**：Phase 4 从 3 技术 turns 扩展为 8 步业务场景（介绍→授权→运营→发布→审批→自进化→日结→管理审计）
- **加权总分：92.25/100**（业务理解95, 工具调用85, 二层路由100, 管理闭环95, 自进化85, 响应质量95）
- **关键成果**：
  - Agent 创建 7 个业务实体（geoProbe×3, geoContent×3, geoCampaign×1）+ 2 个 Skill + 3 个 Cron
  - 管理 vs 运营路由 100% 正确（约束→管理层, 内容/探测→运营层）
  - 管理拦截→审批→执行闭环 100% 通过
  - Turn 8 管理审计：主动发现约束语法缺陷并提出修复方案
- **2 FAIL 原因**：S3.06（Dashboard 延迟未看到全部种子实体），V5.2（Aida 重载管理约束从 3→2 个）— 均为 Aida 主动行为与静态种子的冲突，非系统缺陷
- **新发现**：Governance 约束条件语法不兼容（expr-eval 变量访问 vs Aida 生成的条件），导致过度拦截但不影响管理闭环

### 管理约束语法修复（2026-03-11，R3 #2 修复）
- **问题**：`evaluateConstraint()` 对所有 expr-eval 错误 fail-closed（`passed: false`），包括 "undefined variable" 错误 — 导致不含目标字段的操作被误报为违规
- **根因链**：Aida 生成约束（如 `publishReady == true`）无 `scope.dataFields` → 所有 `bps_update_entity` 调用均触发该约束 → 操作上下文无 `publishReady` 变量 → expr-eval 抛 "undefined variable" → fail-closed → 过度拦截（含 `bps_register_agent`）→ Agent workspace 创建失败
- **修复**：`src/governance/action-gate.ts` `evaluateConstraint()` 区分两类错误：
  - "undefined variable" → `passed: true`（约束不适用于此操作，静默跳过）
  - 其他表达式错误（语法错误等）→ `passed: false`（仍 fail-closed）
- **文档**：`agents/Aida/TOOLS.md` 新增 "Governance Constraint Syntax" 节（可用变量、scope 规则、示例）
- **测试**：原 1 个 fail-closed 测试拆为 2 个（undefined variable → PASS + 语法错误 → BLOCK），总计 437 tests

### 测试自主性优化（2026-03-11，R3 #1/#5 修复）
- **#1 路径自主**：Turn 3 删除 mock-publish-tmp 路径指令，Phase 1 不再预创建目录，B4.12/V5.6 改为 session JSONL write tool 调用检测
- **#5 两阶段发现**：TOOLS.md 删除 two-stage 完整流程预设，仅保留管理拦截行为说明
- 测试不再指定 Aida 的内容输出路径，也不再预置发布工作流——观察 Aida 是否自主发现

### 结构能力 E2E 测试 R4 — 修正效果验证（2026-03-11）
- R4 报告：`test/e2e/structural-capability/R4-REPORT.md`
- **目标**：验证 R3 修正（#2 管理语法 + #1 路径自主 + #5 两阶段发现）的效果
- **结果**：92 PASS / 1 FAIL / 4 WARN / 97 TOTAL（847s, 14 分钟）
- **修正效果**：
  - #2 管理语法：violations 19→4（-79%），B4.17/B4.18/B4.19 从 WARN→PASS，HITL 闭环首次完整通过
  - #1 路径自主：Aida 自主选择 `~/.aida/geo-content/`，JSONL 检测 6 次 write calls，V5.6 PASS
  - #5 两阶段发现：Aida 从管理拦截自然推导出发布→审批→分发流程
- **1 FAIL**：V5.2 constraints=2（Aida 自建覆盖种子 3），建议阈值改为 ≥2
- **遗留**：Turn 6 `unexpected_state` 仍阻止 Agent workspace 创建（OpenClaw 框架问题）

### Governance→Management 术语重命名（2026-03-11）
- **决策**：将代码和 Aida 接触面中的 "Governance" 全部替换为 "Management"，"Governance" 一词保留给未来 Aida 与实例外部治理层的治理约定
- **语义区分**：Management = Aida 实例内约束/审批系统（管理层），Governance = 未来外部治理层（保留）
- **文件重命名**（`git mv`）：
  - `src/governance/` → `src/management/`（含 management-store.ts, management-loader.ts, action-gate.ts, constants.ts, types.ts）
  - `test/governance.test.ts` → `test/management.test.ts`
  - `dashboard/test/api-governance.test.ts` → `dashboard/test/api-management.test.ts`
  - `dashboard/client/src/pages/GovernancePage.vue` → `dashboard/client/src/pages/ManagementPage.vue`
  - `dashboard/blueprints/governance.yaml` → `dashboard/blueprints/management.yaml`
- **内容替换**（~50 个非归档文件）：
  - 变量/类名：`govStore` → `mgmtStore`, `GovernanceStore` → `ManagementStore`, `GovernanceLoader` → `ManagementLoader`
  - DB 索引：`idx_gov_` → `idx_mgmt_`
  - 函数名：`resetGovernance` → `resetManagement`, `loadGovernance` → `loadManagement`
  - 工具名：`bps_governance_status` → `bps_management_status`, `bps_load_governance` → `bps_load_management`
  - API 路径：`/api/governance/` → `/api/management/`
  - DB 表名：`bps_governance_*` → `bps_management_*`
  - 事件名：`governance:*` → `management:*`
  - E2E 脚本、Agent workspace（TOOLS.md）同步更新
- **测试**：437 tests 全部通过，TypeScript 编译无错误

### AIDA 评估理论框架 (AEF) v0.1（2026-03-12）
- 框架文档：`docs/AIDA评估理论框架 (AEF) v0.1.md`
- 认知理论关联分析：`archive/AIDA与认知理论的双维度关联分析 (2026-03-12).md`
- **四元理论基座**：OS 理论（正确性）+ 控制论（调节有效性）+ 有限理性（Agent 可用性）+ 认知导航-重映射（适应性）
- **十一维能力结构**：Σ1 PROC, Σ2 ENTITY, Σ3 GATE, Σ4 STAB, Σ5 FDBK, Σ6 INFO, Σ7 SCHED, Σ8 EVOL, Σ9 HIER, Σ10 COADAPT, Σ11 MATCH
- **Σ11 MATCH（能力匹配度）**：评估基础设施对模型能力的阻抗匹配——过度制约（Over-constraint）vs 支持不足（Under-support）
  - 核心理论：Ashby 必要多样性逆定理——模型能力超越控制器假设时，控制器变瓶颈
  - 能力演进图谱新增 Stage 4.5（能力匹配自适应）：信任分级、约束自衰减、工具自适应粒度
- **AEF 补充测试**：`test/e2e/aef-capability.sh`，24 检查点全部通过
  - Σ1 PROC (6) + Σ7 SCHED (5) + Σ9 HIER (3) + ΣX Cross (6) + Σ11 MATCH (4)
  - Engine-only in-memory 模式，~3 秒执行

### AEF Capability E2E 测试 R1（2026-03-12）
- 测试方案：`test/e2e/aef-capability-test.md`，脚本：`test/e2e/aef-capability.sh`
- R1 报告：`test/e2e/aef-capability/R1-REPORT.md`
- **定位**：structural-capability 的全面升级版 — 相同部署/业务场景/Agent turns，AEF Σ1-Σ11 十一维全覆盖
- **结果**：**124 PASS / 0 FAIL / 4 WARN / 128 TOTAL** — ALL CHECKS PASSED
- **模型**：dashscope/qwen3.5-plus（primary），kimi/kimi-for-coding（fallback）
- **测试结构**：
  - Phase 0: 安装验证 (7)
  - Phase 1: 数据种子 (5)
  - Phase 2: 引擎测试 D1-D8 + AEF Σ1-Σ11 (**69 checks** = 39 结构 + 30 AEF)
  - Phase 3: Dashboard API (11)
  - Phase 4: 业务场景 IdleX GEO (27, 8 Agent turns)
  - Phase 5: 最终验证 (9)
- **AEF 维度健康度**：Σ1-Σ11 全部 1.00 HEALTHY
- **Agent 产出**：8 实体 + 4 Skill + 1 Blueprint + 1 Agent workspace + 3 内容文件 + 2 管理违规
- **4 WARN**：全部因熔断器 DISCONNECTED 导致 REQUIRE_APPROVAL 路径不可达（管理行为正确，非缺陷）
- **调试修复 5 项**：E1.03/04 outcome 存储路径、EX.04 violations 表 schema、E11.07 ConstraintDef 必需字段、EX.06 priority 排序
- **与 structural-capability 对比**：128 vs 97 检查，69 vs 39 引擎检查，新增维度健康度报告

### AEF Capability E2E 测试 R2（2026-03-12）
- R2 报告：`test/e2e/aef-capability/R2-REPORT.md`
- **目标**：修复 R1 的 4 WARN（B4.18/B4.19/S3.08 审批闭环 + B4.06 实体创建）
- **结果**：**122 PASS / 0 FAIL / 6 WARN / 128 TOTAL**
- **根因分析**：Phase 2 引擎测试为 S3.03 种植 CRITICAL 违规 → CB API reset 只重置 state 不清 violations → `updateCircuitBreaker()` 重计 1h 窗口 → CB 持续 DISCONNECTED → Turn 4 始终 BLOCK（非 REQUIRE_APPROVAL）
- **修复**：Phase 4 启动前 + Turn 4 前两点管理状态重置（清 violations + CB 列归零 + API reset）
- **HITL 审批闭环首次完整通过**：Turn 3 触发违规 → Turn 4 清理后 REQUIRE_APPROVAL → Step 5 程序化审批 → Turn 6 CB 重置后恢复
- **R1→R2 改善**：3 WARN→PASS（B4.06/B4.18/B4.19），2 新 WARN（LLM 行为差异）
- **R3 改进方向**：V5.7 改为 JSONL 管理消息检测；S3.08 移至 Step 5 立即验证；B4.15 JSONL fallback

### AEF Capability E2E 测试 R3-R5（2026-03-12）
- R3 报告：`test/e2e/aef-capability/R3-REPORT.md`
- **R3 结果**：**123 PASS / 0 FAIL / 5 WARN / 128 TOTAL**（最佳轮次）
  - V5.7 JSONL 检测：WARN→PASS（JSONL msgs=24, DB violations=0）
  - B4.15 JSONL fallback：WARN→PASS（violations=3 in DB）
  - S3.08 根因发现：`/api/management/approvals` 只返回 PENDING（设计如此），已改为直接查 SQLite
  - 框架 WARN 从 4→3→1 收敛，剩余 4 WARN 全部为 LLM 行为（Turn 2/3 截断）
- **R4 结果**：114P/0F/14W — Qwen3.5-plus LLM 方差导致 Turn 4/6 截断（2 行），HITL 路径未触发
- **R5 结果**：116P/0F/12W — kimi/kimi-for-coding 在 embedded 模式下返回 403（`only available for Coding Agents`），不适合此测试
- **R3-R5 关键改动**：
  - V5.7 改用 session JSONL grep 检测管理消息（不受 DB 清理影响）
  - B4.15 增加 JSONL fallback（DB violations=0 时检测 JSONL）
  - S3.08 直接查 SQLite `bps_management_approvals` 表
  - Turn 6 CB 重置增加 DB 清理（防止 1h 窗口 re-trip）
  - V0.7 模型检查接受两种基线（qwen3.5-plus 或 kimi-for-coding）
  - 报告模板改用动态 `$ACTUAL_MODEL`
- **结论**：dashscope/qwen3.5-plus 仍为最佳基线模型；框架问题基本收敛（1 WARN），LLM 方差是主要不确定性

### 协作输入机制（2026-03-14）
- 评估报告：`archive/协作输入机制升级评估 (2026-03-13)-GLM-5.md`
- 评审报告：`archive/AIDA能力价值双视角评审 (2026-03-14)-Claude Opus 4.6.md`
- **核心决策**：协作输入（HITL/AITL）作为独立模块 `src/collaboration/`，与 Management 审批并行，不替换
- **评审要点**：Management 审批（"是否允许"，有 replayToolCall 语义）≠ 协作输入（"需要信息"，Agent 消费响应）
- **P0 实现**（form-only）：
  - `src/collaboration/types.ts`：CollaborationTask 类型定义（status/priority/context/inputSchema/response）
  - `src/collaboration/collaboration-store.ts`：SQLite 持久化（bps_collaboration_tasks 表）+ EventEmitter（3 事件）
  - `bps_request_collaboration` tool (#18)：Agent 创建协作任务（title/description/inputSchema/priority/expiresIn）
  - `bps_get_collaboration_response` tool (#19)：Agent 查询协作响应
  - `BpsEngine` 扩展 `collaborationStore` 字段，OpenClaw 插件自动注入
  - Dashboard API：5 个 endpoint（tasks list/detail/respond/cancel/status）
  - Dashboard SSE：3 个实时事件（task_created/task_responded/task_cancelled）
- **设计简化**（相对于 GLM-5 原提案）：
  - 删除 `mixed` 类型 — 无具体场景
  - 删除 `CollaboratorIdentity` 三态抽象 — MAOr 协作方均为人类，用简单 string respondedBy
  - 不做 `wait: true` 忙轮询 — Agent 应异步检查
  - form 覆盖全部场景（approval = boolean 字段的 form, choice = enum 字段的 form, text = string 字段的 form）
- **MAOr 驱动的需求场景**：面诊参数填写（医生）、知情同意确认（护士/患者）、治疗用量记录（医生）、术后随访观察（护士）
- **测试**：+28 新测试（17 engine + 11 Dashboard），总计 475 tests
- **BPS tools**：19 个（15 base + 2 management + 2 collaboration）

### 工具观测层 + 信息饱和信号（2026-03-14）
- **ToolObserver**（`src/integration/tool-observer.ts`）：OpenClaw `after_tool_call` Hook 观测层
  - 全景观测：为原生工具（write/edit/exec）emit 事件到 Dashboard SSE
  - 纵深防御：检测 Agent 通过原生文件 I/O 绕过 BPS 工具写入 AIDA 数据目录（管理绕过检测）
- **信息饱和信号**：4 层反「说而不做」机制（详见 commit `386f8b4`）
- **AIDA 能力清单**：65 个能力 + AEF 映射（详见 `docs/`）
- **E2E 测试框架改进**：SC_MODEL 环境变量 + 模型验证探针 + 脚本清理标准化
- **模型更新**：moonshot/kimi-k2.5（已弃用）→ kimi/kimi-for-coding

### BPS 论文研究
- 论文标题: 《AI-Native 组织运营的计算机科学原理》
- 状态: 学术工作暂时搁置，聚焦商业落地
- 详见 `research/paper_proposal.md`

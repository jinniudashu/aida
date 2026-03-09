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
│   ├── store/                ← SQLite 持久化（6 文件）
│   ├── engine/               ← 任务追踪 + 状态机（2 文件）
│   ├── governance/           ← 治理层（4 文件）
│   ├── knowledge/            ← BKM 知识管理（3 文件）
│   ├── loader/               ← 项目装载（4 文件）
│   ├── integration/          ← OpenClaw 桥接（5 文件）
│   ├── mcp/                  ← MCP Server（1 文件）
│   ├── schema/               ← TypeBox 类型定义（8 文件）
│   ├── system/               ← 项目初始化（1 文件）
│   └── index.ts              ← 主导出 + createBpsEngine()
├── dashboard/                ← Dashboard（Vite + tsx 编译域，平行于 src/）
│   ├── client/               ← Vue 3 SPA（13 页面）
│   ├── server/               ← Hono API + SSE（33 endpoints）
│   ├── test/                 ← Dashboard API 测试（112 tests）
│   └── blueprints/           ← 演示蓝图
├── test/                     ← 引擎核心测试（255 tests）
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
- Vitest（测试框架）, 391 tests（266 引擎 + 125 Dashboard）

### erpsys（BPS 引擎 Django 版，仅供借鉴）
- Django 4.2.7, DRF, PostgreSQL/SQLite, Redis, Celery, Django Channels

## 开发命令

```bash
npm install               # 安装依赖
npx tsc --noEmit          # 引擎类型检查
npx vitest run            # 全部测试（引擎 255 + Dashboard 112 = 367）
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
- **工具总览**：14 BPS tools + 3 MCP tools
  - bps_list_services, bps_create_task, bps_get_task, bps_query_tasks, bps_update_task, bps_complete_task, bps_get_entity, bps_update_entity, bps_query_entities, bps_next_steps, bps_scan_work, bps_create_skill, bps_load_blueprint, bps_governance_status
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

### Phase E1：Agent 治理层实现（2026-03-05）
- 讨论纪要：`archive/Blueprint治理层讨论纪要 (2026-03-05).md`
- 治理层设计文档：`docs/Agent 治理层规范 (AGS) v0.1.md`
- **核心决策**：Blueprint 从"流程编排器"重定位为"治理宪法"——定义 Agent 不能做什么，而非应该做什么
- **治理层实现**（`src/governance/`，4 文件）：
  - `types.ts`：类型定义（Constraint/Verdict/CircuitBreakerState/ViolationRecord/ApprovalRequest）
  - `governance-store.ts`：SQLite 持久化（4 表：constraints/violations/circuit_breaker/approvals）
  - `action-gate.ts`：前置拦截器（scope 匹配 + expr-eval 求值 + verdict 判定 + 熔断器状态机）
  - `governance-loader.ts`：governance.yaml 解析 + 校验
- **工具集成**：
  - 5 个写操作工具自动包装治理检查（bps_update_entity/create_task/update_task/complete_task/create_skill）
  - 新增 `bps_governance_status` tool (#13)：查询熔断器状态 + 违规记录 + 待审批
- **loadAidaProject() 扩展**：自动加载 `~/.aida/governance.yaml`，返回 `governance` 字段
- **governance.yaml**：治理约束定义文件，存放于 `~/.aida/governance.yaml`
- **DossierStore 修复**：smartMerge 实现数组追加语义（P1 fix，3 新测试）
- **测试**：31 新测试（GovernanceStore 6 + GovernanceLoader 5 + ActionGate 9 + CircuitBreaker 7 + ToolWrapper 3 + 1），bps-engine 总计 252 tests

### Phase E2：Dashboard 三问题 + 治理全景（2026-03-05）
- **Overview 页重构**：三面板回答"现状/目标/下一步"
  - Panel 1（现状）：实体/任务/错误计数 + 实体类型标签 + 治理熔断器状态 + 违规徽章
  - Panel 2（目标）：Action Plan 进度条 + 完成率 + 周期任务计数
  - Panel 3（下一步）：任务队列分状态 + 待审批 + 最近违规记录
- **GovernancePage**（专用治理页面，4 面板）：
  - Panel 1（熔断器）：状态标签 + 约束数 + 待审批数 + 重置按钮（带确认）
  - Panel 2（约束清单）：完整表格（ID/策略/严重级别/动作/条件/scope）
  - Panel 3（治理审批）：待审批列表 + Approve/Reject 模态框（显示 tool input 详情）
  - Panel 4（违规历史）：时间线（严重级别/约束/工具/实体/消息/verdict）
- **治理 API**（bps-dashboard，7 个 endpoint）：
  - `GET /api/governance/status` — 熔断器状态 + 约束数 + 待审批数 + 最近违规
  - `GET /api/governance/violations` — 违规历史（支持 limit 参数）
  - `GET /api/governance/constraints` — 约束完整列表
  - `GET /api/governance/approvals` — 治理层待审批列表
  - `POST /api/governance/approvals/:id/decide` — 审批/拒绝
  - `POST /api/governance/circuit-breaker/reset` — 重置熔断器
- **治理端到端验证**：
  - 关键修复：governance wrapper 从返回 `{success:false}` 改为 throw Error（LLM 可靠识别工具失败）
  - Agent 测试通过：REQUIRE_APPROVAL → Agent 报告拦截 + 审批单号 + Dashboard 链接
  - BLOCK 测试通过：CRITICAL 违规 → Agent 报告直接拒绝 + 熔断器断开
  - 发现：OpenClaw gateway 需要重启才能加载新插件代码
- **Approval→Execution 闭环**：Dashboard 审批通过后自动执行原始工具调用
  - `replayToolCall()` 支持全部 5 个写操作工具（update_entity/create_task/update_task/complete_task/create_skill）
  - 前端审批后显示执行结果模态框（成功/失败）
  - 端到端验证通过：APPROVED → 实体写入 + 版本递增；REJECTED → 无执行
- **测试**：Dashboard 112 tests（+11 治理测试），引擎 255 tests，合计 367

### OpenClaw 集成加固（2026-03-06）
- 评估报告：`archive/AIDA-OpenClaw利用充分度评估 (2026-03-06).md`
- 研究报告重写：`docs/OpenClaw框架技术研究报告.md` v1→v2（源码分析→官方文档，462→733 行）
- **评估结论**：核心路径深（Plugin/Tool/Event/Workspace/Skills），外围配置浅（全部依赖默认值）
- **已落地优化**（install-aida.sh 配置合并 + AGENTS.md）：
  - P0 安全基线：`tools.exec.security: "allowlist"` + Red Line 禁止文件 I/O 绕过治理
  - P0 模型 Fallback：`fallbacks: [claude-sonnet-4-6, gpt-4.1]`
  - P1 BOOT.md 激活：`hooks.internal.enabled: true`
  - P1 Compaction 记忆冲刷：`compaction.memoryFlush.enabled: true`
  - P1 Cron 恢复：Boot 步骤 4 验证/重注册 cron 任务
  - P2 语义搜索：AGENTS.md Memory 节加入 `memory_search` 指引
  - P2 循环检测 + 上下文修剪：`loopDetection` + `contextPruning` 配置
- **治理 SSE 修复**（同日早期）：GovernanceStore 继承 EventEmitter，emit 4 个治理专用事件，Dashboard SSE 直接转发

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
- **加权总分：87/100**（业务理解 95, 运营体系 90, 内容质量 90, 治理合规 70, 自进化 100, 可观测 50）
- **Self-Evolution 100%**：Skill 创建（geo-ops，prospective gap）+ Agent 创建（krypton-assistant，persona isolation）均一次通过
- **业务覆盖 86%**：7 项 WORKING + 1 项 DESIGNED，日均管理工作量 ~15 分钟
- **P0 待修复**：Dashboard Vite 构建路径（SPA 404）、内容发布绕过治理（需 Skill 级约束）
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
- **核心优势**：架构方向正确、测试覆盖充分、治理层完善
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
- **二层路由机制**：强制 Aida 在设计时区分治理层（Blueprint）vs 运营层（Entity + Skill）
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
- **加权总分：60/100**（部署 100, 业务理解 95, Two-Layer 路由 85, 建模执行 25, 内容质量 90, 治理闭环 15, 自我进化 10）
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
- **持续问题**：治理绕过（连续 3 次测试 — write 工具直接写文件，不经 bps_update_entity）
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
- **持续问题**：Gateway auth-profiles.json 缺失导致每轮降级 embedded 模式；治理绕过（第 4 次复现，Aida 自建文件级审批流替代）
- **LLM 模型结论**：`openrouter/openai/gpt-5.4` 确认可用且效果最佳；注意 `openai/` 前缀路由到原生 OpenAI（不兼容），必须用 `openrouter/` 前缀

### 第三方专家评估（2026-03-09）
- 评估报告：`archive/AIDA项目第三方专家评估报告 (2026-03-09).md`
- **综合评分：8.4/10**（理论原创 9.5 / 架构完整 8.5 / 工程质量 8.0 / 治理能力 9.0 / 测试覆盖 8.8 / 实用成熟 7.5 / 可扩展性 8.0）
- **核心结论**：AIDA 是理论原创、架构完整、工程扎实的 AI-Native 组织运营基础设施平台
- **双引擎对比**：erpsys（Django 参考）→ bps-engine（TypeScript 生产版）演进路径合理
- **P0 建议**：Blueprint 编译器完善、文件 I/O 治理绕过修复、Gateway 热加载
- **SWOT 分析**：优势（理论原创+治理领先+工程扎实），劣势（业务验证有限+模型依赖），机会（市场空白+学术价值），威胁（LLM 能力进化+大厂竞争）

### 六模型隔离 Benchmark（2026-03-09，进行中）
- 新增独立测试目录 `test/e2e/model-benchmark-gpt5.4/`，与历史 `benchmark-results/` 分离，支持 preflight / 单模型运行 / 汇总报告
- **已完成并提交推送**：GPT-5.4、Claude Opus 4.6、Gemini 3.1 Pro、Kimi K2.5、Qwen3.5-Plus、GLM-5 六个模型的独立结果目录与评测报告
- **关键发现**：
  - `install-aida.sh` 会覆盖 OpenClaw 默认主模型，需要 benchmark 脚本在安装阶段注入 `AIDA_BENCHMARK_PRIMARY`
  - Gemini 样本最初失败源于 provider id 误写为 `google-generativeai`；修正为 OpenClaw 内建的 `google-generative-ai` 后复测通过，Gemini 3.1 Pro 成为当前 benchmark 第一梯队样本
  - Claude Opus 4.6 在业务理解、实体化落地与治理触发上表现最佳之一；Kimi / Qwen 稳定性较好；GLM-5 存在明显会话承接漂移

### BPS 论文研究
- 论文标题: 《AI-Native 组织运营的计算机科学原理》
- 状态: 学术工作暂时搁置，聚焦商业落地
- 详见 `research/paper_proposal.md`

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
│   ├── loader/               ← 项目装载（3 文件）
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
- Vitest（测试框架）, 367 tests（255 引擎 + 112 Dashboard）

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
- **工具总览**：13 BPS tools + 3 MCP tools
  - bps_list_services, bps_create_task, bps_get_task, bps_query_tasks, bps_update_task, bps_complete_task, bps_get_entity, bps_update_entity, bps_query_entities, bps_next_steps, bps_scan_work, bps_create_skill, bps_governance_status
- **Aida Skills**：7 个（project-init, action-plan, dashboard-guide, blueprint-modeling, agent-create, business-execution, skill-create）

### 端到端能力验证 -- 基础设施级（2026-03-05）
- 详见 `archive/AIDA端到端能力验证报告 (2026-03-05).md`
- **验证方法**：三视角（第三方专家 → Aida 自评 → 综合测试），干净环境重新安装 + 41 项自动化测试 + 319 单元测试
- **测试结果**：40/41 通过（1 个测试脚本 bug，非引擎问题），319 单元测试全部通过
- **加权完成度**：93.25%（部署100%, 设计时95%, 运行时85%, 可观测100%, HITL100%, 外部出口90%）

### 端到端能力验证 -- OpenClaw 运行时（2026-03-05）
- 详见 `archive/AIDA端到端能力验证报告-OpenClaw运行时 (2026-03-05).md`
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
- 评估报告：`archive/IdleX-GEO-E2E-v2-评估报告 (2026-03-07).md`
- 测试方案：`test/e2e/idlex-geo-v2.md`，自动化脚本：`test/e2e/idlex-geo-v2.sh`
- **业务目标**：一个 GEO 负责人 + Aida 完成闲氪全部 GEO 运营任务
- **加权总分：87/100**（业务理解 95, 运营体系 90, 内容质量 90, 治理合规 70, 自进化 100, 可观测 50）
- **Self-Evolution 100%**：Skill 创建（geo-ops，prospective gap）+ Agent 创建（krypton-assistant，persona isolation）均一次通过
- **业务覆盖 86%**：7 项 WORKING + 1 项 DESIGNED，日均管理工作量 ~15 分钟
- **P0 待修复**：Dashboard Vite 构建路径（SPA 404）、内容发布绕过治理（需 Skill 级约束）
- **P1 待修复**：install-aida.sh 旧路径清理逻辑

### BPS 论文研究
- 论文标题: 《AI-Native 组织运营的计算机科学原理》
- 状态: 学术工作暂时搁置，聚焦商业落地
- 详见 `research/paper_proposal.md`

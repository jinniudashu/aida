# AIDA 开发历程笔记（历史文档）

> **⚠️ 本文件为历史文档，记录 Phase 1-11 的开发历程。**
> Phase 12 及之后的进展、当前架构状态请参阅：
> - `CLAUDE.md` — 项目进展摘要（每次会话的唯一保证入口）
> - `docs/AIDA 架构决策与现状 (ADR).md` — 详细架构决策与实现状态
> - `archive/AIDA项目全面回顾 (2026-03-04).md` — 全面回顾报告
>
> **后续重大变更（本文未覆盖）**：
> - Phase 12：系统蓝图 sys:project-init
> - Phase 13：Dashboard 部署 + Agent 指令优化
> - 架构反思（2026-03-03）：BPS 运行时引擎价值重估
> - 架构瘦身：engine/ 5→2 文件，knowledge/ 5→3 文件，5-state 模型
> - Sub-agent 吸收：BPS-Expert + Org-Architect → 5 Aida Skills
> - Workspace 精简：500+ 行中文 BPS 理论 → 30 行英文 SOUL + 69 行英文 AGENTS
> - Dashboard 5-state 迁移：78 tests 全部通过

**原始会话开始时间**：2026-02-23
**原始目标**：以IdleX为案例，设计可商业落地的 AI 原生组织架构与系统，触及 AI 原生组织能力边界

---

## 已完成的工作

### Phase 1：上下文理解 ✅
- 已读核心文档：白皮书、差异化战略、GEO 心智战略、供给侧分析、名词手册、城市扩张方案、文档关系分析
- 已读组织设计初稿 V1：六域 17 Agent 固定岗位设计
- 已读工具参考：OpenClaw Agent 框架、BPS 业务流程规范/引擎

### Phase 2：四个前置问题分析 ✅
1. 单Agent多skill：上下文连续性 > 并行效率时用单Agent
2. Skill数量上限：10-20个工具为舒适区，取决于任务域内聚性而非绝对数量
3. 多Agent协同：并行性、异构能力、规模超出单上下文时需要
4. 是否预规划：规划能力注册表+约束规则+目标函数，而非固定Agent拓扑

### Phase 3：架构综合设计 ✅
- 核心洞察：BPS 提供"业务应该如何流转"（What），OpenClaw 提供"Agent如何执行"（How），缺失的是"智能编排层"（When/Who/How many）
- 目标架构：三层模型 = BPS 业务流程层 + 智能编排层 + OpenClaw Agent 执行层
- 输出文档：`IdleXAI-Native组织架构深度分析.md`

### Phase 4：BPS TS 重写决策 ✅
- 决策：将 BPS 从 Django/Python 改写为 TypeScript，作为 OpenClaw 原生模块
- 核心理由：BPS Process 与 OpenClaw Session 在本体论上是同一概念，合并消除协议桥接开销
- SysCall 直接映射 OpenClaw Agent 操作（spawn/send/steer）
- RuleEvaluator 可原生调用 LLM（NON_DETERMINISTIC 支持）

### Phase 5：BPS TS 骨架设计 ✅
- 输出文档：`packages/bps-engine/docs/bps-engine-skeleton.md`
- 已完成源码全量研读：BPS 规范、sys_lib.py、kernel/models.py、design/models.py、kernel/types.py
- 已设计：TypeBox Schema（6 模块）、Engine 核心（5 模块）、OpenClaw 整合层（4 模块）、YAML 加载器
- 关键设计决策：
  - 消除 Design/Kernel 双轨制 → 单层 + status 字段
  - 消除代码生成 → 动态 JSON Schema
  - eval() → expr-eval 安全沙箱 + LLM
  - Celery → OpenClaw sessions_spawn
  - 5 类资源表 → 统一 ResourceRequirement
  - 新增状态机合法迁移约束
  - 新增 NON_DETERMINISTIC 事件评估（LLM）
  - 新增 4 个异常处理指令（retry/terminate/escalate/rollback）

### Phase 6：BPS TS 引擎核心编码 ✅
- 包路径：`packages/bps-engine/`
- **依赖调整**：`better-sqlite3` → `node:sqlite`（Node 24 内建 SQLite，零原生依赖，免编译）
- 源码结构（23 个 TypeScript 文件）：
  - Schema 层（7）：common / entity / service / rule / role / process / resource
  - Engine 层（5）：context / state-machine / rule-evaluator / syscall / process-manager
  - Store 层（3）：db / process-store / blueprint-store
  - Knowledge 层（5）：types / knowledge-store / context-assembler / conflict-detector / system-knowledge
  - Loader（1）：yaml-loader
  - Entry（1）：index.ts
  - Test（1）：engine.test.ts — 17 项基础测试全部通过
- 5 个 SysCall 实现：StartService / CallSubService / CallingReturn / TerminateProcess / EscalateProcess
- ProcessManager：EventEmitter 驱动，支持 process:created / state_changed / completed / rule:evaluated / syscall:executed 事件
- TypeScript 编译 & 构建均通过

### Phase 7：GEO 业务蓝图 MVP ✅
- 蓝图文件：`blueprints/geo-ktv-changsha.yaml` — IdleXGEO门店运营蓝图（长沙自助KTV）
- 测试文件：`test/geo-ktv.test.ts` — 15 项集成测试全部通过
- **全量测试：32 tests, 2 test files, all pass**
- 蓝图规模：12 服务 / 3 事件 / 4 指令 / 11 规则
- 业务流程拓扑：
  ```
  [GEO门店运营] NEW
        │
        ▼ Phase 1: 门店入驻（顺序链）
  [基础数据采集] → [数据核验] → [结构化门店档案生成]
        │
        ▼ Phase 2: GEO内容生产（顺序链）
  [目标模型偏好分析] → [一模一策内容生成] → [内容质量审核(人工)]
        │
        ▼ Phase 3: 多渠道发布（并行扇出）
  [豆包渠道] + [千问渠道] + [元宝渠道]
        │
        ▼ Phase 4-5: 监测与优化
  [GEO效果监测] ──(LLM判断)──→ [内容迭代优化]
  ```
- 编排模式验证：
  - **链式顺序**：进程 TERMINATED 事件触发下一个 start_service
  - **并行扇出**：3 条规则共享同一事件，同时启动三渠道发布
  - **人工介入**：svc-content-review 使用 executorType: manual
  - **LLM 驱动**：evt-needs-optimization 使用 non_deterministic 模式
  - **上下文传递**：实体信息（store/entityId）沿链路自动继承
  - **审计链**：所有规则评估记录在 eventsTriggeredLog 中
- 业务语义对齐：
  - 遵循 GEO 心智战略"三大行动原则"：真字当头、一模一策、履约闭环
  - 遵循城市扩张方案：3公里流量圈、门店零负担、AI闭环
  - Agent Prompt 包含具体业务指导（差异化模型策略、数据核验标准、履约要求）

---

## 关键技术发现（Phase 1-7 时期，部分已过时）

### OpenClaw 对组织设计的关键能力
- `sessions_spawn`：动态创建子Agent（蜂群的基础）
- `sessions_send`：Agent间同步/异步通信
- `steer`：向运行中Agent注入新指令（动态调整）
- Skill 系统：能力的可装配单元
- 双层记忆：短期会话 + 长期向量化（组织知识积累）
- Gateway：中央控制平面（可观测性基础）
- Action Gating：细粒度权限控制（安全约束）
- 生命周期事件：Agent 状态完整可追踪（审计基础）
- `inputProvenance`：消息溯源（决策链追溯）
- `extraSystemPrompt`：动态角色赋权（按需赋能）

### BPS 对组织设计的关键能力
- Entity/Service/Rule 六元组：业务语义的形式化描述
- 状态机模型：Process 生命周期（原 7 状态，已精简为 5 状态：OPEN/IN_PROGRESS/COMPLETED/FAILED/BLOCKED）
- Design-time vs Runtime 分离：元建模→编译→执行的三阶段
- 规则驱动：Event表达式 → Instruction 映射，声明式业务逻辑
- 系统调用：start_service / call_sub_service / start_parallel_service 等编排原语
- 上下文堆栈：ContextFrame 管理嵌套调用上下文
- ProcessContextSnapshot：版本化上下文快照（审计基础）

### 两者的互补关系
- BPS 的 Role/Operator 概念 → 可由 Agent 动态扮演（不再绑定固定人员/Agent）
- BPS 的 Service（原子/复合）→ 直接映射为 Agent Skill / Skill组合
- BPS 的 ServiceRule → Agent 编排的约束规则
- BPS 的 Process 状态机 → Agent 任务的生命周期追踪
- OpenClaw 的动态 spawn → BPS 的 start_parallel_service 的智能化版本
- OpenClaw 的 steer → BPS 缺少的"运行时策略调整"能力
- OpenClaw 的 Memory → BPS 缺少的"组织学习"能力

### BPS TS 引擎实现要点
- `node:sqlite`（Node 24 内建）替代 `better-sqlite3`，零原生编译依赖
- 链式编排模式：每个服务 TERMINATED → 触发下一个 start_service，通过 (targetServiceId, serviceId) 作用域隔离规则
- 并行扇出：多条规则共享同一事件ID，evaluateRules 不做事件去重，全部匹配全部触发
- SysCall 中 `programEntrypoint` 从规则的 `targetServiceId` 继承，保证子进程规则作用域一致

---

## 项目文件清单（Phase 1-11 时期，文件路径和模块计数已过时）

### 设计文档
- `IdleXAI-Native组织架构深度分析.md` — 架构分析与三层模型设计
- `packages/bps-engine/docs/bps-engine-skeleton.md` — BPS TS 引擎骨架设计

### BPS 引擎源码 (`packages/bps-engine/`)
- `package.json` / `tsconfig.json` — 项目配置
- `src/schema/` — TypeBox 类型定义（7 文件）
- `src/engine/` — 引擎核心（5 文件：context / state-machine / rule-evaluator / syscall / process-manager）
- `src/store/` — SQLite 持久层（3 文件：db / process-store / blueprint-store）
- `src/knowledge/` — BKM 知识管理（5 文件：types / knowledge-store / context-assembler / conflict-detector / system-knowledge）
- `src/loader/yaml-loader.ts` — YAML 蓝图加载器
- `src/index.ts` — 统一导出 + createBpsEngine() 工厂
- `blueprints/geo-ktv-changsha.yaml` — IdleXGEO长沙KTV运营蓝图
- `test/engine.test.ts` — 引擎基础测试（17 tests）
- `test/geo-ktv.test.ts` — GEO蓝图集成测试（15 tests）

### Phase 8：核心 Agent 定义 ✅
- BPS Expert Agent + Org-Architect Agent workspace 文件
- 文件路径：`packages/bps-engine/agents/`
  - `bps-expert/SOUL.md` — BPS 核心理论知识（六元组、状态机、YAML schema、编排模式）
  - `bps-expert/AGENTS.md` — SBMP 建模方法论（五步法 + EARS 规则格式 + 交互精炼流程）
  - `bps-expert/IDENTITY.md` — 身份定义
  - `org-architect/SOUL.md` — Org-Architect（与 BPS Expert 协作、Agent 生命周期管理）
  - `org-architect/AGENTS.md` — Agent 创建流程 + Agent 注册表
  - `org-architect/IDENTITY.md` — 身份定义
- 部署脚本：`deploy/install-agents.sh`
- **架构决策**：
  - BPS Expert 独立 Agent，由 Org-Architect 管理生命周期
  - Org-Architect 不直接依赖 bps-engine API，通过 BPS Expert 间接协作
  - 三者（Org-Architect + BPS Expert + bps-engine）打包在一起部署
  - BPS Expert 是通用业务设计专家，不包含具体业务领域知识
  - SOUL.md 承载 BPS 理论知识（What it knows），AGENTS.md 承载 SBMP 方法论（How it works）

### Phase 9：Aida 管理助理 Agent ✅
- Aida Agent workspace 文件
- 文件路径：`packages/bps-engine/agents/aida/`
  - `IDENTITY.md` — 身份定义（首席管理助理，智能编排层人格化）
  - `SOUL.md` — 核心知识（定位、双通道、能力框架、BPS 结晶化判断框架七场景）
  - `AGENTS.md` — 操作指南（工作模式、调度协议、工具表、输出规范）
- **架构拓扑**：`[User] ↔ [Aida] → [BPS-Expert] / [Org-Architect]`
- **核心设计决策**：
  - Aida 是智能编排层的人格化，用户唯一日常交互对象
  - BPS 是结晶机制而非操作系统——七个结晶化场景判断框架
  - BPS-Expert ↔ Org-Architect 可直接通信（避免不必要中转），但需通知 Aida 结果
  - Aida 的 subagents 为显式列表（bps-expert, org-architect），Org-Architect 保留 allowAgents: ["*"]
- 同步更新：
  - BPS-Expert SOUL.md：核心边界 #3 更新为"任务来自 Aida 调度"
  - BPS-Expert AGENTS.md：新增"与 Aida 的协作协议"段
  - Org-Architect AGENTS.md：Agent 注册表增加 Aida 条目 + 协作说明
  - deploy/install-agents.sh：新增 Section 0 安装 Aida + patch.json 增加 aida 配置

### Phase 10：BKM 业务知识管理子系统 ✅
- 新增模块：`src/knowledge/`（5 个 TypeScript 文件）
- **知识分层**：5 层（charter → strategy → domain → ops → contextual），高层约束低层
- **作用域**：6 类（system / global / team:{id} / agent:{id} / domain:{d} / service:{s}）
- **核心模块**：
  - `KnowledgeStore`：封装 DossierStore，知识存储为 `entityType="knowledge"` 的 Dossier
  - `ContextAssembler`：scope chain 构建 + 知识装配 + 浅合并
  - `ConflictDetector`：字段级冲突检测，severity 分级（critical/warning/info）
  - `loadSystemKnowledge()`：3 条系统保留知识（结晶化框架、冲突规则、审计流程）
- **ProcessManager 集成**：createProcess() 自动装配 `_knowledge` 到 frame.localVars
- **新增事件**：`knowledge:conflict`（critical 冲突触发）
- **测试**：30 项新测试（knowledge-store 15 + context-assembly 15），**全量 190 tests 通过**
- 规范文档：`docs/业务知识管理 (BKM) v0.1.md`

### Phase 11：~/.aida/ 项目目录迁移 ✅
- **目标**：业务项目数据从代码仓库迁移到 `~/.aida/`，实现代码与数据分离
- **核心变更**：
  - 新增 `src/loader/aida-project.ts`：`loadAidaProject()` 一键装载 API
  - 修改 `src/loader/project-loader.ts`：新增 knowledge seed 支持（KnowledgeSeedYaml + 加载逻辑）
  - 修改 `src/index.ts`：导出新 API（loadAidaProject, initAidaProject, getDefaultAidaDir）
  - 修改 `index.ts`（plugin 入口）：替换 auto-glob 为 `loadAidaProject()`
  - 测试 fixtures 独立化：`test/fixtures/` 下包含蓝图 + 种子数据 + project.yaml
  - 所有测试不再依赖 `projects/idlex/` 或 `bps-engine/blueprints/`
- **迁移**：`projects/idlex/*` + `bps-engine/blueprints/*` → `~/.aida/`
- **文档**：BPLP v0.1 → v0.2，CLAUDE.md 更新目录结构
- **测试**：7 项新测试（aida-project.test.ts），**全量 197 tests 通过**

---

## 待讨论/待实施事项（截至 Phase 11）

> **注意**：以下清单截至 Phase 11 状态。许多项目已在后续 Phase 中完成或因架构方向转变而废弃。
> 当前待办事项请参阅 `docs/AIDA 架构决策与现状 (ADR).md` 第六节"未完成事项与风险"。

- [x] 三层架构的详细设计 → 已在骨架文档中完成
- [x] BPS TS Phase 1 引擎核心编码 → 32 项测试全部通过
- [x] IdleX业务蓝图 YAML 定义 → GEO KTV 长沙蓝图已完成
- [x] 核心 Agent 定义 → BPS Expert + Org-Architect workspace 文件已完成（后被吸收为 Aida Skills）
- [x] Aida 管理助理 Agent → workspace 文件 + 结晶化框架 + 协作拓扑已完成
- [x] BKM 业务知识管理子系统 → 已完成后精简（ContextAssembler/ConflictDetector 移除）
- [x] ~/.aida/ 项目目录迁移 → loadAidaProject() + knowledge seed + 测试 fixtures 独立化
- [x] 系统蓝图 sys:project-init → Phase 12 完成
- [x] 可观测性/审计系统设计 → Dashboard 9 页面 + 22 API + SSE 实时推送
- [~] 部署 Agent 到测试服务器 → install-aida.sh 已完成，端到端测试部分通过
- [~] Phase 2：OpenClaw 整合层 → 架构方向转变，BPS 从运行时引擎退化为轻量工具
- [废弃] BPS Expert 端到端验证 → BPS-Expert 已归档，能力吸收为 Aida Skill
- [废弃] Org-Architect ↔ BPS Expert 协作测试 → 两者均已归档
- [废弃] Skill Registry 初始清单 → 架构方向转变
- [废弃] 编排层的决策模型 → Agent 本身即规则引擎
- [废弃] 并行 join 模式 → ProcessManager 已移除，tracker 不支持此模式

---

## 设计约束（来自用户要求）
- 可观察：业务状态和人-Agent行为
- 可评估：效果可量化衡量
- 可干预：人类可随时介入调整
- 可审计：决策链可追溯
- 可迭代优化：系统可持续改进

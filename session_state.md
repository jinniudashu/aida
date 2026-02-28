# IdleX AI-Native 组织设计 · 会话状态笔记

**会话开始时间**：2026-02-23
**目标**：以IdleX为案例，设计可商业落地的 AI 原生组织架构与系统，触及 AI 原生组织能力边界

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
- 源码结构（18 个 TypeScript 文件）：
  - Schema 层（7）：common / entity / service / rule / role / process / resource
  - Engine 层（5）：context / state-machine / rule-evaluator / syscall / process-manager
  - Store 层（3）：db / process-store / blueprint-store
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

## 关键技术发现

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
- 状态机模型：Process 七状态生命周期，状态迁移可追踪
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

## 项目文件清单

### 设计文档
- `IdleXAI-Native组织架构深度分析.md` — 架构分析与三层模型设计
- `packages/bps-engine/docs/bps-engine-skeleton.md` — BPS TS 引擎骨架设计

### BPS 引擎源码 (`packages/bps-engine/`)
- `package.json` / `tsconfig.json` — 项目配置
- `src/schema/` — TypeBox 类型定义（7 文件）
- `src/engine/` — 引擎核心（5 文件：context / state-machine / rule-evaluator / syscall / process-manager）
- `src/store/` — SQLite 持久层（3 文件：db / process-store / blueprint-store）
- `src/loader/yaml-loader.ts` — YAML 蓝图加载器
- `src/index.ts` — 统一导出 + createBpsEngine() 工厂
- `blueprints/geo-ktv-changsha.yaml` — IdleXGEO长沙KTV运营蓝图
- `test/engine.test.ts` — 引擎基础测试（17 tests）
- `test/geo-ktv.test.ts` — GEO蓝图集成测试（15 tests）

### Phase 8：核心 Agent 定义 ✅
- BPS Expert Agent + Meta-Architect Agent workspace 文件
- 文件路径：`packages/bps-engine/agents/`
  - `bps-expert/SOUL.md` — BPS 核心理论知识（六元组、状态机、YAML schema、编排模式）
  - `bps-expert/AGENTS.md` — SBMP 建模方法论（五步法 + EARS 规则格式 + 交互精炼流程）
  - `bps-expert/IDENTITY.md` — 身份定义
  - `meta/SOUL.md` — 升级版 Meta-Architect（与 BPS Expert 协作、Agent 生命周期管理）
  - `meta/AGENTS.md` — Agent 创建流程 + Agent 注册表
  - `meta/IDENTITY.md` — 身份定义
- 部署脚本：`deploy/install-agents.sh`
- **架构决策**：
  - BPS Expert 独立 Agent，由 Meta-Architect 管理生命周期
  - Meta 不直接依赖 bps-engine API，通过 BPS Expert 间接协作
  - 三者（Meta + BPS Expert + bps-engine）打包在一起部署
  - BPS Expert 是通用业务设计专家，不包含具体业务领域知识
  - SOUL.md 承载 BPS 理论知识（What it knows），AGENTS.md 承载 SBMP 方法论（How it works）

---

## 待讨论/待实施事项
- [x] 三层架构的详细设计 → 已在骨架文档中完成
- [x] BPS TS Phase 1 引擎核心编码 → 32 项测试全部通过
- [x] IdleX业务蓝图 YAML 定义 → GEO KTV 长沙蓝图已完成
- [x] 核心 Agent 定义 → BPS Expert + Meta-Architect workspace 文件已完成
- [ ] **部署 Agent 到测试服务器**：运行 install-agents.sh，更新 openclaw.json，端到端测试
- [ ] **BPS Expert 端到端验证**：通过 Telegram 与 BPS Expert 对话，测试蓝图生成能力
- [ ] **Meta ↔ BPS Expert 协作测试**：验证 Agent 需求提出→创建→部署流程
- [ ] Phase 2：OpenClaw 整合层（AgentBridge 实现、Skill 注册、事件桥接、SysCall→Agent 映射）
- [ ] Skill Registry 初始清单（映射IdleX业务 Service → Agent Skill）
- [ ] 编排层的决策模型（规则驱动 vs LLM动态规划 vs 混合）
- [ ] 人类介入点的精确定义（当前仅 content-review 为 manual）
- [ ] 并行 join 模式（等待所有并行子进程完成后再继续）
- [ ] 可观测性/审计系统设计（Dashboard、日志聚合）
- [ ] MVP 端到端验证（接入真实 LLM + Agent 执行）
- [ ] 更多业务蓝图：自助茶室、自助棋牌室、城市扩张编排

---

## 设计约束（来自用户要求）
- 可观察：业务状态和人-Agent行为
- 可评估：效果可量化衡量
- 可干预：人类可随时介入调整
- 可审计：决策链可追溯
- 可迭代优化：系统可持续改进

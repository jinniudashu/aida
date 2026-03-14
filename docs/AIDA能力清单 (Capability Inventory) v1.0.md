# AIDA 能力清单 (Capability Inventory) v1.0

> 最后更新：2026-03-14
> 基于代码仓库 commit `15035a4` 及 437 单元测试验证

本文档列出 AIDA 平台当前已实现的全部能力，包括每项能力的假设前提、现状评估、与其他能力的关联关系，以及到源码函数的精确映射。

---

## 目录

- [一、能力总览](#一能力总览)
- [二、BPS 核心建模能力](#二bps-核心建模能力)
- [三、持久化与存储能力](#三持久化与存储能力)
- [四、任务执行与状态机能力](#四任务执行与状态机能力)
- [五、管理层能力](#五管理层能力)
- [六、蓝图编译与加载能力](#六蓝图编译与加载能力)
- [七、知识管理能力](#七知识管理能力)
- [八、Agent 工具集能力](#八agent-工具集能力)
- [九、Dashboard 可视化能力](#九dashboard-可视化能力)
- [十、外部集成能力](#十外部集成能力)
- [十一、Agent Workspace 能力](#十一agent-workspace-能力)
- [十二、可观测性与统计能力](#十二可观测性与统计能力)
- [十三、能力关联矩阵](#十三能力关联矩阵)

---

## 一、能力总览

AIDA 的能力分布于四个层次：

| 层次 | 能力数 | 说明 |
|------|--------|------|
| **BPS 引擎核心** | 28 | 建模、状态机、存储、编译 |
| **管理层** | 12 | 约束评估、熔断器、审批、策略学习 |
| **Agent 接口层** | 20 | 17 BPS Tools + 3 MCP Tools |
| **可视化层** | 15 | Dashboard API + SSE + 页面 |

**技术栈前提**：TypeScript (ES2022 ESM), Node.js 24+, node:sqlite (同步 API), OpenClaw Agent 框架

---

## 二、BPS 核心建模能力

BPS（Business Process Specification）将组织运营建模为六元组计算模型。

### C-01: 实体定义 (Entity Definition)

| 项目 | 内容 |
|------|------|
| **能力描述** | 定义业务对象的类型、字段类型、实现类型、依赖顺序 |
| **假设前提** | 业务对象可归类为有限种实体类型；字段类型覆盖 12 种数据类型 |
| **当前状态** | ✅ 完整实现。支持 12 种 FieldType + 7 种 ImplementType + 字段依赖排序 |
| **关联能力** | → C-05 (Dossier 存储依赖实体定义)，→ C-14 (蓝图中声明 entityType) |
| **实现映射** | `src/schema/entity.ts` — `EntityDef`, `EntityField`, `FieldType`, `ImplementType` |

### C-02: 服务定义 (Service Definition)

| 项目 | 内容 |
|------|------|
| **能力描述** | 定义业务任务类型（原子/组合），包括执行者类型、Agent 提示词、子服务组合、资源需求 |
| **假设前提** | 所有业务操作可归类为 atomic（不可分割）或 composite（可分解为子服务）；执行者为 manual/agent/system 三种 |
| **当前状态** | ✅ 完整实现。agentPrompt + agentSkills 字段支持 Agent 能力绑定 |
| **关联能力** | → C-04 (规则引用 serviceId), → C-08 (Task 实例化 Service), → C-15 (编译器从 services[] 生成) |
| **实现映射** | `src/schema/service.ts` — `ServiceDef`, `ServiceType`, `ExecutorType`, `ResourceRequirement` |

### C-03: 事件与指令定义 (Event & Instruction Definition)

| 项目 | 内容 |
|------|------|
| **能力描述** | 定义触发条件（确定性布尔表达式 / 非确定性自然语言）和运行时原语（9 种 SysCall） |
| **假设前提** | 业务事件可分为确定性（布尔表达式可求值）和非确定性（需 LLM 判断）；所有流程操作可归约为 9 种原语 |
| **当前状态** | ✅ Schema 完整。确定性事件用 expr-eval 求值；非确定性事件由 LLM 评估（通过 Agent 框架路由） |
| **关联能力** | → C-04 (规则引用 eventId + instructionId), → C-15 (编译器自动生成) |
| **实现映射** | `src/schema/rule.ts` — `EventDef`, `EvaluationMode`, `InstructionDef`, `SysCallName` (9 种) |

**9 种 SysCall**：`start_service`, `call_sub_service`, `calling_return`, `start_iteration_service`, `start_parallel_service`, `retry_process`, `terminate_process`, `escalate_process`, `rollback_process`

### C-04: 规则定义 (ServiceRule Definition)

| 项目 | 内容 |
|------|------|
| **能力描述** | 定义"当 Service X 触发 Event Y 时，对 Operand Service Z 执行 Instruction W"的映射规则 |
| **假设前提** | 业务流程可表示为事件→指令的映射关系图；规则按 order 排序执行 |
| **当前状态** | ✅ 完整实现。规则持久化 + 拓扑查询 (`getNextSteps`, `getRulesForProcess`) |
| **关联能力** | → C-15 (编译器从 flow[] 自动生成), → C-09 (Dashboard 拓扑图依赖规则) |
| **实现映射** | `src/schema/rule.ts` — `ServiceRuleDef`; `src/store/blueprint-store.ts` — `BlueprintStore.upsertServiceRule()`, `getNextSteps()`, `getRulesForProcess()` |

### C-04a: 角色与操作员定义 (Role & Operator Definition)

| 项目 | 内容 |
|------|------|
| **能力描述** | 定义计算节点类型（user_defined / agent / system）和操作员个体（含 Agent Session 绑定） |
| **假设前提** | 组织中的执行者可归类为有限种角色；每个角色对应一组可执行的 Service |
| **当前状态** | ✅ Schema 完整。OperatorDef 含 agentSessionKey 和 agentId 字段，支持 Agent 身份绑定 |
| **关联能力** | → C-08 (Task 的 operatorId 引用 Operator) |
| **实现映射** | `src/schema/role.ts` — `RoleDef`, `RoleType`, `OperatorDef` |

---

## 三、持久化与存储能力

### C-05: 实体档案存储 (Dossier Store)

| 项目 | 内容 |
|------|------|
| **能力描述** | 版本化 JSON 文档存储——每次写入创建新版本，保留完整历史，支持智能合并（数组追加语义） |
| **假设前提** | node:sqlite 同步 API 可满足单实例性能需求；JSON 文档足以表达业务对象 |
| **当前状态** | ✅ 生产就绪。smartMerge 实现数组追加、标量覆盖、新字段添加、未提及字段保留 |
| **关联能力** | → C-07 (知识存储复用 Dossier), → C-08 (Task 完成时自动 commit Dossier), → C-19 (MCP 读取 Dossier) |
| **实现映射** | `src/store/dossier-store.ts` — 完整类 |

**关键方法**：

| 方法 | 签名 | 说明 |
|------|------|------|
| `getOrCreate` | `(entityType, entityId) → DossierDef` | 首次引用时 lazy 创建 |
| `commit` | `(dossierId, data, opts?) → DossierVersion` | 智能合并写入新版本 |
| `get` | `(entityType, entityId) → {dossier, data}` | 按类型+ID 定位 |
| `getById` | `(erpsysId) → {dossier, data}` | 按全局 ID 一步定位 |
| `search` | `(opts) → DossierSearchResult[]` | 按 entityType/lifecycle/dataFilter 检索（json_extract） |
| `getVersion` | `(dossierId, version) → DossierVersion` | 读取特定历史版本 |
| `listVersions` | `(dossierId) → DossierVersion[]` | 完整版本历史 |
| `getRecentChanges` | `(limit) → RecentChange[]` | 最近变更列表 |
| `transition` | `(dossierId, lifecycle) → void` | DRAFT/ACTIVE/ARCHIVED 迁移 |
| `setRelations` | `(dossierId, relations) → void` | 设置实体关系（depends_on/part_of/references） |
| `findByEntityId` | `(entityId) → DossierDef[]` | 跨类型查找同一实体 |
| `findByCommitter` | `(processId) → DossierDef[]` | 按操作进程反查 |

### C-05a: 实体关系声明 (Entity Relations)

| 项目 | 内容 |
|------|------|
| **能力描述** | 实体之间可声明 depends_on / part_of / references 三种关系 |
| **假设前提** | 关系是声明式的，不做级联更新——变更传播由 Agent 决定 |
| **当前状态** | ✅ 实现。relations 存储在 bps_dossiers 表，bps_get_entity 返回 relatedEntities 摘要 |
| **关联能力** | → C-05 (存储在 DossierDef.relations 字段) |
| **实现映射** | `src/schema/dossier.ts` — `EntityRelation`; `src/store/dossier-store.ts` — `DossierStore.setRelations()` |

### C-06: 蓝图存储 (Blueprint Store)

| 项目 | 内容 |
|------|------|
| **能力描述** | 设计态数据 CRUD——Service / Event / Instruction / ServiceRule 的持久化和查询 |
| **假设前提** | 蓝图数据量有限（通常 <100 services），全表查询即可 |
| **当前状态** | ✅ 生产就绪。支持 upsert 幂等加载 + 拓扑查询 |
| **关联能力** | → C-04 (存储规则定义), → C-15 (编译器输出写入此 Store), → C-09 (Dashboard 从此 Store 读取拓扑) |
| **实现映射** | `src/store/blueprint-store.ts` — 完整类 |

**关键方法**：

| 方法 | 签名 | 说明 |
|------|------|------|
| `upsertService` | `(svc: ServiceDef) → void` | 幂等写入服务定义 |
| `getService` | `(id) → ServiceDef \| null` | 按 ID 读取 |
| `listServices` | `(filter?) → ServiceDef[]` | 按 entityType/status 过滤 |
| `upsertEvent` | `(evt: EventDef) → void` | 幂等写入事件定义 |
| `upsertInstruction` | `(instr: InstructionDef) → void` | 幂等写入指令定义 |
| `upsertServiceRule` | `(rule: ServiceRuleDef) → void` | 幂等写入规则 |
| `getNextSteps` | `(completedServiceId) → NextStep[]` | 规则拓扑查询（下游建议） |
| `getRulesForProcess` | `(programEntrypoint, serviceId) → RuleWithEvent[]` | Dashboard 拓扑图查询 |

### C-06a: 任务存储 (Process Store)

| 项目 | 内容 |
|------|------|
| **能力描述** | 任务记录的 CRUD + 上下文快照 + 审计日志 + 任务树 + 分组查询 |
| **假设前提** | 任务是 Service 的运行时实例；每个任务可有多个上下文快照（版本化元数据） |
| **当前状态** | ✅ 生产就绪。支持 priority / deadline / groupId / 父子层级 / 排序 |
| **关联能力** | → C-08 (ProcessTracker 依赖此 Store), → C-10 (scan_work 查询此 Store) |
| **实现映射** | `src/store/process-store.ts` — `ProcessStore`, `CreateProcessInput`, `ProcessQueryFilter`, `ProcessTreeNode` |

---

## 四、任务执行与状态机能力

### C-07: 五态状态机 (Process State Machine)

| 项目 | 内容 |
|------|------|
| **能力描述** | 强制约束任务状态转换合法性：OPEN → IN_PROGRESS → COMPLETED/FAILED/BLOCKED |
| **假设前提** | 所有业务任务的生命周期可映射为 5 种状态；非法转换应立即报错 |
| **当前状态** | ✅ 完整实现。VALID_TRANSITIONS 查表 + assertTransition 抛 BpsStateError |
| **关联能力** | → C-08 (ProcessTracker 在每次状态变更时调用), → C-17 (batch_update 遍历状态检查) |
| **实现映射** | `src/engine/state-machine.ts` — `ProcessStateMachine.canTransition()`, `assertTransition()`, `isTerminal()` |

**状态迁移表**：
```
OPEN        → IN_PROGRESS, BLOCKED, FAILED
IN_PROGRESS → COMPLETED, BLOCKED, FAILED
BLOCKED     → OPEN, IN_PROGRESS, FAILED
COMPLETED   → (终态)
FAILED      → OPEN (可重试)
```

### C-08: 任务追踪器 (Process Tracker)

| 项目 | 内容 |
|------|------|
| **能力描述** | Agent 直接调用的任务 CRUD 引擎——创建/更新/完成/失败/查询任务，自动审计日志和事件发射 |
| **假设前提** | Agent 通过 Skill/Code 直接执行业务逻辑，Tracker 仅负责记录、校验和通知 |
| **当前状态** | ✅ 生产就绪。完成任务时自动 commit Dossier + emit 事件（Dashboard SSE） |
| **关联能力** | → C-07 (调用状态机校验), → C-05 (完成时自动 commit Dossier), → C-12 (事件驱动 SSE) |
| **实现映射** | `src/engine/process-tracker.ts` — `ProcessTracker` (extends EventEmitter) |

**关键方法**：

| 方法 | 签名 | 说明 |
|------|------|------|
| `createTask` | `(params) → ProcessDef` | 创建 + 保存初始 metadata + emit + 写审计日志 |
| `updateTask` | `(taskId, {state?, notes?, metadata?}) → ProcessDef` | 状态变更 + metadata 合并 + emit |
| `completeTask` | `(taskId, result?) → ProcessDef` | 自动 OPEN→IP→COMPLETED + auto-commit Dossier |
| `failTask` | `(taskId, reason) → ProcessDef` | 标记失败 + emit error 事件 |
| `getTask` | `(taskId) → {process, metadata}` | 任务详情 + 元数据 |
| `queryTasks` | `(filter) → ProcessDef[]` | 多维过滤查询 |
| `getTaskTree` | `(rootId) → ProcessTreeNode` | 任务树（父子层级） |

**发射事件**：`task:created`, `task:updated`, `task:completed`, `task:failed`, `dossier:committed` + 5 个 Legacy 兼容事件

---

## 五、管理层能力

### C-09: 约束定义与加载 (Constraint Definition & Loading)

| 项目 | 内容 |
|------|------|
| **能力描述** | 从 YAML 文件加载管理约束——支持 `policies[].constraints[]` 结构化格式和 `constraints[]` 扁平格式 |
| **假设前提** | 约束条件可用 expr-eval 布尔表达式求值；scope 精确到工具名 + 实体类型 + 数据字段 |
| **当前状态** | ✅ 生产就绪。扁平格式自动包装为 policy + 字段规范化（action→onViolation，缺省 scope.tools→默认写操作） |
| **关联能力** | → C-10 (ActionGate 评估约束), → C-16 (bps_load_management 运行时重载) |
| **实现映射** | `src/management/management-loader.ts` — `loadManagementFile()`, `loadManagementFromString()` |

**约束类型定义**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 约束唯一标识 |
| `policyId` | string | 所属策略 |
| `scope.tools` | string[] | 受管控的工具列表 |
| `scope.entityTypes` | string[] | 限定实体类型（可选） |
| `scope.dataFields` | string[] | 限定数据字段（可选） |
| `condition` | string | expr-eval 布尔表达式 |
| `onViolation` | BLOCK / REQUIRE_APPROVAL | 违规动作 |
| `severity` | CRITICAL / HIGH / MEDIUM / LOW | 严重级别 |
| `message` | string | 违规消息模板（支持 `{variable}` 插值） |

**受管控工具列表（9 个）**：`bps_update_entity`, `bps_create_task`, `bps_update_task`, `bps_complete_task`, `bps_create_skill`, `bps_load_blueprint`, `bps_register_agent`, `bps_load_management`, `bps_batch_update`

实现映射：`src/management/constants.ts` — `GATED_WRITE_TOOLS`

### C-10: 前置拦截器 (Action Gate)

| 项目 | 内容 |
|------|------|
| **能力描述** | 每次写操作前评估所有适用约束——scope 匹配 + expr-eval 求值 + verdict 判定 + 违规记录 + 熔断器更新 |
| **假设前提** | "undefined variable" 错误表示约束不适用于当前操作（静默跳过）；其他表达式错误 fail-closed |
| **当前状态** | ✅ 生产就绪。三种 verdict（PASS / BLOCK / REQUIRE_APPROVAL），BLOCK 和 REQUIRE_APPROVAL 以 throw Error 方式通知 Agent |
| **关联能力** | → C-09 (约束来源), → C-11 (熔断器状态决定全局拦截), → C-12 (REQUIRE_APPROVAL 创建审批单) |
| **实现映射** | `src/management/action-gate.ts` — `ActionGate.check()`, `createApprovalRequest()` |

**评估流程**：
1. 读操作直接 PASS
2. 冷却恢复检查 (`tryCooldownRecovery`)
3. 熔断器 DISCONNECTED/RESTRICTED → 全部 BLOCK
4. 查找适用约束 (`findApplicable` — scope.tools + entityTypes + dataFields 匹配)
5. 构建评估上下文 (`buildEvalContext` — 时间、实体、数据字段、工具专用上下文)
6. 逐约束 expr-eval 求值
7. 记录违规 + 更新熔断器
8. 综合判定 verdict

### C-11: 熔断器 (Circuit Breaker)

| 项目 | 内容 |
|------|------|
| **能力描述** | 四态安全降级：NORMAL → WARNING → RESTRICTED → DISCONNECTED。超过阈值自动升级，冷却期后自动降级，振荡检测防止抖动 |
| **假设前提** | CRITICAL 1次/1h → DISCONNECTED；HIGH 5次/1h → RESTRICTED；HIGH 2次/1h → WARNING；默认冷却 30 分钟 |
| **当前状态** | ✅ 生产就绪。含振荡检测（1h 内 >3 次转移则锁定）和冷却自动恢复 |
| **关联能力** | → C-10 (ActionGate 检查熔断器状态), → C-09a (Dashboard 熔断器状态显示 + 重置) |
| **实现映射** | `src/management/action-gate.ts` — `ActionGate.updateCircuitBreaker()`, `tryCooldownRecovery()`; `src/management/types.ts` — `CircuitBreakerState`, `CircuitBreakerConfig`, `CircuitBreakerThreshold` |

### C-12: 审批管理 (Approval Management)

| 项目 | 内容 |
|------|------|
| **能力描述** | REQUIRE_APPROVAL verdict 创建审批单，Dashboard 审批通过后自动重放原始工具调用 |
| **假设前提** | 审批单 4 小时过期；审批通过后工具调用在 Dashboard 服务端重放（非 Agent 重新调用） |
| **当前状态** | ✅ 端到端验证通过。审批→执行→版本递增闭环完整 |
| **关联能力** | → C-10 (ActionGate 创建审批单), → C-09a (Dashboard 审批 UI + replayToolCall) |
| **实现映射** | `src/management/management-store.ts` — `ManagementStore.createApproval()`, `decideApproval()`; `dashboard/server/routes.ts` — `POST /api/management/approvals/:id/decide`, `replayToolCall()` |

### C-12a: 策略效能学习 (Constraint Effectiveness)

| 项目 | 内容 |
|------|------|
| **能力描述** | 按 constraintId 聚合违规计数 + 审批通过/拒绝率，生成策略调整建议 |
| **假设前提** | 审批通过率 >90%（样本≥20）→ "过于严格"；拒绝率 >80% → "考虑升级为 BLOCK"。策略变更始终由人类确认 |
| **当前状态** | ✅ 实现。bps_management_status 工具返回 constraintEffectiveness 字段 |
| **关联能力** | → C-10 (基于违规历史计算), → C-09a (Dashboard 展示效能数据) |
| **实现映射** | `src/management/management-store.ts` — `ManagementStore.getConstraintEffectiveness()` |

### C-12b: 管理事件发射 (Management Events)

| 项目 | 内容 |
|------|------|
| **能力描述** | ManagementStore 继承 EventEmitter，emit 4 个管理专用事件，Dashboard SSE 直接转发 |
| **假设前提** | 管理事件需实时可观测（Dashboard 无需轮询） |
| **当前状态** | ✅ 实现 |
| **关联能力** | → C-09a (Dashboard SSE 订阅管理事件) |
| **实现映射** | `src/management/management-store.ts` — emit `management:violation`, `management:approval_created`, `management:approval_decided`, `management:circuit_breaker_changed` |

---

## 六、蓝图编译与加载能力

### C-13: YAML 蓝图加载 (Blueprint YAML Loading)

| 项目 | 内容 |
|------|------|
| **能力描述** | 从 YAML 文件/字符串解析蓝图，自动检测简化格式并编译，写入 BlueprintStore |
| **假设前提** | 蓝图 YAML 有两种格式——简化格式（services + flow）和完整格式（四数组）；向后兼容 |
| **当前状态** | ✅ 生产就绪。`loadBlueprintFromString` 自动检测 + 编译 + 加载 |
| **关联能力** | → C-14 (编译器在此被调用), → C-06 (加载结果写入 BlueprintStore) |
| **实现映射** | `src/loader/yaml-loader.ts` — `loadBlueprintFromYaml()`, `loadBlueprintFromString()`, `loadBlueprintObject()` |

### C-14: 蓝图编译器 (Blueprint Compiler)

| 项目 | 内容 |
|------|------|
| **能力描述** | 将简化格式（services + flow DSL）编译为完整引擎 schema（events + instructions + rules） |
| **假设前提** | Aida 只需写业务描述（services + flow 箭头），编译器自动生成交叉引用的 4 个数组 |
| **当前状态** | ✅ 生产就绪。已在端到端测试中由 Agent 自主使用并通过验证 |
| **关联能力** | → C-13 (自动检测调用), → C-04 (生成规则), → C-03 (生成事件和指令) |
| **实现映射** | `src/loader/blueprint-compiler.ts` — `isSimplifiedFormat()`, `compileBlueprint()` |

**Flow DSL 语法**：

| 语法 | 含义 | 示例 |
|------|------|------|
| `A -> B` | 顺序 | `"setup -> execute"` |
| `A -> B -> C` | 链式 | `"plan -> execute -> review"` |
| `A -> B, C, D` | 并行扇出 | `"start -> taskA, taskB, taskC"` |
| `A -> B \| "condition"` | 条件分支（非确定性事件） | `"review -> approve \| \"quality passed\""` |

**编译输出**：
- 自动生成 `evt-new`（进程创建）和 `evt-terminated`（进程终止）标准事件
- 条件分支生成 `evt-cond-N` 非确定性事件
- 自动生成 `instr-start`（启动服务）和 `instr-terminate`（终止进程）标准指令
- 自动推导入口服务（有出边无入边 → entry rules）
- 边规则：`rule-{from}-to-{to}` 命名

**两种 flow 输入格式**：
1. `flow: string[]` — DSL 箭头数组
2. `flow: { rules: [{when, then}] }` — 对象式规则对（自动转换为 DSL）

### C-14a: 项目装载 (Project Loading)

| 项目 | 内容 |
|------|------|
| **能力描述** | 从 `~/.aida/project.yaml` 加载项目清单——蓝图列表 + 种子数据（实体和知识） |
| **假设前提** | `~/.aida/` 目录结构已初始化（blueprints/, data/, context/） |
| **当前状态** | ✅ 生产就绪 |
| **关联能力** | → C-14b (由 loadAidaProject 调用), → C-13 (加载蓝图), → C-05 (加载种子实体) |
| **实现映射** | `src/loader/project-loader.ts` — `loadProject()`, `loadProjectFromString()` |

### C-14b: AIDA 项目一键装载 (loadAidaProject)

| 项目 | 内容 |
|------|------|
| **能力描述** | 一键完成：初始化目录 → 创建 DB → 创建引擎 → 加载系统知识 → 加载项目 → 加载管理层 |
| **假设前提** | 单一入口简化部署；DB 路径固定为 `~/.aida/data/bps.db` |
| **当前状态** | ✅ 生产就绪。OpenClaw 插件入口直接调用此函数 |
| **关联能力** | → C-14a (加载项目), → C-07a (加载系统知识), → C-09 (加载管理层), → C-19 (引擎实例供插件使用) |
| **实现映射** | `src/loader/aida-project.ts` — `loadAidaProject()`, `initAidaProject()`, `getDefaultAidaDir()` |

**返回结果 `AidaProjectResult`**：
- `engine: BpsEngine` — 完整引擎实例（8 个 Store + Tracker）
- `project: ProjectLoadResult | null` — 项目加载结果
- `management: { constraintCount, store, gate } | null` — 管理层实例
- `aidaDir: string` — 项目目录路径
- `systemKnowledge: { loaded, skipped }` — 系统知识加载统计

---

## 七、知识管理能力

### C-07a: 知识存储 (Knowledge Store)

| 项目 | 内容 |
|------|------|
| **能力描述** | 分层分布式知识管理——system/project 两级作用域，基于 Dossier 存储的知识条目 CRUD |
| **假设前提** | 知识存储复用 Dossier 机制（entityType = "knowledge", entityId = "scope:topic"） |
| **当前状态** | ✅ 生产就绪。知识条目版本化、可归档 |
| **关联能力** | → C-05 (底层复用 DossierStore), → C-14b (系统知识自动加载) |
| **实现映射** | `src/knowledge/knowledge-store.ts` — `KnowledgeStore.put()`, `get()`, `list()`, `archive()` |

### C-07b: 系统知识 (System Knowledge)

| 项目 | 内容 |
|------|------|
| **能力描述** | 幂等加载预定义系统知识（BPS 理论、管理规范等） |
| **假设前提** | 系统知识在引擎启动时一次性加载，已存在的条目跳过 |
| **当前状态** | ✅ 实现 |
| **关联能力** | → C-07a (写入 KnowledgeStore), → C-14b (loadAidaProject 调用) |
| **实现映射** | `src/knowledge/system-knowledge.ts` — `loadSystemKnowledge()`, `verifySystemKnowledge()` |

---

## 八、Agent 工具集能力

AIDA 通过 OpenClaw 插件向 Agent 暴露 17 个 BPS 工具。写操作工具（9 个）自动包装管理检查。

### 读操作工具（8 个）

| # | 工具名 | 能力描述 | 实现映射 |
|---|--------|---------|----------|
| C-T01 | `bps_list_services` | 列出蓝图中所有服务定义（含 agentPrompt/agentSkills） | `tools.ts:41` |
| C-T02 | `bps_get_task` | 获取单个任务详情 + 元数据 | `tools.ts:147` |
| C-T03 | `bps_query_tasks` | 多维过滤查询任务（state/serviceId/entityType/groupId 等） | `tools.ts:175` |
| C-T04 | `bps_get_entity` | 获取实体档案 + 当前数据 + 版本历史 + relatedEntities | `tools.ts:328` |
| C-T05 | `bps_query_entities` | 按 entityType/lifecycle 查询实体列表（支持 brief 模式） | `tools.ts:421` |
| C-T06 | `bps_next_steps` | 规则拓扑查询——某服务完成后的下游建议 + recommendation | `tools.ts:464` |
| C-T07 | `bps_scan_work` | 全景工作扫描——pending/inProgress/blocked/overdue/failed + outcomeDistribution + dormantSkills + summary | `tools.ts:563` |
| C-T08 | `bps_management_status` | 管理层状态——熔断器 + 违规 + 约束 + 待审批 + constraintEffectiveness | `tools.ts:766` |

### 写操作工具（9 个，受管理管控）

| # | 工具名 | 能力描述 | 实现映射 |
|---|--------|---------|----------|
| C-T09 | `bps_create_task` | 创建任务（含 priority / deadline / groupId） | `tools.ts:91` |
| C-T10 | `bps_update_task` | 更新任务状态/元数据/notes | `tools.ts:223` |
| C-T11 | `bps_complete_task` | 完成任务（含 outcome: success/partial/failed）+ 自动记录 Skill 指标 | `tools.ts:267` |
| C-T12 | `bps_update_entity` | 写入实体数据（智能合并）+ 设置关系 | `tools.ts:385` |
| C-T13 | `bps_create_skill` | 动态创建 Agent Skill 文件到 workspace | `tools.ts:636` |
| C-T14 | `bps_load_blueprint` | 提交 YAML → 编译 → 加载 → 持久化 → 返回 health 状态 | `tools.ts:705` |
| C-T15 | `bps_load_management` | 运行时重载管理约束 YAML | `tools.ts:804` |
| C-T16 | `bps_register_agent` | 创建 OpenClaw Agent workspace + 注册到 openclaw.json（含 tools.profile 校验） | `tools.ts:871` |
| C-T17 | `bps_batch_update` | 按 groupId 批量更新任务状态 | `tools.ts:1019` |

### 管理包装机制

| 项目 | 内容 |
|------|------|
| **能力描述** | 写操作工具自动包装 ActionGate 检查——BLOCK/REQUIRE_APPROVAL 以 throw Error 通知 Agent |
| **假设前提** | LLM 可靠识别工具 Error（比 `{success:false}` 更可靠） |
| **当前状态** | ✅ 端到端验证通过 |
| **实现映射** | `src/integration/tools.ts:959` — `wrapWithManagement()` |

---

## 九、Dashboard 可视化能力

### C-D01: 流程拓扑图 (Process Topology)

| 项目 | 内容 |
|------|------|
| **能力描述** | 从 rules 自动推导服务拓扑图，节点根据进程状态实时变色 |
| **假设前提** | 蓝图中的 ServiceRule 包含足够的拓扑信息 |
| **当前状态** | ✅ Layer 3 完成 |
| **关联能力** | → C-04 (规则拓扑), → C-D02 (实时动画) |
| **实现映射** | `dashboard/client/src/pages/TopologyPage.vue` |

### C-D02: 实时执行动画 (Real-time Animation)

| 项目 | 内容 |
|------|------|
| **能力描述** | SSE 驱动节点状态变色，实时显示任务创建/状态变更/完成/失败 |
| **假设前提** | EventEmitter → SSE → 浏览器 EventSource 链路延迟 <100ms |
| **当前状态** | ✅ Layer 4 完成 |
| **关联能力** | → C-08 (ProcessTracker emit 事件), → C-D05 (SSE 服务端) |
| **实现映射** | `dashboard/server/routes.ts` — SSE endpoint; `dashboard/client/src/stores/` — Pinia SSE store |

### C-D03: ATDD 测试循环 (Try-Run + Simulate + Report)

| 项目 | 内容 |
|------|------|
| **能力描述** | 试运行蓝图 + 模拟完成 + 执行报告 |
| **假设前提** | Dashboard 可独立于 Agent 验证蓝图流程正确性 |
| **当前状态** | ✅ Layer 5 完成 |
| **关联能力** | → C-14 (蓝图加载), → C-08 (任务追踪) |
| **实现映射** | `dashboard/server/simulate.ts` |

### C-D04: 管理全景页 (Management Page)

| 项目 | 内容 |
|------|------|
| **能力描述** | 四面板管理页——熔断器状态 + 约束清单 + 审批队列（Approve/Reject 模态框）+ 违规历史 |
| **假设前提** | 管理决策需要人类可视化审阅 |
| **当前状态** | ✅ 端到端验证通过（审批→执行→版本递增闭环） |
| **关联能力** | → C-10/11/12 (管理层), → C-D05 (SSE 管理事件) |
| **实现映射** | `dashboard/client/src/pages/ManagementPage.vue` |

### C-D04a: 概览页 (Overview Page)

| 项目 | 内容 |
|------|------|
| **能力描述** | 三面板回答"现状/目标/下一步"——实体/任务/错误计数 + Action Plan 进度 + 任务队列 + 待审批 |
| **假设前提** | 运营人员首先关心全局状态 |
| **当前状态** | ✅ 实现 |
| **关联能力** | → C-05/C-06a (数据来源) |
| **实现映射** | `dashboard/client/src/pages/OverviewPage.vue` |

### C-D04b: 审批页 (Approvals Page)

| 项目 | 内容 |
|------|------|
| **能力描述** | 审批队列 + approve/reject 决策模态框（HITL 闭环） |
| **当前状态** | ✅ 实现 |
| **实现映射** | `dashboard/client/src/pages/ApprovalsPage.vue` |

### C-D04c: Agent Log 页

| 项目 | 内容 |
|------|------|
| **能力描述** | 任务审计全景——action/state/reason 过滤 |
| **当前状态** | ✅ 实现 |
| **实现映射** | `dashboard/client/src/pages/AgentLogPage.vue` |

### C-D04d: Business Goals 页

| 项目 | 内容 |
|------|------|
| **能力描述** | Action Plan 卡片（items + periodicItems + 进度条） |
| **当前状态** | ✅ 实现 |
| **实现映射** | `dashboard/client/src/pages/BusinessGoalsPage.vue` |

### C-D05: SSE 实时推送 (Server-Sent Events)

| 项目 | 内容 |
|------|------|
| **能力描述** | Hono 服务端 SSE——转发引擎事件（task:*）和管理事件（management:*）到浏览器 |
| **假设前提** | 单连接足够（Dashboard 是单用户场景） |
| **当前状态** | ✅ 生产就绪 |
| **关联能力** | → C-08 (引擎事件), → C-12b (管理事件) |
| **实现映射** | `dashboard/server/routes.ts` — `GET /api/events` (SSE endpoint) |

### C-D06: 管理 REST API (7 个 endpoint)

| Endpoint | 方法 | 说明 |
|----------|------|------|
| `/api/management/status` | GET | 熔断器状态 + 约束数 + 待审批数 + 最近违规 + constraintEffectiveness |
| `/api/management/violations` | GET | 违规历史（支持 limit） |
| `/api/management/constraints` | GET | 约束完整列表 |
| `/api/management/approvals` | GET | 待审批列表 |
| `/api/management/approvals/:id/decide` | POST | 审批/拒绝 + replayToolCall |
| `/api/management/circuit-breaker/reset` | POST | 重置熔断器 |
| `/api/store-profiles` | GET | 门店列表（支持 city/district/keyword 过滤） |

### C-D07: 门店 Profile API (3 个 endpoint)

| Endpoint | 方法 | 说明 |
|----------|------|------|
| `/api/store-profiles` | GET | 门店列表（支持过滤） |
| `/api/store-profiles/:storeId` | GET | 门店详情（JSON-LD Schema.org LocalBusiness） |
| `/api/store-profiles/:storeId/availability` | GET | 房型可用性 |

---

## 十、外部集成能力

### C-18: OpenClaw 插件 (Plugin)

| 项目 | 内容 |
|------|------|
| **能力描述** | AIDA 引擎打包为 OpenClaw 原生插件——注册工具 + 事件桥接 + 共享 DB |
| **假设前提** | OpenClaw Plugin API 支持 tools 注册和事件订阅 |
| **当前状态** | ✅ 生产部署。`openclaw.plugin.json` + `index.ts` 入口 |
| **关联能力** | → C-14b (loadAidaProject 初始化), → C-T01~T17 (注册全部工具) |
| **实现映射** | `index.ts` (插件入口), `openclaw.plugin.json` (插件清单), `src/integration/plugin.ts` (注册逻辑), `src/integration/events.ts` (事件桥接) |

### C-19: MCP Server (3 个工具)

| 项目 | 内容 |
|------|------|
| **能力描述** | 让外部 AI Agent 通过 MCP 协议发现和查询门店数据——搜索、详情（JSON-LD）、可用性 |
| **假设前提** | MCP stdio transport 可被外部 AI Agent（如 Claude Desktop）消费 |
| **当前状态** | ✅ 实现。3 个工具：search_stores, get_store_detail, check_availability |
| **关联能力** | → C-05 (读取 DossierStore 数据) |
| **实现映射** | `src/mcp/server.ts` — `createIdlexMcpServer()`, `startMcpServer()` |

### C-19a: JSON-LD 输出 (Schema.org)

| 项目 | 内容 |
|------|------|
| **能力描述** | 门店数据输出为 JSON-LD 格式（Schema.org LocalBusiness + EntertainmentBusiness） |
| **假设前提** | JSON-LD 是 SEO/GEO 的标准结构化数据格式 |
| **当前状态** | ✅ 实现 |
| **实现映射** | `src/mcp/server.ts` — `storeDataToJsonLd()` |

---

## 十一、Agent Workspace 能力

### C-20: Aida Agent Workspace

| 项目 | 内容 |
|------|------|
| **能力描述** | Aida 管理助理的完整 workspace——IDENTITY + SOUL + AGENTS + HEARTBEAT + USER + TOOLS + BOOT |
| **假设前提** | OpenClaw workspace 7 文件结构（Bootstrap 协议） |
| **当前状态** | ✅ 7/7 文件完整 |
| **实现映射** | `agents/aida/` — IDENTITY.md (4行), SOUL.md (32行), AGENTS.md (119行), HEARTBEAT.md (8行), USER.md (3行), TOOLS.md (38行), BOOT.md (4行) |

### C-20a: 二层路由 (Two-Layer Routing)

| 项目 | 内容 |
|------|------|
| **能力描述** | 强制 Aida 区分管理层（Blueprint/Constraint）和运营层（Entity/Skill）——constraint → Management, action → Operations |
| **假设前提** | 管理层定义"不能做什么"，运营层定义"做什么" |
| **当前状态** | ✅ 在 AGENTS.md 中定义路由规则，在端到端测试中验证 100% 正确 |
| **实现映射** | `agents/aida/AGENTS.md` — "Two-Layer Routing" 节 |

### C-21: Agent Skills (7 个)

| Skill | 说明 | 关键能力 |
|-------|------|---------|
| `project-init` | 项目初始化引导 | 首次启动 sys:project-init 状态检测 |
| `action-plan` | 行动计划制定 | Layer 分类（Management/Operations） |
| `dashboard-guide` | Dashboard 引导 | 页面功能介绍 |
| `blueprint-modeling` | 蓝图建模 | SBMP 五步法，限定 governance-only |
| `agent-create` | Agent 创建 | 4-phase 生命周期（设计→构建→验证→发布） |
| `business-execution` | 业务执行 | Entity + Skill 主路径，BPS Task 次路径 |
| `skill-create` | 元技能（Skill 创建） | 教 Aida 何时/如何结晶重复模式 |

实现映射：`agents/aida/skills/` 目录

### C-22: 子 Agent 创建 (bps_register_agent)

| 项目 | 内容 |
|------|------|
| **能力描述** | Aida 可动态创建子 Agent——写入 workspace 文件 + 注册到 openclaw.json（含 tools.profile 校验） |
| **假设前提** | tools.profile 必须是 minimal/coding/messaging/full 之一（防止配置损坏） |
| **当前状态** | ✅ 端到端验证通过（多轮测试中 Agent 成功自主创建子 Agent） |
| **关联能力** | → C-T16 (bps_register_agent 工具), → C-10 (受管理管控) |
| **实现映射** | `src/integration/tools.ts:871` — `createRegisterAgentTool()` |

---

## 十二、可观测性与统计能力

### C-23: 时间序列统计 (Stats Store)

| 项目 | 内容 |
|------|------|
| **能力描述** | 事件驱动的多粒度统计——hour/day/week 三级 bucket，支持维度聚合和快照 |
| **假设前提** | 事件通过 ProcessTracker EventEmitter 自动收集（process.created/completed/error, dossier.committed） |
| **当前状态** | ✅ 实现 |
| **关联能力** | → C-08 (事件来源), → C-D04a (Dashboard Overview 消费) |
| **实现映射** | `src/store/stats-store.ts` — `StatsStore.recordEvent()`, `getTimeSeries()`, `saveSnapshot()` |

### C-24: Skill 使用追踪 (Skill Metrics Store)

| 项目 | 内容 |
|------|------|
| **能力描述** | 记录 Skill 调用次数/结果/耗时，识别休眠 Skill（90 天未使用） |
| **假设前提** | bps_complete_task 自动匹配 serviceId 与 skillsDir 目录 |
| **当前状态** | ✅ 实现。bps_scan_work 返回 dormantSkills 列表 |
| **关联能力** | → C-T11 (完成任务时自动记录), → C-T07 (scan_work 返回休眠 Skill) |
| **实现映射** | `src/store/skill-metrics-store.ts` — `SkillMetricsStore.record()`, `getSummaries()`, `getDormantSkillNames()` |

### C-25: 审计日志 (Task Audit Log)

| 项目 | 内容 |
|------|------|
| **能力描述** | 每次任务状态变更写入结构化日志（taskId, action, fromState, toState, details, timestamp） |
| **假设前提** | 审计日志不可删除，用于事后追溯 |
| **当前状态** | ✅ 实现 |
| **关联能力** | → C-08 (ProcessTracker 自动写入), → C-D04c (Agent Log 页展示) |
| **实现映射** | `src/engine/process-tracker.ts` — `writeLog()`; `src/store/process-store.ts` — `writeTaskLog()` |

### C-26: Dashboard 查询服务 (Dashboard Query Service)

| 项目 | 内容 |
|------|------|
| **能力描述** | 聚合查询层——Overview 统计、Process Kanban、Entity 详情、Process 详情 |
| **假设前提** | Dashboard 需要跨 Store 聚合查询 |
| **当前状态** | ✅ 实现 |
| **关联能力** | → C-05/C-06/C-06a (底层 Store), → C-D04a~D04d (页面消费) |
| **实现映射** | `src/store/dashboard-query-service.ts` — `DashboardQueryService` |

---

## 十三、能力关联矩阵

下表展示核心能力之间的依赖和数据流关系（→ 表示"数据流向"或"调用依赖"）：

```
                    ┌─────────────────────────────────────────────┐
                    │            Agent (Aida / 子 Agent)           │
                    │         C-20 Workspace + C-21 Skills         │
                    └─────────────────┬───────────────────────────┘
                                      │ 调用 BPS Tools
                    ┌─────────────────▼───────────────────────────┐
                    │         Agent 工具集 (C-T01 ~ C-T17)         │
                    │    8 读操作 + 9 写操作（管理包装 C-10）        │
                    └───────┬─────────┬─────────┬─────────────────┘
                            │         │         │
              ┌─────────────▼──┐  ┌───▼────┐  ┌─▼──────────────┐
              │  管理层 (C-09~12)│  │ 编译器  │  │  MCP Server    │
              │  约束 + 熔断器  │  │ (C-14) │  │  (C-19)        │
              │  + 审批 + 学习  │  │ flow→  │  │  3 外部工具    │
              └───────┬────────┘  │ rules  │  └───┬────────────┘
                      │           └───┬────┘      │
              ┌───────▼───────────────▼───────────▼───────────────┐
              │              BPS 引擎核心                          │
              │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
              │  │ ProcessTracker│  │ BlueprintStore│  │DossierStore│ │
              │  │   (C-08)     │  │   (C-06)     │  │  (C-05)  │ │
              │  │ 5-state SM   │  │ Service/Rule │  │ 版本化JSON│ │
              │  │  (C-07)      │  │ 拓扑查询     │  │ 智能合并  │ │
              │  └──────┬───────┘  └──────────────┘  └────┬─────┘ │
              │         │          ┌──────────────┐       │       │
              │         │          │ KnowledgeStore│───────┘       │
              │         │          │   (C-07a)    │  (复用 Dossier)│
              │         │          └──────────────┘               │
              │         │          ┌──────────────┐               │
              │         │          │  StatsStore   │               │
              │         │          │   (C-23)     │               │
              │         │          └──────────────┘               │
              │         │          ┌──────────────┐               │
              │         │          │SkillMetrics  │               │
              │         │          │   (C-24)     │               │
              │         │          └──────────────┘               │
              └─────────┼─────────────────────────────────────────┘
                        │ emit 事件
              ┌─────────▼─────────────────────────────────────────┐
              │              Dashboard (C-D01 ~ D07)               │
              │  拓扑图 + 实时动画 + 管理全景 + 审批闭环 + SSE      │
              └───────────────────────────────────────────────────┘
```

### 关键数据流

| 路径 | 说明 |
|------|------|
| Agent → Tool → ActionGate → ManagementStore | 写操作管理检查链 |
| Agent → Tool → ProcessTracker → ProcessStore + DossierStore | 任务执行 + 实体自动提交 |
| Agent → bps_load_blueprint → compiler → BlueprintStore | 蓝图编译加载链 |
| ProcessTracker → emit → StatsStore | 统计自动收集 |
| ProcessTracker → emit → SSE → Dashboard | 实时可视化链 |
| ManagementStore → emit → SSE → Dashboard | 管理事件实时链 |
| Dashboard → approve → replayToolCall → ProcessTracker/DossierStore | 审批→执行闭环 |
| MCP Client → MCP Server → DossierStore | 外部 Agent 数据访问 |

### 能力统计

| 类别 | 数量 |
|------|------|
| Schema 定义 (C-01~04a) | 6 |
| 持久化 Store (C-05~06a) | 4 |
| 引擎核心 (C-07~08) | 2 |
| 管理层 (C-09~12b) | 7 |
| 编译与加载 (C-13~14b) | 5 |
| 知识管理 (C-07a~07b) | 2 |
| Agent 工具 (C-T01~T17) | 17 |
| Dashboard (C-D01~D07) | 11 |
| 外部集成 (C-18~19a) | 3 |
| Agent Workspace (C-20~22) | 4 |
| 可观测性 (C-23~26) | 4 |
| **合计** | **65** |

---

## 附录 A：源文件→能力映射索引

| 源文件 | 能力编号 |
|--------|---------|
| `src/schema/common.ts` | C-01~04a (基础类型) |
| `src/schema/entity.ts` | C-01 |
| `src/schema/service.ts` | C-02 |
| `src/schema/rule.ts` | C-03, C-04 |
| `src/schema/role.ts` | C-04a |
| `src/schema/process.ts` | C-07 |
| `src/schema/dossier.ts` | C-05, C-05a |
| `src/schema/resource.ts` | C-02 (ResourceRequirement) |
| `src/store/dossier-store.ts` | C-05, C-05a |
| `src/store/blueprint-store.ts` | C-06 |
| `src/store/process-store.ts` | C-06a |
| `src/store/stats-store.ts` | C-23 |
| `src/store/skill-metrics-store.ts` | C-24 |
| `src/store/dashboard-query-service.ts` | C-26 |
| `src/engine/state-machine.ts` | C-07 |
| `src/engine/process-tracker.ts` | C-08, C-25 |
| `src/management/types.ts` | C-09~12 (类型定义) |
| `src/management/constants.ts` | C-09 |
| `src/management/management-store.ts` | C-09, C-12, C-12a, C-12b |
| `src/management/management-loader.ts` | C-09 |
| `src/management/action-gate.ts` | C-10, C-11 |
| `src/loader/yaml-loader.ts` | C-13 |
| `src/loader/blueprint-compiler.ts` | C-14 |
| `src/loader/project-loader.ts` | C-14a |
| `src/loader/aida-project.ts` | C-14b |
| `src/knowledge/knowledge-store.ts` | C-07a |
| `src/knowledge/system-knowledge.ts` | C-07b |
| `src/integration/tools.ts` | C-T01~T17 |
| `src/integration/plugin.ts` | C-18 |
| `src/integration/events.ts` | C-18 |
| `src/mcp/server.ts` | C-19, C-19a |
| `src/index.ts` | 主导出 + createBpsEngine() |
| `index.ts` | C-18 (插件入口) |
| `dashboard/server/routes.ts` | C-D05, C-D06, C-D07 |
| `dashboard/server/simulate.ts` | C-D03 |
| `dashboard/client/src/pages/*.vue` | C-D01~D04d |
| `agents/aida/` | C-20~22 |
| `agents/aida/skills/` | C-21 |

## 附录 B：测试覆盖

| 测试域 | 测试数 | 覆盖能力 |
|--------|--------|---------|
| 引擎核心 (`test/`) | 255 | C-01~08, C-13~14b, C-07a~07b |
| 管理层 (`test/management.test.ts`) | ~45 | C-09~12b |
| Dashboard API (`dashboard/test/`) | 112 | C-D01~D07 |
| Skill Metrics (`test/`) | 4 | C-24 |
| E2E (`test/e2e/`) | 128 (AEF R1) | 全覆盖 |
| **合计** | **437+** | |

## 附录 C：AEF 十一维能力健康度评估

基于 AIDA 评估理论框架（AEF）v0.1 的十一维能力结构，将本清单中的 65 项能力映射到 AEF 维度并给出健康度评估。

> 详见 `docs/AIDA评估理论框架 (AEF) v0.1.md`

### 理论基座

AEF 使用四元理论交叉验证架构决策的正确性：

| 理论 | 诊断问题 | AIDA 映射 |
|------|---------|----------|
| **操作系统理论** | 机制实现是否正确？ | Entity ↔ 内存页, Task ↔ 进程, Management ↔ 保护环 |
| **控制论** | 调节是否有效？ | 约束 ↔ 控制器, Agent ↔ 被控对象, 熔断器 ↔ 唯一全自动反馈环 |
| **有限理性** | Agent 是否可用？ | BPS Tools ↔ 决策支持, Workspace ↔ 决策架构 |
| **认知导航-重映射** | 是否平衡利用与探索？ | 确定性规则 ↔ 已知空间导航, 非确定性 LLM ↔ 新情境重映射 |

### 维度健康度

| AEF 维度 | 健康度 | 评分 | 覆盖能力编号 | 已知差距 |
|----------|--------|------|-------------|---------|
| **Σ1 PROC** 进程生命周期 | ADEQUATE | 0.83 | C-07, C-08, C-06a, C-T09~T11, C-T17, C-25 | 无任务超时检测 |
| **Σ2 ENTITY** 实体架构 | HEALTHY | 0.95 | C-01, C-05, C-05a, C-T04, C-T05, C-T12 | — |
| **Σ3 GATE** 约束执行 | ADEQUATE | 0.80 | C-09, C-10, C-T15, C-T16 | 管理覆盖 9/16 工具（8 读操作不受管控为设计意图） |
| **Σ4 STAB** 稳定性调节 | ADEQUATE | 0.80 | C-11, C-12b | 振荡检测已实现，冷却恢复已实现 |
| **Σ5 FDBK** 反馈学习 | DEGRADED | 0.60 | C-12a, C-24 | 策略建议仅存储不自动执行；dormantSkills 无清理机制 |
| **Σ6 INFO** 信息呈现 | DEGRADED | 0.65 | C-T06, C-T07, C-T08, C-26 | 无信息饱和信号；无"已充分，该执行了"提示 |
| **Σ7 SCHED** 调度效率 | ADEQUATE | 0.75 | C-06a (priority+deadline), C-T07 (overdue+sortByUrgency) | 无 MLFQ 优先级提升；无超时检测 |
| **Σ8 EVOL** 自进化 | ADEQUATE | 0.82 | C-T13, C-T16, C-21, C-22 | Gateway 需重启加载新插件代码 |
| **Σ9 HIER** 层级一致性 | HEALTHY | 0.92 | C-20a, C-14, C-09 | — |
| **Σ10 COADAPT** 协作适应 | ADEQUATE | 0.78 | C-12, C-D04, C-D06 | Dashboard 审批 API 偶发时序问题 |
| **Σ11 MATCH** 能力匹配 | DEGRADED | 0.62 | C-20, C-T01~T17 | 6 模型均出现"说而不做"反模式 |

### 能力→AEF 维度映射

| 能力编号 | AEF 维度 | 贡献说明 |
|---------|---------|---------|
| C-01~04a | Σ1, Σ2, Σ9 | 六元组建模为进程/实体/层级提供基础 |
| C-05, C-05a | Σ2 | 实体版本化 + 关系声明 = 实体架构核心 |
| C-06, C-06a | Σ1, Σ7, Σ9 | 蓝图存储 + 拓扑查询支撑调度和层级 |
| C-07, C-08 | Σ1 | 状态机 + 任务追踪 = 进程生命周期核心 |
| C-09, C-10 | Σ3 | 约束加载 + 前置拦截 = 约束执行核心 |
| C-11 | Σ4 | 熔断器 = 稳定性调节核心 |
| C-12, C-12a | Σ5, Σ10 | 审批 + 策略学习 = 反馈/协作核心 |
| C-12b | Σ4 | 管理事件 = 稳定性可观测 |
| C-13, C-14, C-14a, C-14b | Σ1, Σ9 | 编译加载 = 进程/层级基础设施 |
| C-07a, C-07b | Σ2 | 知识 = 特殊实体类型 |
| C-T01~T08 (读) | Σ6, Σ7 | 信息呈现 + 调度感知 |
| C-T09~T17 (写) | Σ1, Σ2, Σ3, Σ8 | 进程/实体变更 + 约束管控 + 自进化 |
| C-D01~D07 | Σ10 | Dashboard = 人机协作界面 |
| C-18, C-19 | Σ8 | 外部集成 = 能力扩展 |
| C-20~22 | Σ9, Σ11 | Workspace = 层级规范 + 能力匹配 |
| C-23~26 | Σ5, Σ6 | 统计/审计 = 反馈数据源 + 信息呈现 |

### 三框架交叉验证的已知差距

以下差距经 ≥2 个理论框架独立确认（置信度最高）：

| 差距 | OS | 控制论 | 有限理性 | 关联能力 | 状态 |
|------|:--:|:------:|:--------:|---------|------|
| deadline + priority 调度 | ✓ | ✓ | ✓ | C-06a, C-T09 | ✅ P0-b 已修复 |
| 实体关系声明 | ✓ | ✓ | ✓ | C-05a | ✅ P2-b 已修复 |
| 管理绕过封堵 | ✓ | ✓ | — | C-09, C-10 | ✅ P0-a 已修复（9 工具管控） |
| outcome 结构化 | — | ✓ | ✓ | C-T11 | ✅ P0-c 已修复 |
| 熔断器自动恢复 | — | ✓ | — | C-11 | ✅ P1-a 已修复（冷却降级） |
| 信息摘要层 | — | — | ✓ | C-T06, C-T07 | ✅ P1-b 已修复（top-5 + summary） |
| Skill 使用追踪 | — | ✓ | ✓ | C-24 | ✅ P1-c 已修复 |
| 进程组批量操作 | ✓ | — | ✓ | C-T17 | ✅ P2-a 已修复 |
| 审批模式学习 | — | ✓ | — | C-12a | ✅ P3 已修复（建议不自动执行） |
| "说而不做"反模式 | — | — | ✓ | C-20, Σ11 | ⚠️ 待解决（LLM 行为层面） |
| 信息饱和信号 | — | — | ✓ | Σ6 | ⚠️ 待解决 |

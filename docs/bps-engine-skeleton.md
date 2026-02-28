# BPS Engine TypeScript 骨架设计

**文件性质**：工程设计文档
**日期**：2026-02-23
**目标**：将 BPS 规范的 Django 实现改写为 TypeScript，作为 OpenClaw 原生模块

---

## 一、设计决策总览

### 从 Django 到 TS 的关键映射

| Django 概念 | TS 替代方案 | 理由 |
|------------|------------|------|
| Django ORM + PostgreSQL | `better-sqlite3` (同步) + Drizzle ORM | OpenClaw 已用 SQLite，统一技术栈 |
| Django Model 定义 | TypeBox Schema + Drizzle Table | 运行时类型验证 + SQL 类型安全 |
| ContentType + GenericForeignKey | `entityType: string` + `entityId: string` | 泛型外键简化为两字段模式 |
| Django Signals | EventEmitter (Node.js native) | 更轻量，与 OpenClaw Gateway 事件系统对齐 |
| Celery async task | OpenClaw `sessions_spawn` / native `async` | SysCall 直接映射为 Agent 操作 |
| Django Admin (设计器) | Phase 1: JSON/YAML 配置文件; Phase 2: Web UI | 设计器与引擎解耦 |
| pypinyin (中文→拼音) | `pinyin-pro` npm 包 (或外部处理) | 保留中文标签支持 |
| jsonschema 验证 | TypeBox `Value.Check()` | 编译时 + 运行时类型安全 |
| `eval()` 表达式评估 | `expr-eval` 库 (安全沙箱) + LLM 评估 | 消除安全风险，支持 NON_DETERMINISTIC |
| Design/Kernel 双轨制 | 单模块，通过 `status: 'design' \| 'active'` 区分 | 不再需要 copy_design_to_kernel |

### 核心简化原则

1. **消除双轨制**：Django 版的 Design→Kernel 复制管线（`copy_design_to_kernel`）不再需要。TS 版中，Service/Rule/Event 定义直接就是运行时数据，通过 `status` 字段区分草稿/激活状态。

2. **消除代码生成**：Django 版用 `generate_source_code()` 从 DataItem 生成 Django Model。TS 版中，Entity 的 schema 是动态的 JSON（TypeBox），不需要生成源码文件。

3. **SysCall = Agent 操作**：`start_service` 不再创建 Django Model 实例，而是直接调用 OpenClaw `sessions_spawn`。Process 的"创建"和 Agent Session 的"创建"是同一个操作。

---

## 二、包结构

```
packages/bps-engine/          ← OpenClaw monorepo 中的新 pnpm workspace package
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              ← 公共 API 导出
│   │
│   ├── schema/               ← BPS 元模型 TypeBox Schema 定义
│   │   ├── entity.ts         ← Entity（实体）
│   │   ├── service.ts        ← Service（服务）
│   │   ├── rule.ts           ← Rule = Event + Instruction + ServiceRule
│   │   ├── role.ts           ← Role + Operator
│   │   ├── process.ts        ← Process（进程）+ ProcessState
│   │   ├── resource.ts       ← Resource（统一资源模型）
│   │   └── common.ts         ← 共享基础类型（BpsId, Label, Timestamps）
│   │
│   ├── store/                ← 数据持久化层
│   │   ├── db.ts             ← SQLite 数据库初始化与迁移
│   │   ├── entity-store.ts   ← Entity CRUD
│   │   ├── service-store.ts  ← Service CRUD
│   │   ├── rule-store.ts     ← Rule/Event/Instruction CRUD
│   │   ├── process-store.ts  ← Process + ContextSnapshot CRUD
│   │   └── role-store.ts     ← Role/Operator CRUD
│   │
│   ├── engine/               ← BPS 运行时引擎核心
│   │   ├── context.ts        ← ContextFrame + ContextStack
│   │   ├── process-manager.ts ← ProcessCreator（进程创建与生命周期管理）
│   │   ├── rule-evaluator.ts ← RuleEvaluator（规则评估，含 LLM 非确定性评估）
│   │   ├── syscall.ts        ← SysCall 注册表与实现
│   │   └── state-machine.ts  ← ProcessState 状态迁移约束
│   │
│   ├── integration/          ← OpenClaw 整合层
│   │   ├── openclaw-plugin.ts ← OpenClaw 插件注册入口
│   │   ├── tools.ts          ← 注册为 OpenClaw Agent Tools
│   │   ├── events.ts         ← BPS 事件 → OpenClaw Gateway 事件桥接
│   │   └── syscall-bridge.ts ← SysCall → OpenClaw sessions_spawn/send 桥接
│   │
│   └── loader/               ← 业务蓝图加载器
│       ├── yaml-loader.ts    ← 从 YAML 文件加载业务定义
│       └── validator.ts      ← 业务蓝图完整性校验
│
└── test/
    ├── context.test.ts
    ├── rule-evaluator.test.ts
    ├── syscall.test.ts
    └── integration.test.ts
```

---

## 三、Schema 定义（TypeBox）

### 3.1 common.ts — 共享基础类型

```typescript
import { Type, Static } from '@sinclair/typebox';

// BPS 全局唯一标识
export const BpsId = Type.String({ format: 'uuid' });

// 所有 BPS 对象的基础字段（对应 Django ERPSysBase）
export const BpsBase = Type.Object({
  id: BpsId,
  label: Type.String(),                              // 中文名称
  name: Type.Optional(Type.String()),                 // 英文名称（可自动生成）
  status: Type.Union([                                // 替代 Design/Kernel 双轨制
    Type.Literal('draft'),                            // 设计中
    Type.Literal('active'),                           // 已激活（运行时可用）
    Type.Literal('archived'),                         // 已归档
  ]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type BpsBase = Static<typeof BpsBase>;
```

### 3.2 entity.ts — 实体定义

```typescript
import { Type, Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common';

// 实体字段类型（对应 Django FieldType 枚举）
export const FieldType = Type.Union([
  Type.Literal('string'),
  Type.Literal('text'),
  Type.Literal('integer'),
  Type.Literal('decimal'),
  Type.Literal('boolean'),
  Type.Literal('datetime'),
  Type.Literal('date'),
  Type.Literal('time'),
  Type.Literal('json'),
  Type.Literal('file'),
  Type.Literal('reference'),     // 对应 Django TypeField（外键引用）
  Type.Literal('computed'),      // 计算字段
]);

// 实体实现类型（对应 Django ImplementType 枚举）
export const ImplementType = Type.Union([
  Type.Literal('field'),         // 字段
  Type.Literal('enum'),          // 枚举对象
  Type.Literal('data_table'),    // 数据表
  Type.Literal('system_table'),  // 系统保留表（Service/Role/Process 等）
  Type.Literal('log'),           // 日志表
  Type.Literal('view'),          // 视图
  Type.Literal('ui_component'),  // UI 组件
]);

// 实体字段定义（对应 Django DataItemConsists）
export const EntityField = Type.Object({
  fieldId: BpsId,                                     // 字段本身也是 Entity
  order: Type.Integer({ minimum: 0, default: 10 }),
  defaultValue: Type.Optional(Type.Unknown()),
});

// 实体定义（对应 Django DataItem）
export const EntityDef = Type.Composite([
  BpsBase,
  Type.Object({
    fieldType: FieldType,
    implementType: ImplementType,
    businessType: Type.Optional(BpsId),               // is-a 关系
    affiliatedTo: Type.Optional(BpsId),               // part-of 关系
    fields: Type.Array(EntityField, { default: [] }), // 组成字段
    isMultivalued: Type.Boolean({ default: false }),
    dependencyOrder: Type.Integer({ default: 0 }),
    computedLogic: Type.Optional(Type.String()),
    initContent: Type.Optional(Type.Unknown()),       // 初始数据
  }),
]);

export type EntityDef = Static<typeof EntityDef>;
```

### 3.3 service.ts — 服务定义

```typescript
import { Type, Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common';

// 服务类型（BPS 规范的 composition_type + Django ServiceType）
export const ServiceType = Type.Union([
  Type.Literal('atomic'),        // 原子服务（primitive=true）
  Type.Literal('composite'),     // 复合服务（由 Rule 编排）
]);

// 执行者类型
export const ExecutorType = Type.Union([
  Type.Literal('manual'),        // 人工执行
  Type.Literal('agent'),         // Agent 执行
  Type.Literal('system'),        // 系统自动执行
]);

// 资源需求（统一 5 类资源为通用模型）
export const ResourceRequirement = Type.Object({
  resourceId: BpsId,
  resourceType: Type.Union([
    Type.Literal('material'),
    Type.Literal('equipment'),
    Type.Literal('device'),
    Type.Literal('capital'),
    Type.Literal('knowledge'),
  ]),
  quantity: Type.Integer({ minimum: 1, default: 1 }),
});

// 服务定义（合并 Django Design Service 和 Kernel Service）
export const ServiceDef = Type.Composite([
  BpsBase,
  Type.Object({
    serviceType: ServiceType,
    executorType: ExecutorType,
    entityType: Type.Optional(Type.String()),          // 服务对象类型名
    subjectEntity: Type.Optional(BpsId),               // 作业记录实体
    manualStart: Type.Boolean({ default: false }),
    resources: Type.Array(ResourceRequirement, { default: [] }),
    subServices: Type.Array(Type.Object({              // 服务组成（BOM）
      serviceId: BpsId,
      quantity: Type.Integer({ default: 1 }),
    }), { default: [] }),
    routeTo: Type.Optional(BpsId),                     // 默认分配至特定 Operator
    price: Type.Optional(Type.Number()),
    // 以下为与 OpenClaw 整合的扩展字段
    agentSkills: Type.Optional(Type.Array(Type.String())),  // Agent 执行时需要的 Skill 清单
    agentPrompt: Type.Optional(Type.String()),               // Agent 执行时的额外 system prompt
  }),
]);

export type ServiceDef = Static<typeof ServiceDef>;
```

### 3.4 rule.ts — 规则（Event + Instruction + ServiceRule）

```typescript
import { Type, Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common';

// 事件评估模式（BPS 规范核心扩展点）
export const EvaluationMode = Type.Union([
  Type.Literal('deterministic'),       // 布尔表达式，引擎自动求值
  Type.Literal('non_deterministic'),   // 自然语言，路由给 LLM/人类判断
]);

// 事件定义（对应 Django Event）
export const EventDef = Type.Composite([
  BpsBase,
  Type.Object({
    expression: Type.Optional(Type.String()),          // 布尔表达式 或 自然语言描述
    evaluationMode: EvaluationMode,
    isTimer: Type.Boolean({ default: false }),
    timerConfig: Type.Optional(Type.Object({           // 定时事件配置
      cron: Type.Optional(Type.String()),
      intervalMs: Type.Optional(Type.Integer()),
    })),
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
]);

// 系统指令定义（对应 Django Instruction）
export const InstructionDef = Type.Composite([
  BpsBase,
  Type.Object({
    sysCall: Type.Union([
      // 流程控制指令（已实现）
      Type.Literal('start_service'),
      Type.Literal('call_sub_service'),
      Type.Literal('calling_return'),
      Type.Literal('start_iteration_service'),
      Type.Literal('start_parallel_service'),
      // 异常处理指令（BPS 规范定义但 Django 版未实现）
      Type.Literal('retry_process'),
      Type.Literal('terminate_process'),
      Type.Literal('escalate_process'),
      Type.Literal('rollback_process'),
    ]),
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
]);

// 服务规则（对应 Django ServiceRule —— 将 Event + Instruction 绑定到 Service）
export const ServiceRuleDef = Type.Composite([
  BpsBase,
  Type.Object({
    targetServiceId: BpsId,       // 隶属的服务程序（scope）
    order: Type.Integer({ default: 0 }),
    serviceId: BpsId,             // 主体服务（当前服务）
    eventId: BpsId,               // 触发事件
    instructionId: BpsId,         // 执行指令
    operandServiceId: Type.Optional(BpsId),  // 后续要启动的服务
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
]);

export type EventDef = Static<typeof EventDef>;
export type InstructionDef = Static<typeof InstructionDef>;
export type ServiceRuleDef = Static<typeof ServiceRuleDef>;
```

### 3.5 role.ts — 角色与操作员

```typescript
import { Type, Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common';

// 角色类型
export const RoleType = Type.Union([
  Type.Literal('user_defined'),     // 用户定义（人类角色）
  Type.Literal('agent'),            // Agent 角色
  Type.Literal('system'),           // 系统内置
]);

// 角色定义（对应 Django Role）
export const RoleDef = Type.Composite([
  BpsBase,
  Type.Object({
    roleType: RoleType,
    serviceIds: Type.Array(BpsId, { default: [] }),   // 角色能力（可执行的服务）
  }),
]);

// 操作员（计算节点实例）（对应 Django Operator）
export const OperatorDef = Type.Composite([
  BpsBase,
  Type.Object({
    active: Type.Boolean({ default: true }),
    roleIds: Type.Array(BpsId, { default: [] }),
    organizationId: Type.Optional(BpsId),
    // OpenClaw 整合：Agent Operator 的会话标识
    agentSessionKey: Type.Optional(Type.String()),     // 如果是 Agent，对应 OpenClaw session key
    agentId: Type.Optional(Type.String()),             // 对应 OpenClaw agent ID
  }),
]);

export type RoleDef = Static<typeof RoleDef>;
export type OperatorDef = Static<typeof OperatorDef>;
```

### 3.6 process.ts — 进程（运行时核心）

```typescript
import { Type, Static } from '@sinclair/typebox';
import { BpsId } from './common';

// 进程状态（对应 Django ProcessState 枚举）
export const ProcessState = Type.Union([
  Type.Literal('NEW'),
  Type.Literal('READY'),
  Type.Literal('RUNNING'),
  Type.Literal('WAITING'),
  Type.Literal('SUSPENDED'),
  Type.Literal('TERMINATED'),
  Type.Literal('ERROR'),
]);

// 合法状态迁移（Django 版缺少的约束）
export const VALID_TRANSITIONS: Record<string, string[]> = {
  'NEW':        ['READY', 'ERROR'],
  'READY':      ['RUNNING', 'SUSPENDED', 'ERROR'],
  'RUNNING':    ['WAITING', 'SUSPENDED', 'TERMINATED', 'ERROR'],
  'WAITING':    ['RUNNING', 'READY', 'ERROR'],
  'SUSPENDED':  ['READY', 'ERROR'],
  'TERMINATED': [],                                    // 终态，不可再迁移
  'ERROR':      ['NEW'],                               // 可重试回到 NEW
};

// 上下文帧（对应 Django ContextFrame）
export const ContextFrameSchema = Type.Object({
  processId: BpsId,
  status: Type.String({ default: 'ACTIVE' }),
  localVars: Type.Record(Type.String(), Type.Unknown()),
  inheritedContext: Type.Record(Type.String(), Type.Unknown()),
  returnValue: Type.Optional(Type.Unknown()),
  errorInfo: Type.Optional(Type.String()),
  eventsTriggeredLog: Type.Array(Type.Object({
    ruleId: BpsId,
    ruleLabel: Type.String(),
    eventExpression: Type.String(),
    evaluatedAt: Type.String({ format: 'date-time' }),
  }), { default: [] }),
});

// 上下文堆栈（对应 Django ContextStack 序列化格式）
export const ContextStackSchema = Type.Object({
  frames: Type.Array(ContextFrameSchema),
});

// 进程定义（对应 Django Process）
export const ProcessDef = Type.Object({
  id: BpsId,
  pid: Type.Integer(),                                 // 自增进程 ID
  name: Type.Optional(Type.String()),
  parentId: Type.Optional(BpsId),                      // 父进程
  previousId: Type.Optional(BpsId),                    // 前序进程
  serviceId: BpsId,                                    // 关联服务
  state: ProcessState,
  priority: Type.Integer({ default: 0 }),
  entityType: Type.Optional(Type.String()),            // 业务实体类型
  entityId: Type.Optional(Type.String()),              // 业务实体 ID
  operatorId: Type.Optional(BpsId),                    // 执行操作员
  creatorId: Type.Optional(BpsId),                     // 创建者
  programEntrypoint: Type.Optional(BpsId),             // 服务程序入口
  scheduledTime: Type.Optional(Type.String({ format: 'date-time' })),
  startTime: Type.Optional(Type.String({ format: 'date-time' })),
  endTime: Type.Optional(Type.String({ format: 'date-time' })),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  // OpenClaw 整合
  agentSessionKey: Type.Optional(Type.String()),       // 对应 OpenClaw 会话键
});

// 进程上下文快照（对应 Django ProcessContextSnapshot）
export const ProcessContextSnapshot = Type.Object({
  id: BpsId,
  processId: BpsId,
  version: Type.Integer({ minimum: 1 }),
  contextData: ContextStackSchema,
  contextHash: Type.String(),                          // SHA-256
  createdAt: Type.String({ format: 'date-time' }),
});

export type ProcessState = Static<typeof ProcessState>;
export type ProcessDef = Static<typeof ProcessDef>;
export type ContextFrame = Static<typeof ContextFrameSchema>;
export type ContextStack = Static<typeof ContextStackSchema>;
```

---

## 四、Engine 核心接口

### 4.1 context.ts — 上下文管理

```typescript
import { ContextFrame, ContextStack, ProcessDef } from '../schema/process';
import { createHash } from 'crypto';

/**
 * 上下文帧（对应 Django ContextFrame 类）
 * 纯数据结构 + 辅助方法，不持有 DB 引用
 */
export class BpsContextFrame {
  processId: string;
  status: string = 'ACTIVE';
  localVars: Record<string, unknown> = {};
  inheritedContext: Record<string, unknown> = {};
  returnValue: unknown = null;
  errorInfo: string | null = null;
  eventsTriggeredLog: ContextFrame['eventsTriggeredLog'] = [];

  constructor(process: ProcessDef, parentFrame?: BpsContextFrame) {
    this.processId = process.id;
    if (parentFrame) {
      this.inheritedContext = { ...parentFrame.localVars };
    }
  }

  toJSON(): ContextFrame {
    return {
      processId: this.processId,
      status: this.status,
      localVars: this.localVars,
      inheritedContext: this.inheritedContext,
      returnValue: this.returnValue,
      errorInfo: this.errorInfo ?? undefined,
      eventsTriggeredLog: this.eventsTriggeredLog,
    };
  }

  static fromJSON(data: ContextFrame): BpsContextFrame {
    const frame = Object.create(BpsContextFrame.prototype);
    Object.assign(frame, data);
    return frame;
  }
}

/**
 * 上下文堆栈（对应 Django ContextStack 类）
 */
export class BpsContextStack {
  frames: BpsContextFrame[] = [];

  push(process: ProcessDef, parentFrame?: BpsContextFrame): BpsContextFrame {
    const parent = parentFrame ?? this.current();
    const frame = new BpsContextFrame(process, parent ?? undefined);
    this.frames.push(frame);
    return frame;
  }

  pop(): BpsContextFrame | undefined {
    return this.frames.pop();
  }

  current(): BpsContextFrame | null {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
  }

  toJSON(): ContextStack {
    return { frames: this.frames.map(f => f.toJSON()) };
  }

  computeHash(): string {
    const json = JSON.stringify(this.toJSON(), Object.keys(this.toJSON()).sort());
    return createHash('sha256').update(json).digest('hex');
  }

  static fromJSON(data: ContextStack): BpsContextStack {
    const stack = new BpsContextStack();
    stack.frames = data.frames.map(BpsContextFrame.fromJSON);
    // 重建 parent 引用
    for (let i = 1; i < stack.frames.length; i++) {
      stack.frames[i].inheritedContext = { ...stack.frames[i - 1].localVars };
    }
    return stack;
  }
}
```

### 4.2 state-machine.ts — 状态机约束

```typescript
import { VALID_TRANSITIONS } from '../schema/process';

export class ProcessStateMachine {
  /**
   * 验证状态迁移是否合法
   * Django 版缺少这个约束，任意赋值；TS 版强制执行
   */
  static canTransition(from: string, to: string): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  static assertTransition(from: string, to: string): void {
    if (!this.canTransition(from, to)) {
      throw new BpsStateError(
        `Invalid state transition: ${from} → ${to}. Allowed: ${VALID_TRANSITIONS[from]?.join(', ') ?? 'none'}`
      );
    }
  }
}

export class BpsStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BpsStateError';
  }
}
```

### 4.3 rule-evaluator.ts — 规则评估器（核心升级点）

```typescript
import { Parser } from 'expr-eval';
import { BpsContextFrame } from './context';
import { EventDef, ServiceRuleDef } from '../schema/rule';

// 评估结果
export interface EvaluationResult {
  matched: boolean;
  confidence?: number;          // NON_DETERMINISTIC 模式下的置信度
  reasoning?: string;           // LLM 的推理过程（审计用）
}

// LLM 评估接口（由 OpenClaw 整合层实现）
export interface LlmEvaluator {
  evaluate(description: string, context: Record<string, unknown>): Promise<EvaluationResult>;
}

export class RuleEvaluator {
  private parser = new Parser();
  private llmEvaluator?: LlmEvaluator;

  constructor(llmEvaluator?: LlmEvaluator) {
    this.llmEvaluator = llmEvaluator;
  }

  /**
   * 评估规则集（对应 Django RuleEvaluator.evaluate_rules）
   */
  async evaluateRules(
    frame: BpsContextFrame,
    rules: Array<{ rule: ServiceRuleDef; event: EventDef }>
  ): Promise<Array<{ rule: ServiceRuleDef; result: EvaluationResult }>> {

    const context = this.buildEvaluationContext(frame);
    const matched: Array<{ rule: ServiceRuleDef; result: EvaluationResult }> = [];

    for (const { rule, event } of rules) {
      const result = await this.evaluateEvent(event, context);

      // 记录审计日志
      frame.eventsTriggeredLog.push({
        ruleId: rule.id,
        ruleLabel: rule.label,
        eventExpression: event.expression ?? event.label,
        evaluatedAt: new Date().toISOString(),
      });

      if (result.matched) {
        matched.push({ rule, result });
      }
    }

    return matched;
  }

  /**
   * 评估单个事件
   * 关键升级：支持 DETERMINISTIC + NON_DETERMINISTIC 两种模式
   */
  private async evaluateEvent(
    event: EventDef,
    context: Record<string, unknown>
  ): Promise<EvaluationResult> {

    if (event.evaluationMode === 'deterministic') {
      // 安全的表达式求值（替代 Django 的 eval()）
      return this.evaluateDeterministic(event.expression!, context);
    }

    if (event.evaluationMode === 'non_deterministic') {
      // LLM 或人类判断
      if (!this.llmEvaluator) {
        throw new Error(`NON_DETERMINISTIC event "${event.label}" requires LLM evaluator`);
      }
      return this.llmEvaluator.evaluate(event.expression!, context);
    }

    return { matched: false };
  }

  private evaluateDeterministic(
    expression: string,
    context: Record<string, unknown>
  ): EvaluationResult {
    try {
      // expr-eval：安全沙箱，不执行任意代码
      const result = this.parser.evaluate(expression, context as Record<string, number | string | boolean>);
      return { matched: Boolean(result) };
    } catch (e) {
      return { matched: false, reasoning: `Expression error: ${e}` };
    }
  }

  private buildEvaluationContext(frame: BpsContextFrame): Record<string, unknown> {
    return {
      ...frame.inheritedContext,
      ...frame.localVars,
    };
  }
}
```

### 4.4 syscall.ts — 系统调用

```typescript
/**
 * SysCall 结果（对应 Django SysCallResult）
 */
export interface SysCallResult {
  success: boolean;
  message: string;
  data: Record<string, unknown>;
}

/**
 * SysCall 执行上下文（注入依赖）
 */
export interface SysCallContext {
  processStore: ProcessStore;        // 进程持久化
  serviceStore: ServiceStore;        // 服务查询
  ruleStore: RuleStore;              // 规则查询
  agentBridge?: AgentBridge;         // OpenClaw Agent 桥接（可选）
  evaluator: RuleEvaluator;          // 规则评估器
}

/**
 * Agent 桥接接口（由 OpenClaw 整合层实现）
 * 这是 SysCall 与 OpenClaw 的唯一连接点
 */
export interface AgentBridge {
  /** 启动新 Agent 会话（对应 OpenClaw sessions_spawn） */
  spawnAgent(params: {
    serviceId: string;
    skills: string[];
    systemPrompt: string;
    context: Record<string, unknown>;
    timeout?: number;
  }): Promise<{ sessionKey: string }>;

  /** 向运行中的 Agent 发送消息（对应 OpenClaw sessions_send） */
  sendToAgent(params: {
    sessionKey: string;
    message: string;
    replyBack: boolean;
  }): Promise<unknown>;

  /** 向运行中的 Agent 注入新指令（对应 OpenClaw steer） */
  steerAgent(params: {
    sessionKey: string;
    message: string;
  }): Promise<void>;
}

/**
 * SysCall 接口
 */
export interface SysCall {
  execute(params: Record<string, unknown>, ctx: SysCallContext): Promise<SysCallResult>;
}

/**
 * start_service 实现
 * Django 版：创建新 Process DB 记录 + 评估规则
 * TS 版：创建 Process + 如果是 Agent 服务则 spawn Agent
 */
export class StartService implements SysCall {
  async execute(params: Record<string, unknown>, ctx: SysCallContext): Promise<SysCallResult> {
    const ruleId = params.service_rule_id as string;
    const processId = params.process_id as string;

    // 1. 查找规则和目标服务
    const rule = await ctx.ruleStore.getServiceRule(ruleId);
    if (!rule?.operandServiceId) {
      return { success: false, message: 'Rule has no operand service', data: {} };
    }
    const service = await ctx.serviceStore.get(rule.operandServiceId);
    if (!service) {
      return { success: false, message: 'Operand service not found', data: {} };
    }

    // 2. 查找父进程
    const parentProcess = await ctx.processStore.get(processId);
    if (!parentProcess) {
      return { success: false, message: 'Parent process not found', data: {} };
    }

    // 3. 创建新进程
    const newProcess = await ctx.processStore.create({
      serviceId: service.id,
      parentId: parentProcess.parentId ?? parentProcess.id,
      previousId: parentProcess.id,
      operatorId: parentProcess.operatorId,
      entityType: parentProcess.entityType,
      entityId: parentProcess.entityId,
      programEntrypoint: rule.targetServiceId,
      state: 'NEW',
    });

    // 4. 如果是 Agent 服务，且有 AgentBridge，则 spawn Agent
    if (service.executorType === 'agent' && ctx.agentBridge) {
      const { sessionKey } = await ctx.agentBridge.spawnAgent({
        serviceId: service.id,
        skills: service.agentSkills ?? [],
        systemPrompt: service.agentPrompt ?? `Execute service: ${service.label}`,
        context: { processId: newProcess.id, ...params },
      });
      // 关联 Agent 会话到 Process
      await ctx.processStore.update(newProcess.id, { agentSessionKey: sessionKey });
    }

    // 5. 评估新进程的规则
    // （递归：新进程创建后立即评估其规则，可能触发更多 SysCall）
    // 这里省略，实际实现中由 ProcessManager 统一处理

    return {
      success: true,
      message: `Started service: ${service.label}`,
      data: { newProcessId: newProcess.id },
    };
  }
}

/**
 * SysCall 注册表
 */
export const SYSCALL_REGISTRY: Record<string, SysCall> = {
  start_service: new StartService(),
  // call_sub_service, calling_return, start_iteration_service,
  // start_parallel_service, retry_process, terminate_process,
  // escalate_process, rollback_process
  // → 后续实现
};

export async function executeSysCall(
  name: string,
  params: Record<string, unknown>,
  ctx: SysCallContext
): Promise<SysCallResult> {
  const syscall = SYSCALL_REGISTRY[name];
  if (!syscall) {
    return { success: false, message: `Unknown syscall: ${name}`, data: {} };
  }
  return syscall.execute(params, ctx);
}
```

### 4.5 process-manager.ts — 进程管理器

```typescript
import { BpsContextStack, BpsContextFrame } from './context';
import { ProcessStateMachine } from './state-machine';
import { RuleEvaluator } from './rule-evaluator';
import { executeSysCall, SysCallContext } from './syscall';
import { ProcessDef } from '../schema/process';

/**
 * 进程管理器（合并 Django 的 ProcessCreator + ProcessExecutionContext 功能）
 */
export class ProcessManager {
  constructor(private ctx: SysCallContext) {}

  /**
   * 创建并启动进程（对应 Django ProcessCreator.create_process）
   */
  async createProcess(params: {
    serviceId: string;
    operatorId?: string;
    entityType?: string;
    entityId?: string;
    parentId?: string;
    previousId?: string;
    programEntrypoint?: string;
    initParams?: Record<string, unknown>;
  }): Promise<ProcessDef> {

    const service = await this.ctx.serviceStore.get(params.serviceId);
    if (!service) throw new Error(`Service not found: ${params.serviceId}`);

    // 1. 创建 Process 记录
    const process = await this.ctx.processStore.create({
      serviceId: params.serviceId,
      state: 'NEW',
      operatorId: params.operatorId,
      entityType: params.entityType,
      entityId: params.entityId,
      parentId: params.parentId,
      previousId: params.previousId,
      programEntrypoint: params.programEntrypoint ?? service.id,
    });

    // 2. 初始化上下文
    const stack = new BpsContextStack();
    const frame = stack.push(process);

    // 注入进程信息到 localVars
    frame.localVars = {
      process_id: process.id,
      process_state: process.state,
      process_service: service.name,
      process_operator: process.operatorId,
      process_priority: process.priority,
      process_created_at: process.createdAt,
      ...params.initParams,
    };

    // 3. 保存初始上下文快照
    await this.ctx.processStore.saveContextSnapshot(process.id, stack);

    // 4. 评估规则
    await this.evaluateAndExecute(process, frame);

    return process;
  }

  /**
   * 状态迁移（强制约束合法性）
   */
  async transitionState(processId: string, newState: string): Promise<void> {
    const process = await this.ctx.processStore.get(processId);
    if (!process) throw new Error(`Process not found: ${processId}`);

    ProcessStateMachine.assertTransition(process.state, newState);
    await this.ctx.processStore.update(processId, { state: newState });

    // 状态变更后重新评估规则
    const snapshot = await this.ctx.processStore.getLatestSnapshot(processId);
    if (snapshot) {
      const stack = BpsContextStack.fromJSON(snapshot.contextData);
      const frame = stack.current();
      if (frame) {
        frame.localVars.process_state = newState;
        await this.evaluateAndExecute(process, frame);
      }
    }
  }

  /**
   * 规则评估 → SysCall 执行（核心循环）
   */
  private async evaluateAndExecute(
    process: ProcessDef,
    frame: BpsContextFrame,
  ): Promise<void> {
    // 获取该服务程序下的所有规则
    const rules = await this.ctx.ruleStore.getRulesForProcess(
      process.programEntrypoint!,
      process.serviceId,
    );

    // 评估
    const matched = await this.ctx.evaluator.evaluateRules(frame, rules);

    // 执行匹配的规则对应的指令
    for (const { rule } of matched) {
      const instruction = await this.ctx.ruleStore.getInstruction(rule.instructionId);
      if (instruction) {
        await executeSysCall(instruction.sysCall, {
          process_id: process.id,
          service_rule_id: rule.id,
          ...frame.localVars,
        }, this.ctx);
      }
    }
  }
}
```

---

## 五、OpenClaw 整合层

### 5.1 openclaw-plugin.ts — 插件注册入口

```typescript
import type { OpenClawPluginApi } from 'openclaw'; // 假设的类型导入

import { createBpsTools } from './tools';
import { createBpsEventBridge } from './events';
import { createAgentBridge } from './syscall-bridge';
import { initBpsDatabase } from '../store/db';

/**
 * BPS Engine 作为 OpenClaw 插件的注册入口
 */
export function registerBpsPlugin(api: OpenClawPluginApi): void {
  // 1. 初始化 BPS 数据库（复用 OpenClaw 的 SQLite 路径）
  const db = initBpsDatabase(api.runtime.homeDir);

  // 2. 创建 Agent 桥接（连接 SysCall 与 OpenClaw Agent 操作）
  const agentBridge = createAgentBridge(api);

  // 3. 注册 BPS Tools（让 Agent 可以操作 BPS）
  const tools = createBpsTools(db, agentBridge);
  for (const tool of tools) {
    api.registerTool(tool);
  }

  // 4. 注册事件桥接（BPS 状态变更 → OpenClaw 事件）
  createBpsEventBridge(db, api);
}
```

### 5.2 tools.ts — 暴露给 Agent 的工具

```typescript
/**
 * BPS 暴露给 OpenClaw Agent 的 Tools
 * Agent 通过这些 tool 与 BPS 引擎交互
 */
export function createBpsTools(db: Database, bridge: AgentBridge): AgentTool[] {
  return [
    // ——— 查询类 ———
    {
      name: 'bps_list_services',
      description: 'List available BPS services, optionally filtered by entity type',
      schema: Type.Object({
        entityType: Type.Optional(Type.String()),
        manualStart: Type.Optional(Type.Boolean()),
      }),
      async execute(input) { /* ... */ },
    },

    {
      name: 'bps_get_process',
      description: 'Get the current state and context of a BPS process',
      schema: Type.Object({
        processId: Type.String(),
      }),
      async execute(input) { /* ... */ },
    },

    {
      name: 'bps_query_processes',
      description: 'Query BPS processes by state, service, operator, or entity',
      schema: Type.Object({
        state: Type.Optional(ProcessState),
        serviceId: Type.Optional(Type.String()),
        operatorId: Type.Optional(Type.String()),
        entityType: Type.Optional(Type.String()),
        entityId: Type.Optional(Type.String()),
      }),
      async execute(input) { /* ... */ },
    },

    // ——— 操作类 ———
    {
      name: 'bps_start_process',
      description: 'Start a new BPS process for a service',
      schema: Type.Object({
        serviceId: Type.String(),
        entityType: Type.Optional(Type.String()),
        entityId: Type.Optional(Type.String()),
        operatorId: Type.Optional(Type.String()),
        params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
      async execute(input) { /* ... */ },
    },

    {
      name: 'bps_transition_state',
      description: 'Transition a BPS process to a new state',
      schema: Type.Object({
        processId: Type.String(),
        newState: ProcessState,
      }),
      async execute(input) { /* ... */ },
    },

    {
      name: 'bps_complete_task',
      description: 'Mark a BPS process as completed with optional return value',
      schema: Type.Object({
        processId: Type.String(),
        returnValue: Type.Optional(Type.Unknown()),
      }),
      async execute(input) { /* ... */ },
    },

    // ——— 设计类（业务蓝图管理）———
    {
      name: 'bps_load_blueprint',
      description: 'Load a business blueprint from YAML definition',
      schema: Type.Object({
        yamlPath: Type.String(),
      }),
      async execute(input) { /* ... */ },
    },

    {
      name: 'bps_list_entities',
      description: 'List all entity definitions in the current blueprint',
      schema: Type.Object({}),
      async execute(input) { /* ... */ },
    },
  ];
}
```

### 5.3 syscall-bridge.ts — SysCall ↔ OpenClaw 桥接

```typescript
import type { OpenClawPluginApi } from 'openclaw';
import type { AgentBridge } from '../engine/syscall';

/**
 * 将 BPS SysCall 桥接到 OpenClaw Agent 操作
 *
 * 这是三层架构（BPS ↔ 智能编排 ↔ Agent执行）的枢纽
 */
export function createAgentBridge(api: OpenClawPluginApi): AgentBridge {
  return {
    async spawnAgent({ serviceId, skills, systemPrompt, context, timeout }) {
      // 调用 OpenClaw 的 sessions_spawn
      const result = await api.runtime.spawnSession({
        message: systemPrompt,
        extraSystemPrompt: buildBpsAgentPrompt(serviceId, skills, context),
        timeout: timeout ?? 300_000,
        // skills 通过 extraSystemPrompt 注入
        // 或通过 OpenClaw Skill 系统动态装配
      });
      return { sessionKey: result.sessionKey };
    },

    async sendToAgent({ sessionKey, message, replyBack }) {
      return api.runtime.sendToSession({
        to: sessionKey,
        message,
        replyBack,
        idempotencyKey: crypto.randomUUID(),
      });
    },

    async steerAgent({ sessionKey, message }) {
      await api.runtime.steerSession({
        target: sessionKey,
        message,
      });
    },
  };
}

function buildBpsAgentPrompt(
  serviceId: string,
  skills: string[],
  context: Record<string, unknown>,
): string {
  return [
    `You are executing BPS service [${serviceId}].`,
    `Available skills: ${skills.join(', ')}`,
    `Process context: ${JSON.stringify(context, null, 2)}`,
    `When finished, call bps_complete_task with your result.`,
  ].join('\n');
}
```

### 5.4 events.ts — BPS 事件 → OpenClaw 事件桥接

```typescript
import { EventEmitter } from 'events';

/**
 * BPS 引擎内部事件（替代 Django Signals）
 */
export const bpsEvents = new EventEmitter();

// 事件类型
export type BpsEvent =
  | { type: 'process:created'; processId: string; serviceId: string }
  | { type: 'process:state_changed'; processId: string; from: string; to: string }
  | { type: 'process:completed'; processId: string; returnValue?: unknown }
  | { type: 'process:error'; processId: string; error: string }
  | { type: 'rule:evaluated'; ruleId: string; matched: boolean; processId: string }
  | { type: 'syscall:executed'; name: string; processId: string; result: unknown };

/**
 * 将 BPS 事件桥接到 OpenClaw Gateway 事件系统
 */
export function createBpsEventBridge(db: Database, api: OpenClawPluginApi): void {
  // 进程状态变更 → Gateway 广播
  bpsEvents.on('process:state_changed', (event) => {
    api.onEvent('bps.process.stateChanged', {
      processId: event.processId,
      from: event.from,
      to: event.to,
      timestamp: new Date().toISOString(),
    });
  });

  // 进程完成 → 如果有父进程在 WAITING，触发 calling_return
  bpsEvents.on('process:completed', async (event) => {
    // 自动触发 calling_return 逻辑
    // ...
  });

  // 规则命中 → 审计日志
  bpsEvents.on('rule:evaluated', (event) => {
    api.onEvent('bps.rule.evaluated', event);
  });
}
```

---

## 六、业务蓝图加载格式（YAML）

替代 Django Admin 作为 Phase 1 的设计器输入：

```yaml
# idlekr-blueprint.yaml — 闲氪业务蓝图示例（片段）
version: "1.0"
name: "闲氪・自助空间AI交易平台"

entities:
  - id: "ent-store"
    label: "门店"
    implementType: "data_table"
    fields:
      - { fieldId: "ent-store-name", order: 1 }
      - { fieldId: "ent-store-address", order: 2 }
      - { fieldId: "ent-store-location", order: 3 }
      - { fieldId: "ent-store-category", order: 4 }
      - { fieldId: "ent-store-status", order: 5 }

  - id: "ent-timespace-sku"
    label: "时空SKU"
    implementType: "data_table"
    affiliatedTo: "ent-store"
    fields:
      - { fieldId: "ent-sku-room", order: 1 }
      - { fieldId: "ent-sku-timeslot", order: 2 }
      - { fieldId: "ent-sku-price", order: 3 }
      - { fieldId: "ent-sku-inventory", order: 4 }

services:
  - id: "svc-store-onboard"
    label: "门店入驻"
    serviceType: "composite"
    executorType: "agent"
    entityType: "store"
    agentSkills: ["data_collection", "contract_generation", "data_structuring"]

  - id: "svc-geo-publish"
    label: "GEO内容发布"
    serviceType: "atomic"
    executorType: "agent"
    agentSkills: ["geo_content_gen", "model_api_publish"]
    agentPrompt: "为指定门店生成面向大模型的GEO内容并发布"

events:
  - id: "evt-store-data-ready"
    label: "门店数据结构化完成"
    expression: "process_state == 'TERMINATED'"
    evaluationMode: "deterministic"

  - id: "evt-supply-density-check"
    label: "供给密度是否达标"
    expression: "该商圈3公里范围内有效供给是否已达到5家以上？"
    evaluationMode: "non_deterministic"

rules:
  - id: "rule-after-onboard"
    label: "入驻完成后发布GEO"
    targetServiceId: "svc-store-onboard"
    serviceId: "svc-store-onboard"
    eventId: "evt-store-data-ready"
    instructionId: "instr-start-service"
    operandServiceId: "svc-geo-publish"
    order: 10
```

---

## 七、实现路线图

### Phase 1：引擎核心（预计工作量：~1500 行 TS）

1. `schema/` — 全部 TypeBox Schema 定义
2. `engine/context.ts` — ContextFrame + ContextStack
3. `engine/state-machine.ts` — 状态迁移约束
4. `engine/rule-evaluator.ts` — 确定性规则评估（expr-eval）
5. `engine/syscall.ts` — start_service + call_sub_service + calling_return
6. `engine/process-manager.ts` — 进程创建与生命周期管理
7. `store/` — SQLite 持久化层
8. `loader/yaml-loader.ts` — YAML 业务蓝图加载
9. 单元测试

### Phase 2：OpenClaw 整合

1. `integration/openclaw-plugin.ts` — 插件注册
2. `integration/tools.ts` — Agent 工具注册
3. `integration/syscall-bridge.ts` — SysCall → Agent spawn
4. `integration/events.ts` — 事件桥接
5. `engine/rule-evaluator.ts` — 增加 NON_DETERMINISTIC（LLM 评估）
6. 整合测试

### Phase 3：闲氪业务蓝图

1. 定义闲氪 Entity 清单（门店、时空SKU、用户、订单…）
2. 定义闲氪 Service 清单（门店入驻、GEO发布、订单处理…）
3. 定义闲氪 Rule 清单（业务流程编排）
4. 定义闲氪 Skill 清单（Agent 能力映射）
5. 端到端测试

---

## 八、与 Django 版的差异总结

| 维度 | Django 版 | TS 版 |
|------|----------|-------|
| 双轨制 | Design 层 + Kernel 层 + copy 管线 | 单层，`status` 字段区分 |
| 代码生成 | DataItem → Django Model 源码 | 不需要，Entity Schema 是动态 JSON |
| 表达式求值 | `eval()` (不安全) | `expr-eval` (安全沙箱) + LLM |
| 异步执行 | Celery task queue | OpenClaw sessions_spawn (原生) |
| 状态约束 | 无（任意赋值） | 强制状态机校验 |
| 异常处理指令 | 未实现 | 设计中包含 retry/terminate/escalate/rollback |
| NON_DETERMINISTIC | 未实现 | LLM 评估 + 置信度 + 推理链 |
| 5 类资源表 | 5 个独立 Requirements 中间表 | 统一 ResourceRequirement 模型 |
| 实时推送 | Django Channels WebSocket | OpenClaw Gateway 事件系统 |
| 可观测性 | 基础（print 日志） | 全事件驱动 + 上下文快照 + 审计日志 |

---

*本文件为 BPS TypeScript 模块的骨架设计。代码为接口定义和核心逻辑伪实现，确认方向后进入实际编码。*

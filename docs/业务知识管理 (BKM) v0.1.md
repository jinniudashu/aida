# 业务知识管理 (BKM) v0.1

> Business Knowledge Management — AIDA 知识分层分布与多 Agent 共享机制

## 1. 概述

BKM 是 AIDA 的业务知识管理子系统，提供知识的**纵向分层**、**横向作用域**、**多 Agent 共享**和**运行时冲突检测**能力。

### 设计原则

- **零新表**：知识存储为 `entityType="knowledge"` 的 Dossier，复用已有版本化/生命周期机制
- **分层约束**：高层知识（charter/strategy）约束低层知识（ops/contextual）
- **按需装配**：进程创建时根据 scope chain 自动装配相关知识
- **冲突可控**：字段级冲突检测，severity 分级响应

### 架构位置

```
BPS 业务流程层（What）
  └─ 蓝图定义业务流转
智能编排层（When/Who/How many）  ← BKM 在这里
  ├─ 知识装配（ContextAssembler）
  ├─ 冲突检测（ConflictDetector）
  └─ 注入进程上下文（ProcessManager）
Agent 执行层（How）
  └─ Agent 通过 frame.localVars['_knowledge'] 消费知识
```

## 2. 核心概念

### 2.1 知识层次（KnowledgeLayer）

知识按治理层级纵向分为五层，优先级数字越小级别越高：

| 层次 | 优先级 | 定位 | 示例 |
|------|--------|------|------|
| `charter` | 0 | 组织宪章/基本原则 | 结晶化判断框架、冲突处理规则 |
| `strategy` | 1 | 战略方向/长期目标 | 年度重点、市场策略 |
| `domain` | 2 | 领域知识/专业规范 | 行业标准、业务规则 |
| `ops` | 3 | 运营知识/操作流程 | SOP、审计流程 |
| `contextual` | 4 | 情境知识/临时参数 | 当前活动配置、临时策略 |

### 2.2 知识作用域（KnowledgeScope）

知识按组织结构横向划分作用域：

| 作用域 | 格式 | 说明 |
|--------|------|------|
| 系统 | `system` | 系统保留知识（引擎内置） |
| 全局 | `global` | 组织级通用知识 |
| 团队 | `team:{teamId}` | 团队内共享知识（如 `team:geo`） |
| Agent | `agent:{agentId}` | Agent 专属知识（如 `agent:aida`） |
| 领域 | `domain:{name}` | 业务领域知识（如 `domain:crm`） |
| 服务 | `service:{serviceId}` | 特定服务绑定知识 |

### 2.3 知识地址（KnowledgeAddress）

每条知识由三元组唯一标识：

```typescript
interface KnowledgeAddress {
  layer: KnowledgeLayer;   // 层次
  scope: KnowledgeScope;   // 作用域
  topic: string;           // 主题（最后一段，不含冒号）
}
```

**存储编码**：地址编码为 Dossier 的 `entityId`，格式 `"{layer}:{scope}:{topic}"`。

解析策略：首个冒号分 layer，最后一个冒号分 topic，中间是 scope（处理复合 scope 如 `team:geo`）。

```
示例：
  charter:system:crystallization-framework
  ops:team:geo:routing
  domain:global:pricing
```

### 2.4 知识条目（KnowledgeEntry）

```typescript
interface KnowledgeEntry {
  address: KnowledgeAddress;
  dossierId: string;               // 底层 Dossier ID
  version: number;                 // 当前版本号
  data: Record<string, unknown>;   // 知识内容（JSON）
  updatedAt: string;               // ISO 时间戳
}
```

## 3. 模块详解

### 3.1 KnowledgeStore

封装 DossierStore，提供知识专用 CRUD API。

```typescript
class KnowledgeStore {
  constructor(dossierStore: DossierStore)

  // 静态工具
  static formatEntityId(address: KnowledgeAddress): string
  static parseEntityId(entityId: string): KnowledgeAddress

  // 写入（浅合并语义）
  put(address, data, opts?): KnowledgeEntry

  // 读取
  getByAddress(address): KnowledgeEntry | null

  // 查询
  queryByScope(scopes[], layer?): KnowledgeEntry[]
  queryForAssembly(scopes[]): KnowledgeEntry[]
  listAll(): KnowledgeEntry[]

  // 生命周期
  archive(address): void
}
```

**浅合并语义**：`put()` 调用 `DossierStore.commit()`，新数据与旧数据浅合并。同名字段被覆盖，未提及字段保留。

```typescript
// 第一次 put
store.put(addr, { theme: 'dark', lang: 'zh' });
// 第二次 put（version 2）
store.put(addr, { lang: 'en', fontSize: 14 });
// 结果：{ theme: 'dark', lang: 'en', fontSize: 14 }
```

### 3.2 ContextAssembler

构建 scope chain，装配知识，合并结果。

```typescript
class ContextAssembler {
  constructor(knowledgeStore, conflictDetector?)

  buildScopeChain(request: AssemblyRequest): KnowledgeScope[]
  assemble(request: AssemblyRequest): AssemblyResult
  formatForContext(result: AssemblyResult): Record<string, unknown>
}
```

#### Scope Chain 构建顺序

```
system → global → team:{id}... → domain:{d}... → domain:{entityType}
  → service:{serviceId} → agent:{agentId} → additionalScopes...
```

scope chain 中越靠后的作用域，装配时其知识可能覆盖前面的（取决于 layer 优先级）。

#### 装配流程

```
1. buildScopeChain(request) → 有序 scope 链
2. knowledgeStore.queryForAssembly(scopes) → 所有匹配条目
3. 按 topic 分组
4. 每个 topic 内按 LAYER_PRIORITY 排序
5. 浅合并（后合并的覆盖先合并的，即低层覆盖高层同名字段）
6. conflictDetector.detect(byTopic) → 冲突报告
7. 返回 AssemblyResult { entries, conflicts, merged }
```

#### 合并策略

对于同一 topic 下的多层条目，按 layer 优先级从高到低依次浅合并。**低层（如 ops）可覆盖高层（如 charter）的同名字段**，但冲突检测器会报告此类覆盖。

```typescript
// charter 层设 maxRetry=1, critical=true
store.put({ layer: 'charter', scope: 'global', topic: 'limits' }, { maxRetry: 1, critical: true });
// ops 层设 maxRetry=5
store.put({ layer: 'ops', scope: 'global', topic: 'limits' }, { maxRetry: 5 });

// 合并结果：{ maxRetry: 5, critical: true }
// 冲突报告：maxRetry 字段在 charter 和 ops 层有不同值 → warning
```

#### 上下文格式

`formatForContext()` 输出结构注入到 `frame.localVars['_knowledge']`：

```json
{
  "_topics": {
    "crystallization-framework": { "principle": "...", "scenarios": [...] },
    "config": { "setting": true }
  },
  "_conflictCount": 0,
  "_conflicts": []
}
```

### 3.3 ConflictDetector

字段级冲突检测，可配置 severity 分级。

```typescript
interface ConflictRule {
  topicPattern: string;       // 精确匹配或 '*' 通配符
  minEntries: number;         // 触发冲突的最小条目数
  severity: ConflictSeverity; // 'critical' | 'warning' | 'info'
  compareFields?: string[];   // 指定比较字段，空则全部比较
}

class ConflictDetector {
  constructor(rules?: ConflictRule[])
  detect(byTopic: Map<string, KnowledgeEntry[]>): ConflictReport[]
}
```

**默认规则**：所有 topic 有 2 条以上条目且字段值不同 → `warning`。

**检测逻辑**：
1. 遍历每个 topic 的条目组
2. 找到匹配规则（精确 → 通配符）
3. 检查条目数是否达到 `minEntries`
4. 比较各条目的字段值（JSON 序列化比较）
5. 值全部相同 → 不冲突；有不同 → 按规则生成 ConflictReport

**自定义规则示例**：

```typescript
const engine = createBpsEngine({
  conflictRules: [
    { topicPattern: 'security-policy', minEntries: 2, severity: 'critical' },
    { topicPattern: '*', minEntries: 2, severity: 'info' },
  ],
});
```

### 3.4 系统保留知识

三条内置知识，通过 `loadSystemKnowledge()` 幂等加载：

| 地址 | 说明 |
|------|------|
| `charter:system:crystallization-framework` | 七场景结晶化判断框架（从 Aida SOUL.md 迁移） |
| `charter:system:knowledge-conflict-rules` | 冲突处理规则（critical→暂停通知, warning→记录, info→仅记录） |
| `ops:system:knowledge-audit-process` | 知识审计 SOP（收集→验证一致性→生成报告） |

```typescript
import { loadSystemKnowledge } from 'bps-engine';

const result = await loadSystemKnowledge(engine.knowledgeStore);
// { loaded: 3, skipped: 0 }  首次
// { loaded: 0, skipped: 3 }  重复调用
```

## 4. ProcessManager 集成

### 注入时机

在 `createProcess()` 中，知识装配发生在 initParams 合并之后、saveContextSnapshot 之前：

```
initParams 合并 → program_entrypoint 设置
  → ★ Knowledge Assembly ★        ← 在这里
    → saveContextSnapshot
      → Agent spawn（系统提示包含知识）
        → Rule evaluation（规则可引用 _knowledge）
```

### 注入逻辑

```typescript
// ProcessManager.createProcess() 内部
if (this.contextAssembler) {
  const assemblyResult = this.contextAssembler.assemble({
    serviceId, agentProfile, entityType, entityId,
  });
  frame.localVars['_knowledge'] = this.contextAssembler.formatForContext(assemblyResult);

  // critical 冲突触发事件
  const criticals = assemblyResult.conflicts.filter(c => c.severity === 'critical');
  if (criticals.length > 0) {
    this.emit('knowledge:conflict', { processId, conflicts: criticals });
  }
}
```

### 新增事件

```typescript
'knowledge:conflict': {
  processId: string;
  conflicts: Array<{ topic: string; severity: string; description: string }>;
}
```

### 新增参数

`createProcess()` 的 params 新增可选 `agentProfile?: AgentProfile`，用于构建 scope chain。

## 5. 引擎配置

### BpsEngineConfig

```typescript
interface BpsEngineConfig {
  db?: DatabaseSync;
  llmEvaluator?: LlmEvaluator;
  agentBridge?: AgentBridge;
  enableKnowledge?: boolean;      // 默认 true
  conflictRules?: ConflictRule[]; // 自定义冲突规则
}
```

- `enableKnowledge !== false` 时，contextAssembler 注入 ProcessManager
- `conflictRules` 未提供时使用默认规则（所有冲突 → warning）

### BpsEngine 接口

```typescript
interface BpsEngine {
  // ... 原有字段 ...
  knowledgeStore: KnowledgeStore;
  contextAssembler: ContextAssembler;
}
```

## 6. 使用示例

### 基本 CRUD

```typescript
const engine = createBpsEngine();
const store = engine.knowledgeStore;

// 写入知识
store.put(
  { layer: 'domain', scope: 'global', topic: 'pricing' },
  { basePrice: 100, currency: 'CNY' },
  { committedBy: 'agent:aida', message: '初始定价策略' },
);

// 读取知识
const entry = store.getByAddress({ layer: 'domain', scope: 'global', topic: 'pricing' });
// entry.data → { basePrice: 100, currency: 'CNY' }

// 更新（浅合并）
store.put(
  { layer: 'domain', scope: 'global', topic: 'pricing' },
  { discount: 0.9 },
);
// data → { basePrice: 100, currency: 'CNY', discount: 0.9 }

// 归档
store.archive({ layer: 'domain', scope: 'global', topic: 'pricing' });
```

### 团队知识共享

```typescript
// 小艾家族通过 team scope 共享知识
store.put({ layer: 'ops', scope: 'team:geo', topic: 'routing' }, { algo: 'tsp', maxStops: 20 });
store.put({ layer: 'ops', scope: 'team:geo', topic: 'schedule' }, { interval: 30 });

// 任何 geo 团队的 Agent 都能获取这些知识
const process = await engine.processManager.createProcess({
  serviceId: 'svc-route-plan',
  agentProfile: { agentId: 'geo-agent-1', teamIds: ['geo'], domains: [] },
});
// frame.localVars['_knowledge']._topics['routing'] → { algo: 'tsp', maxStops: 20 }
```

### 冲突处理

```typescript
// 监听 critical 冲突
engine.processManager.on('knowledge:conflict', (event) => {
  console.log(`进程 ${event.processId} 发现 ${event.conflicts.length} 个关键知识冲突`);
  for (const c of event.conflicts) {
    console.log(`  - ${c.topic}: ${c.description}`);
  }
});
```

### 加载系统知识

```typescript
import { createBpsEngine, loadSystemKnowledge } from 'bps-engine';

const engine = createBpsEngine();
await loadSystemKnowledge(engine.knowledgeStore);
// 3 条系统知识已就绪
```

## 7. 文件清单

| 文件 | 说明 |
|------|------|
| `src/knowledge/types.ts` | 类型定义 |
| `src/knowledge/knowledge-store.ts` | KnowledgeStore 类 |
| `src/knowledge/context-assembler.ts` | ContextAssembler 类 |
| `src/knowledge/conflict-detector.ts` | ConflictDetector 类 |
| `src/knowledge/system-knowledge.ts` | 系统保留知识 + loadSystemKnowledge() |
| `src/engine/process-manager.ts` | ProcessManager 集成（修改） |
| `src/index.ts` | 导出 + 工厂函数（修改） |
| `test/knowledge-store.test.ts` | KnowledgeStore 单元测试（15 tests） |
| `test/context-assembly.test.ts` | ContextAssembler + ConflictDetector 测试（15 tests） |

## 8. 测试覆盖

```
knowledge-store.test.ts (15 tests)
  ├─ Address Encoding (3): 往返编解码、复合 scope、畸形 ID
  ├─ CRUD (4): put/get、浅合并、不存在返回 null、committedBy
  ├─ Query (3): 多 scope、layer 过滤、assembly 查询
  ├─ Lifecycle (2): archive、listAll
  ├─ Isolation (1): knowledge 不干扰普通 Dossier
  └─ System Knowledge (2): 加载、幂等

context-assembly.test.ts (15 tests)
  ├─ Scope Chain (4): 基本链、AgentProfile、entityType、去重
  ├─ Assembly (4): 系统知识、global+team、层级覆盖、格式化
  ├─ ProcessManager Integration (2): _knowledge 注入、子进程继承
  └─ ConflictDetector (5): 无冲突、不同值冲突、相同值无冲突、自定义规则、事件触发
```

全量测试：190 通过（160 原有 + 30 新增）。

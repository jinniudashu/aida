# 实体状态管理分析：Django 版 vs TS 版

> **历史文档**：本文分析的 ProcessManager 等模块已在引擎瘦身（ADR-10）中移除/重命名。
> ProcessManager → ProcessTracker，7-state → 5-state。分析结论仍有参考价值。

## Django 版的机制

Django 版 AIDA 通过 `DataItem` 实现了一套**动态 ORM 代码生成**系统：

1. **DAG 实体描述**：`DataItem` 构成有向无环图，每个节点描述一个实体字段（名称、类型、从属关系、计算逻辑、依赖顺序）
2. **代码生成**：一个编译函数遍历 DAG，为每种实体类型动态生成 Django ORM Model 类——每个实体类型对应一张独立的数据库表，列名和列类型由 DAG 结构决定
3. **实体实例存储**：实体的业务数据（如门店的地址、价格、状态）保存在这些动态生成的表中，拥有完整的关系约束和类型安全
4. **状态历史**：实体的业务状态变更历史保存在这些结构化表中，可以按实体维度追溯

本质上，Django 版实现了一个**元编程系统**——用数据描述数据结构，然后编译为数据库 schema。

## TS 版的实际实现

TS 版做了一个**有意识的大幅简化**。逐层说明实际状态：

### 1. 实体定义层（设计态）

`entity.ts` 定义了 `EntityDef`，具备 DAG 描述的关键字段：

```typescript
EntityDef = {
  fieldType: 'string' | 'integer' | 'json' | 'reference' | 'computed' | ...
  implementType: 'field' | 'data_table' | 'system_table' | 'log' | ...
  affiliatedTo: BpsId,        // 从属关系（DAG 边）
  businessType: BpsId,        // 业务类型分类
  fields: EntityField[],      // 子字段列表
  dependencyOrder: number,    // 依赖排序
  computedLogic: string,      // 计算逻辑
  initContent: unknown,       // 初始值
}
```

这些定义存储在 `bps_entities` 表中。**结构描述能力保留了**，但这只是"元数据"——描述了实体应该长什么样。

### 2. 缺失的关键环节：代码生成

**TS 版没有实现 DAG → 数据库表的编译步骤。**

在 `db.ts` 中，数据库 schema 是**静态预定义**的 10 张固定表：

```
bps_entities          — 实体定义（元数据）
bps_services          — 服务定义
bps_events            — 事件定义
bps_instructions      — 指令定义
bps_service_rules     — 规则定义
bps_roles             — 角色定义
bps_operators         — 操作者定义
bps_processes         — 进程实例
bps_context_snapshots — 上下文快照
bps_resources         — 资源定义
```

**没有一张表是"按实体类型动态生成的"。** 门店、内容、渠道等实体不会各自拥有独立的数据表。

### 3. 实体实例数据实际存储在哪里

TS 版中，实体的业务数据分散在两个地方：

**a) Process 上的标识符（仅 ID，无数据）**

```typescript
// process-store.ts
ProcessDef = {
  entityType: 'store',          // 实体类型标签
  entityId: 'store-changsha-01', // 实体实例 ID
  // ... 但没有实体的业务属性（地址、价格、状态等）
}
```

这只是一个"指针"——说明这个进程处理的是哪个实体，但实体本身的数据不在这里。

**b) ContextFrame.localVars（非结构化 JSON）**

```typescript
// context.ts
ContextFrame = {
  localVars: Record<string, unknown>,      // 任意 KV 对
  inheritedContext: Record<string, unknown>, // 从父进程继承
  returnValue: unknown,                     // 执行返回值
}
```

当 Agent 执行任务时，采集到的业务数据（门店地址、定价、GEO 评分等）作为 `localVars` 写入上下文。这些数据序列化为 JSON 存入 `bps_context_snapshots` 表：

```sql
bps_context_snapshots (
  process_id TEXT,
  version    INTEGER,    -- 版本号，每次状态变更+1
  context_data TEXT,     -- JSON blob: { frames: [{ localVars: {...}, ... }] }
  context_hash TEXT,     -- SHA-256 完整性校验
)
```

### 4. "状态历史"的实现程度

TS 版通过**上下文快照版本链**提供了一种受限的状态历史：

- 每次进程状态迁移时，`ProcessManager.transitionState()` 会保存一个新版本的上下文快照
- 每次进程创建时，保存初始快照和规则评估后的快照
- 可以通过 `version` 字段追溯某个进程的上下文变化历程

**但这是以进程为中心的，不是以实体为中心的。**

Django 版可以回答：*"门店 A 的 GEO 评分从什么时候开始低于 60？"*——直接查实体表的状态历史。

TS 版要回答同样的问题，需要：遍历所有 `entityId = 'store-A'` 的进程 → 逐个反序列化 context_data JSON → 在 localVars 中搜索相关字段。这既低效又脆弱。

## 差异总结

| 维度 | Django 版 | TS 版 |
|------|----------|-------|
| 实体结构定义 | DataItem DAG | EntityDef（等效） |
| 结构→存储的编译 | DAG → Django ORM Model（动态建表） | **未实现** |
| 实体实例存储 | 独立类型化表（每实体类型一张） | ContextFrame.localVars（非结构化 JSON） |
| 实体查询能力 | SQL 按字段查询（WHERE price > 100） | 需反序列化 JSON 遍历 |
| 状态历史维度 | 以实体为中心 | 以进程为中心 |
| 类型安全 | ORM 字段类型约束 | 无运行时约束（Record<string, unknown>） |
| 关系完整性 | 外键约束 | 无 |

## 为什么做了这个简化

skeleton 设计文档中明确写了这个决策：

> **"No code generation - Entity schemas are dynamic JSON (TypeBox)"**

这个简化背后有几层考量：

### 1. 技术栈约束

Django 的 ORM 元类系统（`ModelBase` metaclass）天然支持在运行时动态创建 Model 类——这是 Python 元编程的强项。在 TypeScript/SQLite 中实现等效能力需要：
- 动态 `CREATE TABLE` + 运行时列映射
- 动态生成 TypeBox schema 作为类型守卫
- 动态 SQL prepared statements 管理

这不是不能做，但工作量相当于重新写一个小型 ORM，与"Phase 1 聚焦引擎核心"的目标冲突。

### 2. OpenClaw Agent 范式的不同假设

Django 版假设实体数据由**系统内部**管理——服务端 ORM 持有数据的 source of truth。

TS 版运行在 OpenClaw Agent 框架中，假设**Agent 自身持有业务数据的 working memory**——Agent 在执行任务时，通过工具调用外部系统（地图 API、SaaS 平台、CRM）获取和更新数据。BPS Engine 只需要知道"进程在什么状态、上下文里有什么变量"，不需要自己成为实体数据的 DBMS。

### 3. 上下文快照作为"够用"的折中

对于 Phase 1 的目标（证明 BPS 状态机 + 规则引擎能驱动 Agent 编排），上下文快照已经足够：
- Agent 产出的结果写入 `returnValue` 和 `localVars`
- 规则引擎基于 `localVars` 评估表达式
- 状态变更自动触发链式规则

## 架构缺口评估

当前实现对于**单次流程执行**是够用的。但一旦进入以下场景，缺口就会暴露：

1. **跨流程的实体状态查询**："这个门店当前的综合状态是什么？"——需要聚合该门店所有进程的上下文数据
2. **实体级别的审计追踪**："门店资料什么时候被修改过？"——无法从进程快照中高效提取
3. **实体关系查询**："所有 GEO 评分低于 60 的长沙门店"——无法用 SQL 直接查询，必须全量扫描 JSON
4. **多蓝图共享实体**：不同业务流程操作同一个实体时，没有统一的实体状态视图

## 演进路径（原始分析）

| 路径 | 复杂度 | 适用场景 |
|------|--------|---------|
| **A. 实体投影表** — 监听进程完成事件，将 returnValue 中的关键字段提取到一张 `bps_entity_state` 宽表（entityType, entityId, key, value, updatedAt） | 低 | 快速补丁，满足基本查询 |
| **B. 动态建表** — 实现 EntityDef → CREATE TABLE 的编译器，为每种实体类型创建结构化表 | 高 | 完整还原 Django 能力 |
| **C. 外部实体存储** — BPS Engine 只做流程编排，实体数据委托给外部系统（如 OpenClaw 的 memory/knowledge base） | 中 | 符合 Agent 范式 |

---

## 已实现：实体档案（Entity Dossier）系统

上述架构缺口已通过**实体档案系统**解决，选择了路径 A 的增强版——不是简单的宽表投影，而是独立的版本化文档存储。

### 数据模型

```
bps_dossiers                        bps_dossier_versions
┌────────────────────────┐          ┌─────────────────────────┐
│ id (= erpsysId, UUID)  │◄─────────│ dossier_id              │
│ entity_type            │          │ version                 │
│ entity_id              │          │ data (JSON 完整快照)     │
│ lifecycle (生命周期)    │          │ patch (JSON 本次变更)    │
│ current_version        │          │ committed_by (processId) │
│ created_at / updated_at│          │ commit_message           │
└────────────────────────┘          │ created_at               │
 UNIQUE(entity_type, entity_id)     └─────────────────────────┘
                                     UNIQUE(dossier_id, version)
```

### 解决的架构缺口

| 原始缺口 | 解决方式 |
|----------|---------|
| 跨流程的实体状态查询 | `dossierStore.get(type, id)` 或 `getById(erpsysId)` 直接获取当前聚合状态 |
| 实体级别的审计追踪 | `listVersions(dossierId)` 返回完整版本链，每个版本记录 patch（变更字段）和 committedBy（操作进程） |
| 实体关系查询 | `search({ dataFilter: { city: 'Shanghai' } })` 通过 `json_extract` 按业务字段查询 |
| 多蓝图共享实体 | 档案独立于进程，任何 Agent/进程均可读写同一份档案 |

### erpsysId 机制

借鉴 Django BPS 的 `erpsys_id` 模式：

- Django：每个 `ERPSysBase` 子类实例自动获得全局唯一的 `erpsys_id`（UUID v1），所有跨边界查找（`Process.objects.get(erpsys_id=pid)`）均使用此 ID
- TS 版：`dossier.id` 即 `erpsysId`，业务空间全局唯一。`getById(erpsysId)` 一步定位，无需知道 entityType

### 检索机制

| 检索类型 | 方法 | 说明 |
|----------|------|------|
| 实例定位 | `getById(erpsysId)` | 全局唯一 ID 一步定位（推荐） |
| 类型定位 | `get(entityType, entityId)` | 按复合键定位 |
| 类别检索 | `search({ entityType, lifecycle, dataFilter, limit, offset })` | JSON 字段过滤 + 分页 |
| 跨类型索引 | `findByEntityId(entityId)` | 同一实体 ID 在不同类型下的所有档案 |
| 操作者反查 | `findByCommitter(processId)` | 某进程操作过的所有档案 |

### 自动提交机制

`ProcessManager.completeProcess()` 在进程终止前自动执行：

```
if (returnValue && process.entityType && process.entityId && dossierStore) {
  dossier = getOrCreate(entityType, entityId)
  commit(dossier.id, returnValue, { committedBy: processId })
  emit('dossier:committed', { dossierId, entityType, entityId, processId })
}
```

这使得 Agent 执行结果自然汇聚到实体档案，无需 Agent 显式操作档案 API。

### 与 Django 版的对比更新

| 维度 | Django 版 | TS 版（更新后） |
|------|----------|----------------|
| 实体结构定义 | DataItem DAG | EntityDef（元数据） |
| 结构→存储的编译 | DAG → Django ORM Model（动态建表） | 无动态建表，使用 JSON 文档存储 |
| 实体实例存储 | 独立类型化表（每实体类型一张） | **实体档案**（版本化 JSON，`bps_dossiers` + `bps_dossier_versions`） |
| 实体查询能力 | SQL 按字段查询 | `json_extract` 按字段查询 + 分页 |
| 全局唯一标识 | `erpsys_id`（UUID v1） | `dossier.id` 即 `erpsysId`（UUID v4） |
| 状态历史维度 | 以实体为中心 | **以实体为中心**（版本链 + patch 审计） |
| 跨进程共享 | ORM 表天然共享 | 档案独立于进程，任何组件可读写 |
| 类型安全 | ORM 字段类型约束 | 无运行时约束（`Record<string, unknown>`） |

**仍存在的差距**：TS 版没有 Django 的字段级类型约束和外键关系——JSON 文档存储的灵活性换取了结构安全性。这是"文档存储 vs 关系存储"的经典权衡，对当前 Agent 驱动的业务场景而言是合理的。

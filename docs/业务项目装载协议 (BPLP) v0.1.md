# 业务项目装载协议 (BPLP) v0.1

> Business Project Loading Protocol — 将静态业务文档转化为可执行业务进程的通用方法论

## 1. 概述

### 1.1 定位

BPLP 是 AIDA 平台将真实商业项目加载到 BPS 引擎上运行的标准协议。它定义了从"一堆业务文档"到"可执行的业务进程"的完整转化路径。

### 1.2 与 SBMP/BPS 的关系

```
SBMP（标准业务建模过程）  → 如何从业务中提取流程（方法论）
BPS（业务流程描述规范）    → 如何描述流程（规范）
BPLP（业务项目装载协议）   → 如何将项目加载到引擎（协议） ← 本文
```

- **SBMP** 指导"建模"：从业务现实中识别实体、服务、规则
- **BPS** 规范"描述"：用六元组精确描述业务流程
- **BPLP** 规范"装载"：将建模结果（蓝图 + 数据）加载到引擎并运行

### 1.3 适用场景

任何需要在 AIDA 上运行的商业项目（如 IdleX、内部运营项目等），都通过 BPLP 完成装载。

## 2. 核心概念

### 2.1 业务项目 (Business Project)

一个独立的商业实体，拥有自己的业务目标、运营流程和数据。每个项目在 AIDA 中有独立的目录空间。

### 2.2 项目清单 (Project Manifest)

`project.yaml` — 项目的入口文件，声明该项目依赖的蓝图、上下文和种子数据。引擎通过解析此文件完成项目装载。

### 2.3 种子数据 (Seed Data)

项目运行所需的初始实体数据。装载时写入 DossierStore，成为业务流程的操作对象。

种子数据遵循 **Mock-First 策略**：先用模拟数据验证流程可行性，再逐步替换为真实数据。

### 2.4 业务上下文 (Business Context)

结构化的业务知识文档，供 Agent 消费。包含核心价值定义、领域术语、阶段目标等。不参与引擎加载逻辑，但对 Agent 正确执行业务任务至关重要。

## 3. 四步装载过程

### Step 1: 业务上下文建立

**输入**：业务文档、行业知识、团队共识
**输出**：`context/business-context.yaml`

将散乱的业务知识结构化，产出 Agent 可消费的上下文文件：
- 核心价值与商业模式定义
- 当前阶段目标与约束
- 领域术语表（消除歧义）
- 关键业务指标 (KPI)

### Step 2: 运营流程提取

**输入**：业务上下文 + SBMP 方法论
**输出**：BPS 蓝图 YAML 文件

使用 SBMP 方法论从业务中提取可结晶化的流程：
1. 识别核心实体（Entity）
2. 梳理业务任务（Service）
3. 定义触发规则（Rule）
4. 编写蓝图 YAML

### Step 3: 结晶化评估

**输入**：候选流程列表
**输出**：每个流程的结晶化评估记录

使用七场景判断框架评估流程是否适合结晶化：
1. 是否高频重复？
2. 输入/输出是否可形式化？
3. 是否有明确的完成标准？
4. 是否能分解为原子步骤？
5. 异常路径是否可枚举？
6. Agent 能否胜任执行？
7. 人工干预点是否明确？

只有通过评估的流程才写入蓝图。

### Step 4: 增量部署与迭代

**输入**：蓝图 + 种子数据
**输出**：运行中的业务进程

1. 准备种子数据（Mock-First）
2. 编写 `project.yaml` 项目清单
3. 调用 `loadProject()` 装载
4. 启动流程、验证端到端链路
5. 逐步替换 mock 数据为真实数据

## 4. 项目目录规范

```
projects/
└── {project-id}/
    ├── project.yaml              ← 项目清单（必需）
    ├── context/                  ← 业务上下文
    │   └── business-context.yaml
    └── data/                     ← 种子数据
        ├── mock-*.yaml           ← Mock 数据文件
        └── import-*.yaml         ← 真实数据导入文件
```

**命名约定**：
- 项目目录名 = `projectId`（小写，短横线分隔）
- 种子数据文件前缀标识来源：`mock-`、`import-`、`api-`

## 5. project.yaml Schema

```yaml
version: "1.0"                     # 清单格式版本
name: "项目显示名称"                # 人类可读名称
projectId: "project-id"            # 项目唯一标识符

blueprints:                        # 蓝图文件列表（文件名，基于引擎 blueprints/ 目录）
  - "blueprint-file.yaml"

context:                           # 业务上下文文件（信息性，供 Agent 读取）
  - "context/business-context.yaml"

seeds:                             # 种子数据引用列表
  - file: "data/mock-stores.yaml"  # 相对于 project.yaml 的路径
    entityType: "store"            # 该文件中所有实体的类型
    source: "mock"                 # 数据来源：mock | import | api
    description: "说明文字"         # 可选描述
```

## 6. 种子数据文件 Schema

```yaml
entities:
  - entityId: "entity-001"         # 业务标识符（全局唯一）
    lifecycle: "ACTIVE"            # 可选，默认 ACTIVE
    data:                          # 实体数据（直接写入 Dossier）
      fieldName: "value"
      nestedField:
        subField: "value"
```

**数据写入语义**：
- 每个实体调用 `DossierStore.getOrCreate(entityType, entityId)` 获取或创建 Dossier
- 然后调用 `DossierStore.commit(dossierId, data)` 写入版本化数据
- `committedBy` 标记为 `"project-loader:{projectId}"`，实现可追溯

## 7. Mock-First 数据策略

### 原则

> 先用假数据跑通真流程，再用真数据跑通真业务。

### 实践

1. **初始阶段**：所有种子数据标记 `_mock: true`，使用合理的模拟值
2. **验证阶段**：通过端到端测试验证流程链路完整性
3. **替换阶段**：逐步用真实采集数据替换 mock 数据
4. **共存阶段**：mock 和真实数据可共存，通过 `_mock` 字段区分

### Mock 数据质量要求

- 字段结构必须与真实数据完全一致
- 数值范围应合理反映业务现实
- 地理信息应使用真实地址和坐标
- 每条 mock 数据应有独特的业务特征（覆盖不同场景）

## 8. loadProject API

```typescript
import { loadProject } from 'bps-engine';

const result = loadProject(
  'projects/idlex/project.yaml',  // 项目清单路径
  blueprintStore,                  // 蓝图存储
  dossierStore,                    // 档案存储
  { blueprintBasePath: 'packages/bps-engine/blueprints/' }  // 可选
);

// result: { blueprints, seeds, errors }
```

详见 `packages/bps-engine/src/loader/project-loader.ts`。

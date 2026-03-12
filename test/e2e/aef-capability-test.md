# AEF Capability E2E Test — 十一维结构能力全覆盖验证

> 基于 `docs/AIDA评估理论框架 (AEF) v0.1.md` 设计
> structural-capability 的全面升级版（相同部署 + 业务场景 + Agent turns，更丰富的维度覆盖）

## 定位

| 项目 | structural-capability | aef-capability |
|------|----------------------|----------------|
| 目标 | D1-D9 工程特性验证 + 业务场景 | **AEF Σ1-Σ11 十一维全覆盖** |
| 模式 | 远程服务器 + Agent turns | 远程服务器 + Agent turns（相同） |
| 检查 | ~97 checks (R3) | **128 checks** (69 引擎 + 59 其他) |
| 引擎检查 | 39 (D1-D8) | **69** (D1-D8 + Σ1/Σ7/Σ9/ΣX/Σ11) |
| 维度报告 | 无 | 每维度 health/status 健康度 |
| 关系 | 已被升级替代 | **完整替代** |

## 测试结构（128 检查点）

### Phase 0: 安装验证 (7 checks)
V0.1-V0.7：部署完整性（目录/Workspace文件/Dashboard/Skills/模型锁定）

### Phase 1: 数据种子 (5 checks)
V1.1-V1.5：实体/约束/蓝图种子验证

### Phase 2: 引擎测试 — D1-D8 + AEF Σ1-Σ11 (69 checks)

#### 原 D1-D8 结构检查 (39 checks)
| 域 | 检查数 | AEF 维度映射 |
|----|--------|------------|
| D1 管理拦截 | 10 | Σ3 CONSTRAINT |
| D2 熔断器 | 6 | Σ4 CIRCUIT |
| D3 信息摘要 | 6 | Σ6 CONTEXT |
| D4 进程组+批量 | 4 | Σ1 PROC |
| D5 实体关系 | 5 | Σ2 ENTITY |
| D6 Skill 指标 | 3 | Σ5 LEARNING |
| D7 约束分析 | 3 | Σ5 LEARNING |
| D8 工具注册 | 2 | Σ8 TOOL |

#### AEF 新增检查 (30 checks)

##### Σ1 PROC — 过程生命周期 (6)

| ID | 描述 | 验证内容 |
|----|------|---------|
| E1.01 | Create task → OPEN | 创建任务默认状态正确 |
| E1.02 | OPEN → IN_PROGRESS | 状态转移正确 |
| E1.03 | Complete outcome=success | outcome 通过 bps_complete_task 工具存入 snapshot |
| E1.04 | Complete outcome=partial | partial outcome 正确持久化 |
| E1.05 | IN_PROGRESS → FAILED | failTask 状态转移 |
| E1.06 | IN_PROGRESS → BLOCKED | BLOCKED 状态可达 |

##### Σ7 SCHED — 调度效率 (5)

| ID | 描述 | 验证内容 |
|----|------|---------|
| E7.01 | Past-deadline task exists | 创建含过期 deadline 的任务 |
| E7.02 | scan_work overdueTasks ≥ 1 | overdueTasks 分组检测过期任务 |
| E7.03 | Overdue task in items | 过期任务 ID 出现在 overdueTasks.items |
| E7.04 | Future task NOT overdue | 未过期任务不在 overdueTasks |
| E7.05 | Deadline ASC sort | 早 deadline 排在前（即使 priority 低） |

##### Σ9 HIER — 层级一致性 (3)

| ID | 描述 | 验证内容 |
|----|------|---------|
| E9.01 | scope.tools[] defined | 所有约束有明确工具范围 |
| E9.02 | scope.tools ⊆ GATED_WRITE_TOOLS | 约束只引用受管理的写操作 |
| E9.03 | entityType scoping exists | 至少一个约束按实体类型过滤 |

##### ΣX — 跨维度链路 (6)

| ID | 链路 | 描述 |
|----|------|------|
| EX.01 | Σ3→Σ4 | CRITICAL 违规 → 熔断器 DISCONNECTED |
| EX.02 | Σ4→Σ3 | 重置熔断器 → 写操作恢复 PASS |
| EX.03 | Σ3→Σ5 | N 次违规 → effectiveness.violationCount = N |
| EX.04 | Σ5 | 高通过率审批 → 产生放宽建议 |
| EX.05 | Σ1→Σ7→Σ6 | 任务数据 → scan_work summary 包含计数 |
| EX.06 | Σ1→Σ5 | outcome=partial → outcomeDistribution.partial ≥ 1 |

##### Σ11 MATCH — 能力匹配度 (10)

三层结构：A(结构前提) + B(过度制约抵抗) + C(支持不足检测)

###### A. 结构前提 (4) — 基础设施是否*具备*匹配能力

| ID | 方向 | 描述 | 验证内容 |
|----|------|------|---------|
| E11.01 | Over-constraint | effectiveness API 产生建议 | 系统能检测过度制约并输出放宽/升级建议 |
| E11.02 | Under-support | 管理覆盖多种工具类型 | GATED_WRITE_TOOLS 含实体+非实体工具 |
| E11.03 | Over-constraint | 细粒度 scope 可用 | 约束支持 dataFields 精确过滤（非 blanket） |
| E11.04 | Under-support | scan_work 信息充分 | 暴露 summary + outcomeDistribution + overdueTasks |

###### B. 过度制约抵抗 (3) — 约束是否*行为正确*地避免 blanket blocking

| ID | 描述 | 验证内容 |
|----|------|---------|
| E11.05 | entityType 精确匹配 | 约束 scope 'content' 不拦截 'store' 实体操作 |
| E11.06 | dataFields 精确匹配 | 约束 scope 'publishReady' 不拦截 'name' 字段更新 |
| E11.07 | undefined variable → PASS | 约束引用的字段不在操作数据中时跳过而非 fail-closed |

###### C. 支持不足检测 (3) — 基础设施是否*提供*模型需要的 API

| ID | 描述 | 验证内容 |
|----|------|---------|
| E11.08 | 批量 API 存在 | bps_batch_update 工具可用（强模型的批量操作通道） |
| E11.09 | BLOCK 含结构化信息 | 拦截结果包含 constraintId + severity + message（模型可从拒绝中学习） |
| E11.10 | brief 模式节省上下文 | brief 查询返回的 payload 小于 full 模式（高效信息消费） |

### Phase 3: Dashboard API Tests (11 checks)
S3.01-S3.09：管理状态/违规/约束/审批/实体/熔断器/页面

### Phase 4: Business Scenario — IdleX GEO Operations (27 checks)
8 Agent turns + 1 programmatic approval step：

| Turn | 内容 | 检查数 |
|------|------|--------|
| 1 | 业务简报 — 理解背景 | 4 |
| 2 | 授权建模 — 蓝图/Skill/实体 | 5 |
| 3 | 日常运营 — 探测+内容 | 4 |
| 4 | 管理触发 — 发布审批 | 4 |
| 5 | 程序化审批 | 2 |
| 6 | 自进化 — Skill+Agent | 4 |
| 7 | 日报总结 | 2 |
| 8 | 管理审计 | 2 |

### Phase 5: Final Verification (9 checks)
V5.1-V5.9：实体/约束/Skills/产出/管理/Skill创建/Agent workspace

## 执行

```bash
# 完整 E2E（引擎 + Dashboard + Agent turns）
bash test/e2e/aef-capability.sh --skip-install

# 仅引擎（快速验证，~5 秒）
bash test/e2e/aef-capability.sh --skip-install --engine-only

# 从指定 Phase 开始
bash test/e2e/aef-capability.sh --skip-install --phase 4

# 远程
ssh root@server "cd /root/aida && bash test/e2e/aef-capability.sh --skip-install"
```

模型锁定：`dashscope/qwen3.5-plus`（primary），`kimi/kimi-for-coding`（fallback）

## AEF 维度健康度报告

测试输出包含每个 AEF 维度的健康度评分：

```
AEF Dimension Health:
  Σ1   PROC         10/10  1.00  HEALTHY
  Σ2   ENTITY        5/ 5  1.00  HEALTHY
  Σ3   CONSTRAINT   10/10  1.00  HEALTHY
  Σ4   CIRCUIT       6/ 6  1.00  HEALTHY
  Σ5   LEARNING      6/ 6  1.00  HEALTHY
  Σ6   CONTEXT       6/ 6  1.00  HEALTHY
  Σ7   SCHED         5/ 5  1.00  HEALTHY
  Σ8   TOOL          2/ 2  1.00  HEALTHY
  Σ9   HIER          3/ 3  1.00  HEALTHY
  ΣX   CROSS         6/ 6  1.00  HEALTHY
  Σ11  MATCH        10/10  1.00  HEALTHY
```

状态阈值：`HEALTHY` (1.00) → `DEGRADED` (≥0.80) → `UNHEALTHY` (<0.80)

## Σ11 MATCH 的诊断价值

当 E11 检查失败时的解读：

| 失败检查 | 诊断 | 行动方向 |
|----------|------|---------|
| E11.01 | 系统无法检测自身过度制约 | 实现 constraintEffectiveness 建议引擎 |
| E11.05-07 | 约束 blanket blocking — 模型能力被无差别压制 | 精细化约束 scope + 修复 undefined variable 处理 |
| E11.08 | 缺少批量 API — 强模型必须逐个操作 | 实现 bps_batch_update 或类似工具 |
| E11.09 | 拦截信息不透明 — 模型无法从拒绝中学习 | 结构化 BLOCK 输出（constraintId + reason） |
| E11.10 | 无高效查询模式 — 模型被迫消费全量数据 | 实现 brief 模式或分页 |

## 与 AEF 框架的关系

本测试的检查点直接映射到 `docs/AIDA评估理论框架 (AEF) v0.1.md` 的十一维模型：

- 每个引擎检查通过 `SIGMA_MAP` 映射到 AEF 维度（Σ1-Σ11）
- 失败检查可直接查阅 AEF 文档的对应维度"病征模式"表
- 跨维度链路（ΣX）验证 AEF 附录 B 的维度间依赖关系
- Σ11 MATCH 检查基础设施对模型能力的匹配度（三层诊断）

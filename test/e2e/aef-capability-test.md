# AEF Capability Test — 十维结构能力补充验证

> 基于 `docs/AIDA评估理论框架 (AEF) v0.1.md` 差距分析设计
> 补充 `structural-capability-test`（已收敛，保留不变）

## 定位

| 项目 | structural-capability | aef-capability |
|------|----------------------|----------------|
| 目标 | D1-D9 工程特性验证 + 业务场景 | AEF Σ1/Σ7/Σ9/ΣX 差距补充 |
| 模式 | 远程服务器 + Agent turns | 本地引擎 in-memory，无 Agent |
| 时间 | 15-20 分钟 | ~3 秒 |
| 检查 | 80+ checks | 20 checks |
| 关系 | 收敛基线（只读） | 补充覆盖（叠加） |

## 覆盖差距（为什么需要这个测试）

| AEF 维度 | 现有覆盖 | 本测试新增 | 差距类型 |
|----------|---------|-----------|---------|
| Σ1 PROC | D4 进程组 (4) | 5-state 遍历 + outcome 参数 (6) | 深度不足 |
| Σ7 SCHED | sortByUrgency (1) | overdueTasks + deadline + 排序 (5) | **盲区** |
| Σ9 HIER | grep-based B4 | 程序化约束层级校验 (3) | 方法不足 |
| ΣX Cross | 0 | 跨维度链路验证 (6) | **盲区** |

## 20 个检查点

### Σ1 PROC — 过程生命周期 (6)

| ID | 描述 | 验证内容 |
|----|------|---------|
| E1.01 | Create task → OPEN | 创建任务默认状态正确 |
| E1.02 | OPEN → IN_PROGRESS | 状态转移正确 |
| E1.03 | Complete outcome=success | outcome 存入 contextSnapshot |
| E1.04 | Complete outcome=partial | partial outcome 正确持久化 |
| E1.05 | IN_PROGRESS → FAILED | failTask 状态转移 |
| E1.06 | IN_PROGRESS → BLOCKED | BLOCKED 状态可达 |

### Σ7 SCHED — 调度效率 (5)

| ID | 描述 | 验证内容 |
|----|------|---------|
| E7.01 | Past-deadline task exists | 创建含过期 deadline 的任务 |
| E7.02 | scan_work overdueTasks ≥ 1 | overdueTasks 分组检测过期任务 |
| E7.03 | Overdue task in items | 过期任务 ID 出现在 overdueTasks.items |
| E7.04 | Future task NOT overdue | 未过期任务不在 overdueTasks |
| E7.05 | Deadline ASC sort | 早 deadline 排在前（即使 priority 低） |

### Σ9 HIER — 层级一致性 (3)

| ID | 描述 | 验证内容 |
|----|------|---------|
| E9.01 | scope.tools[] defined | 所有约束有明确工具范围 |
| E9.02 | scope.tools ⊆ GATED_WRITE_TOOLS | 约束只引用受管理的写操作 |
| E9.03 | entityType scoping exists | 至少一个约束按实体类型过滤 |

### ΣX — 跨维度链路 (6)

| ID | 链路 | 描述 |
|----|------|------|
| EX.01 | Σ3→Σ4 | CRITICAL 违规 → 熔断器 DISCONNECTED |
| EX.02 | Σ4→Σ3 | 重置熔断器 → 写操作恢复 PASS |
| EX.03 | Σ3→Σ5 | N 次违规 → effectiveness.violationCount = N |
| EX.04 | Σ5 | 高通过率审批 → 产生放宽建议 |
| EX.05 | Σ1→Σ7→Σ6 | 任务数据 → scan_work summary 包含计数 |
| EX.06 | Σ1→Σ5 | outcome=partial → outcomeDistribution.partial ≥ 1 |

## 执行

```bash
# 本地（项目根目录）
bash test/e2e/aef-capability.sh

# 远程
ssh root@server "cd /opt/aida && bash test/e2e/aef-capability.sh"
```

前提：`npx tsc` 已编译（脚本自动检测 dist/）。

## 输出格式

```
[PASS] E1.01 (Σ1) Create task → state=OPEN
[PASS] E1.02 (Σ1) OPEN → IN_PROGRESS transition
...
[FAIL] E7.03 (Σ7) Overdue task appears in overdueTasks
...
==================================================
AEF Capability Test v0.1
PASS: 19 | FAIL: 1 | TOTAL: 20
==================================================
```

## 与 AEF 框架的关系

本测试的检查点直接映射到 `docs/AIDA评估理论框架 (AEF) v0.1.md` 的十维模型：

- 每个检查点标注 AEF 维度（Σ1/Σ7/Σ9/ΣX）
- 失败检查可直接查阅 AEF 文档的对应维度"病征模式"表
- 跨维度链路（ΣX）验证 AEF 附录 B 的维度间依赖关系

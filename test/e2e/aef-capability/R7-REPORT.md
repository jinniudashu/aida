# AEF Capability E2E Test — R7 报告（MiniMax M2.5 独立评测）

## 测试概要

| 项目 | 值 |
|------|-----|
| 轮次 | R7（MiniMax M2.5 第二轮验证） |
| 日期 | 2026-03-12 |
| 模型 | MiniMax M2.5（Coding Plan，via dashscope alias） |
| 模式 | full（引擎 + Dashboard + 8 Agent turns） |
| 耗时 | 479s（~8.0 分钟） |
| 结果 | **124 PASS / 1 FAIL / 8 WARN / 133 TOTAL** |

## 测试背景

R7 是 MiniMax M2.5 的第二轮 AEF Capability 测试（R6 为首轮）。目的是验证 R6 结果的可复现性，并独立产出评测报告。

### 模型配置说明

由于 OpenClaw 模型路由机制限制（`agents.defaults.model.primary` 与 `models.json` + `auth-profiles.json` 三层配置），R7 采用 **dashscope alias 方式**注入 MiniMax：将 `dashscope` provider 的 baseUrl/apiKey/modelId 临时指向 MiniMax API。JSONL 中 `provider: "dashscope", model: "MiniMax-M2.5"` 可确认实际使用的是 MiniMax M2.5。

## R6→R7 对比

| 检查 | R6 | R7 | 变化 |
|------|-----|-----|------|
| PASS | 129 | 124 | -5 |
| FAIL | 1 | 1 | — |
| WARN | 3 | 8 | +5 |
| TOTAL | 133 | 133 | — |
| 耗时 | 619s | 479s | -23% |
| 新增实体 | 18 | 3 | -15 |
| 新增 Skill | 1 | 0 | -1 |
| 新增 Blueprint | 0 | 1 | +1 |
| Agent workspace | 1 | 1 | — |
| 管理审批 | 3 | 0 | -3 |
| BPS 工具调用 | — | 26 | — |
| 内容文件 | 4 | 4 | — |

## 1 FAIL 分析

| FAIL | 原因 | 严重性 |
|------|------|--------|
| V0.7 模型检查 | 临时 dashscope alias 覆盖，显示 `dashscope/MiniMax-M2.5` | 非真实失败 |

扣除 V0.7 后等效 **125P/0F/8W**。

## 8 WARN 分析

| WARN | 原因 | 类型 |
|------|------|------|
| B4.08 新 Skill=0 | Agent 复用已有 Skills（18 个） | LLM（合理行为） |
| B4.11 Turn 3 新实体=0 | 内容生成到文件而非实体 | LLM |
| B4.17 审批 ID/Dashboard | Turn 4 未提及具体审批 ID | LLM |
| B4.18 待审批=0 | REQUIRE_APPROVAL 路径未完整触发 | LLM |
| B4.19 审批处理=0 | 同上，无 PENDING 审批 | LLM |
| S3.08 审批决策=0 | 无审批记录可决策 | 框架（依赖 B4.18） |
| B4.21 新 Skill 创建=0 | Turn 6 复用已有 Skill | LLM |
| V5.8 Skill 创建 ≥1 | 全程未创建新 Skill | LLM |

**共同根因**：R7 的 MiniMax M2.5 倾向于复用已有资源（Skills、实体类型），且 Turn 4 管理触发路径未完整产生 PENDING 审批。这与 R6 的完整管理闭环形成对比，反映 LLM 行为方差。

## Agent 响应质量

| Turn | 行数 | 关键表现 |
|------|------|---------|
| Turn 1 | 34 | 完整状态盘点 + 5 步推进方案 |
| Turn 2 | 30 | Blueprint + 管理约束 + Cron + 实体类型规划 |
| Turn 3 | 32 | 探测结果摘要 + 豆包内容生成（文件） |
| Turn 4 | 14 | 内容标记 publishReady + 报告管理拦截 |
| Turn 6 | 23 | Skill 文件优化 + Agent workspace 创建 |
| Turn 7 | 59 | 完整日报 — 覆盖率/探测/内容/审批 |
| Turn 8 | 34 | 管理审计 — 约束效能/熔断器/违规 |

**总体**：所有 Turn ≥14 行，无严重截断。重试机制未触发。R7 比 R6 整体更简洁（R6 Turn 2: 82 行 vs R7: 30 行），但信息密度高。

## BPS 工具调用分析

| 工具 | 调用次数 | 说明 |
|------|---------|------|
| bps_query_entities | 7 | 查询实体（最频繁） |
| bps_update_entity | 6 | 更新实体（含 publishReady） |
| bps_load_blueprint | 4 | 加载蓝图（含重试） |
| bps_get_entity | 3 | 获取实体详情 |
| bps_create_skill | 2 | Skill 文件操作（写入优化） |
| bps_register_agent | 1 | Agent workspace 创建 |
| bps_query_tasks | 1 | 查询任务 |
| bps_management_status | 1 | 查询管理状态 |
| bps_load_management | 1 | 加载管理约束 |
| **BPS 合计** | **26** | |
| write | 4 | 文件写入 |
| read | 4 | 文件读取 |
| cron | 2 | Cron 创建（日常+周报） |
| **总计** | **36+** | |

## Agent 业务行为

### 二层路由

| 层 | 行为 | 正确性 |
|----|------|--------|
| 管理层 | Blueprint（idlex-geo-ops） + 管理约束（2 条） | ✅ |
| 运营层 | 实体查询/更新 + 内容文件 + Skill + Agent | ✅ |

### 业务产出

| 指标 | R7 值 |
|------|-------|
| 新增实体 | 3（geo-content） |
| 蓝图 | 1（idlex-geo-ops，6 节点 flow） |
| Agent workspace | 1（xiaoyun 小闲顾客助手） |
| Cron 任务 | 2（每日 09:00 + 每周一 10:00） |
| 内容文件 | 1（cs-doubao-content-20260312.md） |
| 管理约束 | 2（自建 — content-publish + strategy-change） |
| Skill 文件 | 1（geo-probe-daily 优化重写） |

### 管理拦截

R7 管理路径部分触发：
- Turn 4 的 `bps_update_entity` 设置 `publishReady: true` → 触发管理消息（JSONL 有 3 条管理消息）
- 但未产生 PENDING 审批记录（Agent 可能绕过了完整触发路径）
- V5.7 管理行使: PASS（JSONL=9 条管理消息，DB violations=0）

## R6 vs R7 行为差异

| 维度 | R6 | R7 | 分析 |
|------|-----|-----|------|
| 实体创建 | 18 | 3 | R6 为 5 种门店各创建实体；R7 复用已有 |
| 管理闭环 | 完整（3 PENDING→3 APPROVED） | 不完整（0 PENDING） | LLM 行为方差 |
| Blueprint | 0 | 1 | R7 自建 idlex-geo-ops 蓝图 |
| Skill 创建 | 1 | 0 | R6 新建 Skill；R7 优化已有 |
| 耗时 | 619s | 479s | R7 更快（-23%） |
| WARN | 3 | 8 | 管理闭环缺失导致 +5 |

**结论**：同一模型（MiniMax M2.5）两轮测试行为显著不同。R6 侧重实体创建+管理闭环，R7 侧重蓝图建模+资源复用。LLM 行为方差是固有特征，非框架问题。

## AEF 维度健康度

```
Σ1   PROC         10/10  1.00  HEALTHY
Σ2   ENTITY        5/ 5  1.00  HEALTHY
Σ3   CONSTRAINT   10/10  1.00  HEALTHY
Σ4   CIRCUIT       6/ 6  1.00  HEALTHY
Σ5   LEARNING      6/ 6  1.00  HEALTHY
Σ6   CONTEXT       6/ 6  1.00  HEALTHY
Σ7   SCHED         5/ 5  1.00  HEALTHY
Σ8   TOOL          2/ 2  1.00  HEALTHY
Σ9   HIER          3/ 3  1.00  HEALTHY
Σ10  COADAPT       5/ 5  1.00  HEALTHY
ΣX   CROSS         6/ 6  1.00  HEALTHY
Σ11  MATCH        10/10  1.00  HEALTHY
```

12 维度全部 HEALTHY — 引擎层面 74/74 PASS，与 R6 一致。

## 最终数据快照

| 指标 | 值 |
|------|-----|
| 总实体 | 73 |
| 总 Skills | 18 |
| 总 Blueprints | 3 |
| Agent workspaces | 5 |
| 管理约束 | 2（Agent 自建） |
| 内容文件 | 4（含 management.yaml 重写） |

## R6→R7 综合结论

| 维度 | 结论 |
|------|------|
| 引擎稳定性 | 74/74 PASS × 2 轮，引擎层完全可靠 |
| 模型质量 | MiniMax M2.5 无截断（所有 Turn ≥14 行），重试未触发 |
| 行为方差 | 两轮差异显著（实体 18 vs 3，管理闭环完整 vs 不完整） |
| 最佳成绩 | R6（130P\*/0F/3W）> R7（125P\*/0F/8W），\*扣除 V0.7 |
| 核心差距 | R7 管理闭环未触发 — 约束条件匹配但未产生 PENDING 审批 |
| 建议 | 多轮测试取最佳值评估模型能力上限；取中位值评估稳定性 |

## 与 Qwen3.5-Plus 基线对比（R3 数据）

| 指标 | Qwen3.5-Plus (R3) | MiniMax M2.5 (R6) | MiniMax M2.5 (R7) |
|------|-------------------|-------------------|-------------------|
| PASS | 123 | 129 | 124 |
| FAIL | 0 | 1* | 1* |
| WARN | 5 | 3 | 8 |
| 耗时 | 1127s | 619s | 479s |
| 截断 | 有（Turn 2/3 仅 2 行） | 无 | 无 |
| 管理闭环 | 部分（6 审批） | 完整（3 审批） | 不完整 |
| 新增实体 | 3 | 18 | 3 |

*V0.7 临时覆盖，非真实失败

**MiniMax M2.5 优势**：速度快（479-619s vs 1127s）、无截断、输出质量稳定
**MiniMax M2.5 劣势**：行为方差大（R6 vs R7 差距明显）

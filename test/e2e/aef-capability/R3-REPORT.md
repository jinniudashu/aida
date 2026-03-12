# AEF Capability E2E Test — R3 报告

## 测试概要

| 项目 | 值 |
|------|-----|
| 轮次 | R3（V5.7 JSONL 检测 + S3.08 时序修复） |
| 日期 | 2026-03-12 |
| 基线模型 | dashscope/qwen3.5-plus（primary），kimi/kimi-for-coding（fallback） |
| 模式 | full（引擎 + Dashboard + 8 Agent turns） |
| 耗时 | 1127s（~18.8 分钟） |
| 结果 | **123 PASS / 0 FAIL / 5 WARN / 128 TOTAL** |

## R3 目标

修复 R2 的 3 个框架可修复 WARN：
1. **V5.7**：改为 JSONL 管理消息检测（不依赖最终 violations 计数）
2. **S3.08**：移至 Step 5 立即验证（不延迟到 Phase 5）
3. **B4.15**：JSONL fallback（DB violations 被清理时检测 JSONL）

## R2→R3 核心改动

| 改动 | 目的 |
|------|------|
| V5.7 改用 session JSONL grep | 检测 `MANAGEMENT BLOCKED/REQUIRE_APPROVAL` 消息，不受 DB 清理影响 |
| B4.15 增加 JSONL fallback | 若 DB violations=0，回退到 JSONL 管理消息检测 |
| S3.08 移至 Phase 4 Step 5 | 审批处理后立即验证 decided 状态 |
| Turn 6 CB 重置增加 DB 清理 | 与 Turn 4 前置重置相同模式，防止 1h 窗口 re-trip |

### S3.08 仍为 WARN 的根因

R3 发现 S3.08 持续 WARN 的根本原因：**`/api/management/approvals` API 只返回 PENDING 记录**（设计如此 — 它是审批队列视图）。`decideApproval()` 成功将状态改为 APPROVED 后，GET endpoint 不再返回该记录。

修复已提交（R4）：S3.08 改为直接查询 SQLite `bps_management_approvals` 表中 `status IN ('APPROVED','REJECTED')` 的记录。

## R2→R3 对比

| 检查 | R2 | R3 | 变化 |
|------|-----|-----|------|
| V5.7 管理行使 | WARN (violations=0) | **PASS (JSONL=24)** | JSONL 检测生效 |
| B4.15 违规触发 | WARN (violations=0) | **PASS (violations=3)** | Turn 4 产生新违规 |
| S3.08 审批决策 | WARN (decided=0) | WARN (decided=0) | API 只返回 PENDING → R4 修复 |
| B4.06 实体 ≥3 | PASS (6) | WARN (0) | Turn 2 仅 2 行响应 |
| B4.07 创建关键词 | WARN | WARN | Turn 2 截断持续 |
| B4.09 新蓝图 | WARN | WARN | 复用已有蓝图 |
| B4.13 门店名称 | PASS | WARN | Turn 3 仅 2 行响应 |
| B4.17 审批ID | WARN | **PASS** | Turn 4 输出 6 个审批 ID |

**净改善**：R2 6W → R3 5W（-1），V5.7 修复成功

## HITL 审批闭环

R3 管理闭环显著增强：

```
Turn 3: Agent 创建 3 个 geo-content 实体 → 管理拦截
  ↓ (Turn 4 前清理 violations + reset CB)
Turn 4: Agent 尝试创建+更新 → REQUIRE_APPROVAL → 6 个 PENDING 审批
  ↓
Step 5: 程序化审批 → 6/6 全部 APPROVED
  ↓ (Turn 6 前清理 violations + reset CB)
Turn 6: Skill(daily-visibility-probe) + Agent(idlex-store-assistant) 创建成功
```

R2 → R3 改善：审批数 1→6，闭环更完整。

## Agent 产出指标

| 指标 | R1 | R2 | R3 |
|------|-----|-----|-----|
| 新增实体 | 8 | 15 | **3** |
| 新增 Skill | 4 | 4 | **2** |
| 新增 Blueprint | 1 | 0 | 0 |
| Agent workspace | 1 | 2 | **1** |
| 内容文件（write calls） | 3 | 3 | **5** |
| 管理审批 | 0 | 1 | **6** |
| 实体类型 | 3 种 | 4 种 | **4 种** |
| 总实体 | 20 | 35 | **38** |
| 总 Skill | 11 | 15 | **17** |
| 总 Agent workspace | 1 | 2 | **3** |

注：R3 新增实体少因 Turn 2/3 响应截断（仅 2 行），但 Turn 4 管理闭环更完整。

## Agent 响应质量

| Turn | 行数 | 关键表现 |
|------|------|---------|
| Turn 1 | 80 | 完整状态汇报 + 推进计划，识别种子数据 |
| Turn 2 | 2 | **严重截断** — 工具调用执行但文本响应极短 |
| Turn 3 | 2 | **严重截断** — 创建了 3 个实体但无文本描述 |
| Turn 4 | 36 | 完整管理交互，列出 6 个审批 ID + Dashboard 引导 |
| Turn 6 | 85 | Skill + Agent 创建报告，工作空间文件描述 |
| Turn 7 | 164 | **最佳** — 完整日报，数据驱动 |
| Turn 8 | 227 | **最佳** — 管理审计报告，5 约束 + 熔断器分析 |

## 5 WARN 分析

| WARN | 原因 | 类型 | 可修复性 |
|------|------|------|---------|
| B4.06 实体=0 | Turn 2 响应仅 2 行，实体创建延迟到 Turn 3 | LLM | 低 |
| B4.07 创建关键词 | Turn 2 响应截断，无文本描述 | LLM | 低 |
| B4.09 新蓝图=0 | Agent 复用已有蓝图 | LLM（合理行为） | 低 |
| B4.13 门店名称 | Turn 3 响应截断（2 行），未提及具体门店 | LLM | 低 |
| S3.08 决策=0 | API 只返回 PENDING → **R4 已修复**（直接查 SQLite） | 框架 | 已修复 |

5 WARN 中 4 个是 LLM 行为差异（Qwen3.5-plus 响应截断），1 个是框架问题（R4 已修复）。

## R1→R2→R3 进展

| 轮次 | PASS | FAIL | WARN | 框架 WARN | LLM WARN |
|------|------|------|------|----------|---------|
| R1 | 124 | 0 | 4 | 4 | 0 |
| R2 | 122 | 0 | 6 | 3 | 3 |
| R3 | 123 | 0 | 5 | 1 | 4 |
| R4 | 114 | 0 | 14 | 1 | 13 |
| R5 | 116 | 0 | 12 | 1 | 11 |

框架 WARN 从 4→3→1→1→1，框架自身问题已收敛。R4/R5 回退均由 LLM 问题导致。

## R4 追记（S3.08 SQLite 修复验证）

R4 部署了 S3.08 SQLite 直接查询修复（绕过只返回 PENDING 的 REST API），但由于 Qwen3.5-plus 在 Turn 4 严重截断（2 行，未执行 `bps_update_entity` 工具调用），HITL 审批路径未触发，S3.08 修复无法验证。

**R4 确认的框架改进**：
- V5.7 JSONL 检测持续有效（JSONL=24, DB=0 → PASS）
- B4.15 JSONL fallback 持续有效（JSONL=14, violations=0 → PASS）

**R4 暴露的 LLM 方差问题**：同一模型（Qwen3.5-plus）连续运行，Turn 2/4/6 产出质量波动剧烈（R3: 102/36/85 行 vs R4: 102/2/2 行）。

## R5 追记（kimi/kimi-for-coding 基线测试）

R5 切换到 kimi/kimi-for-coding 作为基线模型（116P/0F/12W）。

**关键发现**：kimi/kimi-for-coding 在 embedded 模式下返回 403 错误：
```
403 Kimi For Coding is currently only available for Coding Agents
such as Kimi CLI, Claude Code, Roo Code, Kilo Code, etc.
```

当 OpenClaw Gateway 超时（60s health check 失败）回退到 embedded 模式时，kimi 拒绝请求。这导致 Turn 4 HITL 路径再次无法触发。

**R5 Agent 行为**：
- Turn 1: 84 行（完整状态汇报）
- Turn 2: 31 行（创建 2 个实体 + 管理约束触发 CB DISCONNECTED）
- Turn 3: 27 行（CB DISCONNECTED 阻止写操作，请求人工恢复）
- Turn 4: 96 行（gateway→embedded fallback, kimi 403, 但 JSONL 有 24 条管理消息）
- Turn 6: 90 行（Skill + Agent 描述完整，但 0 个实际创建 — 工具调用未执行）
- Turn 7: 173 行（完整日报）
- Turn 8: 211 行（管理审计报告）

**结论**：kimi/kimi-for-coding 不适合此测试（embedded 模式 403）。dashscope/qwen3.5-plus 已恢复为基线模型。

## R1→R5 综合结论

| 维度 | 结论 |
|------|------|
| 框架稳定性 | 框架 WARN 4→1，S3.08（API 只返回 PENDING）是唯一残留框架问题 |
| 最佳成绩 | **R3: 123P/0F/5W**（qwen3.5-plus，1127s） |
| V5.7 修复 | JSONL 检测在 R3/R4/R5 三轮持续有效 |
| B4.15 修复 | JSONL fallback 在 R3 PASS（violations=3），R4/R5 PASS（JSONL fallback） |
| S3.08 修复 | SQLite 直接查询已部署，但因 LLM 方差未产生审批记录，无法验证 |
| LLM 方差 | Qwen3.5-plus 同一模型连续运行，Turn 响应长度波动 2→102 行，是主要不确定性来源 |
| 模型选择 | dashscope/qwen3.5-plus（primary），kimi/kimi-for-coding 仅作 fallback（embedded 403） |

## 下一步

- **长期**：Σ10 ADAPT 维度检查点设计
- **模型稳定性**：考虑增加 Turn 重试机制（响应 <5 行时自动重发）

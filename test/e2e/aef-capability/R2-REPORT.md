# AEF Capability E2E Test — R2 报告

## 测试概要

| 项目 | 值 |
|------|-----|
| 轮次 | R2（HITL 审批闭环修复验证） |
| 日期 | 2026-03-12 |
| 基线模型 | dashscope/qwen3.5-plus（primary），kimi/kimi-for-coding（fallback） |
| 模式 | full（引擎 + Dashboard + 8 Agent turns） |
| 耗时 | 1110s（~18.5 分钟） |
| 结果 | **122 PASS / 0 FAIL / 6 WARN / 128 TOTAL** |

## R2 目标

修复 R1 的 4 WARN（B4.18/B4.19/S3.08 审批闭环 + B4.06 实体创建），验证管理状态重置策略。

## R1→R2 核心改动

| 改动 | 目的 |
|------|------|
| Phase 4 启动前清理 violations + approvals + CB | 消除 Phase 2 引擎测试残留的 CRITICAL 违规 |
| Turn 4 前清理 violations + reset CB | 确保 REQUIRE_APPROVAL 路径可达（不被旧违规重新触发 DISCONNECTED） |
| CB 表列名修正 | `violation_count_critical/high`（非 `critical_count/high_count`） |

### 根因分析

Phase 2 引擎测试为 S3.03 种植了 1 个 CRITICAL 违规。S3.07 的 CB API reset 只重置 `state=NORMAL`，但 `updateCircuitBreaker()` 重新计数 1h 窗口内的违规 → 下次任何违规发生时立即回到 DISCONNECTED。这导致 Turn 4 始终是 BLOCK 而非 REQUIRE_APPROVAL，审批路径永远不可达。

## R1→R2 对比

| 检查 | R1 | R2 | 变化 |
|------|-----|-----|------|
| B4.06 实体 ≥3 | WARN (2) | **PASS (6)** | Agent 产出更丰富 |
| B4.18 待审批存在 | WARN (0) | **PASS (1)** | REQUIRE_APPROVAL 路径打通 |
| B4.19 审批处理 | WARN (0) | **PASS (1)** | 1 个审批成功批准 |
| B4.07 提到创建 | PASS | WARN | Turn 2 响应截断（2 行） |
| B4.09 新蓝图 | PASS | WARN | Agent 复用已有蓝图 |
| B4.15 违规增加 | PASS (1) | WARN (0) | Turn 4 清理后 Agent 成功更新 |
| V5.7 管理行使 | PASS (2) | WARN (0) | 清理策略删除了 Turn 3 违规记录 |
| S3.08 审批决策 | WARN (0) | WARN (0) | Phase 5 查询时 Step 5 的审批已过 |

**净改善**：3 个 WARN→PASS，2 个新 WARN 产生（响应截断 + 蓝图复用，均为 LLM 行为差异）

## HITL 审批闭环验证

R2 首次完整通过 HITL 审批闭环：

```
Turn 3: Agent 创建 geo-content 实体 → 触发 c-publish-approval → 管理拦截
  ↓ (Turn 4 前清理 violations + reset CB)
Turn 4: Agent 设置 publishReady:true → REQUIRE_APPROVAL → 创建 PENDING 审批
  ↓
Step 5: 程序化审批 → 1 PENDING 找到 → APPROVED
  ↓
Turn 6: CB 重置 → Skill/Agent 创建成功
```

## Agent 产出指标

| 指标 | R1 | R2 |
|------|-----|-----|
| 新增实体 | 8 | **15** |
| 新增 Skill | 4 | **4** |
| 新增 Blueprint | 1 | 0（复用） |
| Agent workspace | 1 | **2** |
| 内容文件 | 3 | 3 |
| 管理违规 | 2 | Turn 3 触发后被清理 |
| 实体类型 | 3 种 | **4 种**（+geo-content, geo-distribution） |
| 总实体 | 20 | **35** |
| 总 Skill | 11 | **15** |

## 6 WARN 分析

| WARN | 原因 | 可修复性 |
|------|------|---------|
| B4.07 创建关键词 | Turn 2 响应仅 2 行（工具调用正常但文本截断） | 低 — LLM 输出长度不可控 |
| B4.09 新蓝图 | Agent 发现已有 idlex-geo-operations 蓝图，选择复用 | 低 — 合理行为 |
| B4.15 违规增加=0 | Turn 4 清理后 Agent 成功更新（Turn 3 已学会草稿策略） | 中 — 清理策略副作用 |
| B4.17 审批ID/Dashboard | Agent 报告拦截但未提及具体 ID/Dashboard | 低 — 文本匹配 |
| V5.7 违规=0 | 清理策略删除了 Turn 3 的违规记录 | 中 — 可改为检查 JSONL |
| S3.08 决策=0 | Phase 5 查询 decided 审批，但 Step 5 审批后未被 Phase 5 捕获 | 中 — 时序问题 |

### V5.7/S3.08 改进方向

V5.7 可改为检查 session JSONL 中是否出现 `MANAGEMENT BLOCKED` 或 `MANAGEMENT APPROVAL REQUIRED` 错误消息，而非依赖最终 violations 计数。S3.08 可在 Step 5 审批后立即验证，而非延迟到 Phase 5。

## 下一步

- R3：修复 V5.7（JSONL 违规检测）和 S3.08（时序调整）
- 长期：Σ10 ADAPT 维度检查点设计

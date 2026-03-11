# Structural Capability E2E Test — R2 Report

## Summary

| 项目 | 值 |
|------|-----|
| 日期 | 2026-03-11 |
| 服务器 | root@47.236.109.62 |
| 模型 | moonshot/kimi-k2.5 |
| 模式 | full (Phase 0-5, 含 Phase 4 Agent turns) |
| 用时 | 70 秒 |
| Agent Turns | 3 |

## Final Result

```
70 PASS / 0 FAIL / 2 WARN / 72 TOTAL — ALL CHECKS PASSED ✓
```

| 维度 | Checks | 结果 |
|------|--------|------|
| D1: Governance Gating | 10 | 10 PASS |
| D2: Circuit Breaker | 6 | 6 PASS |
| D3: Information Summary | 6 | 6 PASS |
| D4: Process Groups | 4 | 4 PASS |
| D5: Entity Relations | 5 | 5 PASS |
| D6: Skill Metrics | 3 | 3 PASS |
| D7: Constraint Analytics | 3 | 3 PASS |
| D8: Tool Registration | 2 | 2 PASS |
| D9: Dashboard API | 11 | 10 PASS, 1 WARN |
| Install/Seed/Final | 14 | 14 PASS |
| Agent Turns (V4) | 8 | 7 PASS, 1 WARN |

### R1 → R2 增量

| 指标 | R1 | R2 | 增量 |
|------|----|----|------|
| Total Checks | 64 | 72 | +8 (Agent turns) |
| PASS | 63 | 70 | +7 |
| WARN | 1 | 2 | +1 (V4.2) |
| 用时 | 5s | 70s | +65s (Agent turns ~60s) |
| 模式 | engine-only | full | Phase 4 启用 |

## Agent Turn 分析 (Kimi K2.5)

### Turn 1: 工作全景

**提示**: "请汇总当前所有工作状态和实体清单"

**行为**:
- 调用 `bps_scan_work` — 获取任务状态全景
- 调用 `bps_query_entities` — 获取全部 9 个实体清单
- 输出 40 行结构化 Markdown（任务状态表 + 实体类型分组 + 行动计划 + 总结）

**评价**: 工具选择精准，输出格式规范。唯一不足是摘要中未使用 "total" 或 "summary" 关键词（导致 V4.2 WARN），但内容等效。

### Turn 2: 实体详情 + 治理状态

**提示**: "查看 store-cs-ktv-01 的详情，包括关系和治理状态"

**行为**:
- 调用 `bps_get_entity` (store-cs-ktv-01) — 获取实体详情含关系（references + depends_on）
- 调用 `bps_governance_status` — 获取治理全景（熔断器 + 约束 + 违规 + 效能分析）
- 输出 56 行（实体基本信息 + 关系表 + 熔断器状态 + 3 约束详情 + 3 违规记录 + 效能分析）

**评价**: 完整展示了 P2-b（实体关系）和 P3（约束效能分析）的 Agent 可消费性。注意到 `c-publish-approval` 约束的 3 次违规全部来自 analytics 测试种子数据。

### Turn 3: 治理拦截验证

**提示**: "更新实体 content/test-publish-check，设置 publishReady: true"

**行为**:
- 调用 `bps_update_entity` (content/test-publish-check, {publishReady: true})
- 治理层拦截：`c-publish-approval` 约束触发 REQUIRE_APPROVAL
- 输出 18 行（拦截详情表 + 审批 ID + Dashboard 引导 + 两阶段发布流程解释）

**评价**: **治理拦截端到端验证成功**。Kimi K2.5 正确理解了治理拦截语义，输出了审批 ID、触发约束、拦截原因，并指引用户前往 Dashboard 审批。

## WARN 分析

| ID | 描述 | 原因 | 严重度 |
|----|------|------|--------|
| S3.08 | approvals decide endpoint | 引擎创建的审批记录未通过 Dashboard API 暴露为 PENDING（引擎直接操作 GovernanceStore 与 Dashboard 进程独立） | LOW — R1 已知问题 |
| V4.2 | Turn 1 response mentions summary keywords | Kimi 输出"总结"而非 "total/summary"，检查脚本用 grep 匹配英文关键词 | LOW — 关键词匹配过窄 |

## 性能观察

- **Phase 2 引擎测试 39 checks**: < 1 秒（与 R1 一致）
- **Phase 3 Dashboard API 11 checks**: ~7 秒（含 Dashboard 重启等待 3s）
- **Phase 4 Agent turns 3 turns**: ~60 秒（3 次 OpenClaw agent 调用，Kimi K2.5 响应时间稳定）
- **全流程 70 秒**：Agent turns 占比 85%

## 模型评价 (Kimi K2.5)

| 维度 | 评分 | 说明 |
|------|------|------|
| 工具选择 | 10/10 | 3 turns 使用 4 个正确工具（scan_work, query_entities, get_entity, governance_status, update_entity） |
| 输出质量 | 9/10 | 结构化 Markdown，信息密度高，含约束效能分析等高级内容 |
| 治理理解 | 10/10 | 正确理解 REQUIRE_APPROVAL 语义，输出审批 ID + Dashboard 引导 |
| 中文能力 | 10/10 | 全中文输出，术语准确（"熔断器"、"约束"、"违规"） |

## R2 目标验证

### R2 目标：验证 Agent 工具调用 + 治理拦截

| # | 验证项 | 结果 |
|---|--------|------|
| 1 | Agent 可调用 scan_work 获取全景 | ✅ PASS |
| 2 | Agent 可调用 get_entity 查看关系 | ✅ PASS |
| 3 | Agent 可调用 governance_status 查看治理 | ✅ PASS |
| 4 | 写操作触发治理拦截 | ✅ PASS |
| 5 | Agent 正确理解治理拦截语义 | ✅ PASS |
| 6 | Agent 输出审批 ID + Dashboard 引导 | ✅ PASS |

**全部验证项通过**。R2 确认 Kimi K2.5 可以有效利用 P0-P3 新增的全部结构能力。

## 框架评估 (R1 → R2 更新)

| 维度 | R1 | R2 | 变化 |
|------|----|----|------|
| 确定性 | 10/10 | 9/10 | Agent turns 引入 LLM 不确定性（V4.2 关键词匹配） |
| 速度 | 10/10 | 8/10 | 70s vs 5s，Agent turns 是瓶颈 |
| 覆盖度 | 9/10 | 10/10 | +8 Agent 检查点，Phase 4 补全 |
| 隔离性 | 8/10 | 8/10 | 不变 |
| 可维护性 | 8/10 | 8/10 | 不变 |
| 部署感知 | 7/10 | 8/10 | R1 修复后 R2 零环境问题 |

## 文件清单

```
test/e2e/structural-capability/
├── R1-REPORT.md           ← R1 报告（engine-only）
├── R2-REPORT.md           ← 本报告（full mode）
├── report.txt             ← R2 脚本生成摘要
├── engine-results.json    ← R2 Phase 2 逐项结果
├── metrics.json           ← R2 最终指标快照
├── turn-1.log             ← Agent Turn 1 输出
├── turn-2.log             ← Agent Turn 2 输出
└── turn-3.log             ← Agent Turn 3 输出
```

## 下一步

- **V4.2 WARN 修复**：关键词匹配从英文 `total|summary` 扩展为中英文 `total|summary|总计|汇总|总结|概览`
- **S3.08 WARN**：考虑在 Phase 4 Agent turn 3 触发的审批记录作为 Dashboard API 测试数据源（Phase 4 在 Phase 3 之后，需调整顺序或在 Phase 3 后追加检查）
- **R3**：多模型对比（在 Phase 4 使用不同 LLM，对比工具调用差异）

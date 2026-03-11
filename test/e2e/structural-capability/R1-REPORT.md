# Structural Capability E2E Test — R1 Report

## Summary

| 项目 | 值 |
|------|-----|
| 日期 | 2026-03-11 |
| 服务器 | root@47.236.109.62 |
| 模型 | moonshot/kimi-k2.5 (未使用，engine-only 模式) |
| 模式 | engine-only (Phase 0-3 + 5, 跳过 Phase 4 Agent turns) |
| 用时 | 5 秒 (Phase 2 引擎测试 < 1s) |
| 迭代 | R1.0 → R1.1 → R1.2 → R1.3 (4 次执行) |

## Final Result (R1.3)

```
63 PASS / 0 FAIL / 1 WARN / 64 TOTAL — ALL CHECKS PASSED ✓
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

唯一 WARN: S3.08 (approvals decide) — 引擎测试中的 REQUIRE_APPROVAL 审批记录未通过 Dashboard API 暴露为 PENDING 状态（引擎直接操作 GovernanceStore 与 Dashboard 进程独立）。

## R1 目标：测试框架自身验证

### 发现的框架问题（已修复）

| # | 问题 | 发现于 | 根因 | 修复 |
|---|------|--------|------|------|
| 1 | `engine.processTracker` undefined | R1.0 | 属性名应为 `engine.tracker` | 修正引用 |
| 2 | `dossierStore.setRelations` not a function | R1.0 | 服务器代码停在旧版本 `a915c5f`，`git pull` 被 untracked files 阻止 | 清理冲突文件 + git pull + 重编译 |
| 3 | SQLite `no such column: group_id` | R1.0 | 旧 DB 缺少 P2-a 新增列 | 清理旧 DB |
| 4 | SQLite `disk I/O error` | R1.0 | 删除 bps.db 但残留 -shm/-wal 文件导致 corruption | 完整清理 bps.db* |
| 5 | D1/D2 熔断器测试连锁失败 (9 FAIL) | R1.0 | `resetCircuitBreaker()` 不清除违规记录，各测试共享污染的违规历史 | 新增 `resetGovernance()` 函数：DELETE violations + approvals + reset CB |
| 6 | `resetGovernance()` 无限递归 | R1.1 | `replace_all` 也替换了函数体内的 `govStore.resetCircuitBreaker()` | 恢复函数体内的原始调用 |
| 7 | S2.33 + S3.03 失败 (0 violations) | R1.2 | `resetGovernance()` 清掉了 D7 需要的违规数据 | D7 前补种 3 条测试违规 |

### 发现的代码 bug（已修复）

| # | 问题 | 影响 | 修复 |
|---|------|------|------|
| 1 | `bps_query_tasks` 返回结果缺少 `groupId/priority/deadline` 字段 | Agent 无法通过 query 获取任务分组信息 | `src/integration/tools.ts` 添加字段 |
| 2 | Dashboard `/api/governance/status` 缺少 `constraintEffectiveness` 和 `circuitBreakerState` | Dashboard 无法展示约束效能分析 | `dashboard/server/routes.ts` 添加字段 |

### 发现的计划-实现不一致（已修复，评审阶段）

| # | 问题 | 修复 |
|---|------|------|
| 1 | 覆盖矩阵声称 55 checks，实际 ~47 | 重新计数，更新为 50（含新增 D8/D9） |
| 2 | S2.30 断言偏离目标 | 改用组合逻辑（getDormantSkillNames + getSummaries） |
| 3 | S2.17 排序测试太弱 | 改用 loop 验证 deadline ASC + nulls last |
| 4 | S2.33 计划描述与脚本不一致 | 统一为"reflects actual violation counts" |
| 5 | S3.08 计划描述与脚本不一致 | 新增 approvals decide 测试，页面检查改为 S3.09 |
| 6 | `warn_()` 不计入 TOTAL | 添加 `TOTAL++` |
| 7 | `--phase` 缺值保护 | 添加数字验证 |

## 性能观察

- **Phase 2 引擎测试 39 checks < 1 秒**：TypeScript 直接导入引擎，无进程开销
- **全流程 5 秒**（含种子数据 + Dashboard 重启等待 3s）
- **可重复性**：在 R1.3 确认的修复下，3 次连续 clean run 均 ALL PASS

## 框架评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 确定性 | 10/10 | 0 LLM 依赖，纯引擎 API 测试 |
| 速度 | 10/10 | 5 秒完成 64 checks |
| 覆盖度 | 9/10 | P0-P3 全 9 维度，50 结构检查点 |
| 隔离性 | 8/10 | `resetGovernance()` 解决了违规累积，S3.08 WARN 待优化 |
| 可维护性 | 8/10 | 单脚本，HEREDOC 内 TypeScript，但嵌入式代码调试困难 |
| 部署感知 | 7/10 | 强依赖服务器代码版本同步，首次运行暴露 4 个环境问题 |

## 文件清单

```
test/e2e/structural-capability/
├── R1-REPORT.md           ← 本报告
├── report.txt             ← 脚本生成的摘要
├── engine-results.json    ← Phase 2 逐项结果
└── metrics.json           ← 最终指标快照
```

## 下一步

- **R2**：运行 full 模式（含 Phase 4 Agent turns），验证 kimi-k2.5 工具调用
- 考虑将 Phase 0 增加 `git pull + tsc` 步骤，避免代码版本不同步问题
- S3.08 WARN：考虑在 Phase 2 引擎测试中保留至少一条 PENDING 审批到 Phase 3

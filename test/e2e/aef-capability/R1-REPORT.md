# AEF 能力补充测试 R1 报告

## 测试概要

| 项目 | 值 |
|------|-----|
| 轮次 | R1（首轮基线） |
| 日期 | 2026-03-12 |
| 基线模型 | dashscope/qwen3.5-plus（primary），kimi/kimi-for-coding（fallback） |
| 模式 | engine-only（in-memory DB，无 Agent turns） |
| 耗时 | ~3 秒 |
| 结果 | **30 PASS / 0 FAIL / 0 WARN / 30 TOTAL** |

## R1 目标

首轮运行，确认 AEF 补充测试全部通过，建立基线。

## 按维度结果

| 维度 | 检查数 | PASS | FAIL | WARN | 健康度 |
|------|--------|------|------|------|--------|
| Σ1 PROC | 6 | 6 | 0 | 0 | 1.00 HEALTHY |
| Σ7 SCHED | 5 | 5 | 0 | 0 | 1.00 HEALTHY |
| Σ9 HIER | 3 | 3 | 0 | 0 | 1.00 HEALTHY |
| ΣX Cross | 6 | 6 | 0 | 0 | 1.00 HEALTHY |
| Σ11 MATCH | 10 | 10 | 0 | 0 | 1.00 HEALTHY |
| **总计** | **30** | **30** | **0** | **0** | **1.00** |

## Σ11 MATCH 三层详情

### A 层：结构前提 (4/4 PASS)

| 检查 | 结果 | 说明 |
|------|------|------|
| E11.01 effectiveness API 产生建议 | PASS | 92% 审批通过率触发"考虑放宽"建议 |
| E11.02 管理覆盖多种工具类型 | PASS | GATED_WRITE_TOOLS 含 bps_update_entity + bps_load_blueprint + bps_register_agent |
| E11.03 细粒度 scope 可用 | PASS | aef-hier-publish 约束使用 dataFields=['publishReady'] |
| E11.04 scan_work 信息充分 | PASS | summary + outcomeDistribution + overdueTasks 三项均有值 |

### B 层：过度制约抵抗 (3/3 PASS)

| 检查 | 结果 | 说明 |
|------|------|------|
| E11.05 entityType 精确匹配 | PASS | 'content' 约束不拦截 'store' 实体操作 → verdict=PASS |
| E11.06 dataFields 精确匹配 | PASS | 'publishReady' 约束不拦截 'name' 字段更新 → verdict=PASS |
| E11.07 undefined variable → PASS | PASS | 约束引用的字段不在操作数据中时正确跳过 |

### C 层：支持不足检测 (3/3 PASS)

| 检查 | 结果 | 说明 |
|------|------|------|
| E11.08 批量 API 存在 | PASS | bps_batch_update 工具已注册 |
| E11.09 BLOCK 含结构化信息 | PASS | constraintId='aef-hier-archive' + severity='CRITICAL' + message 非空 |
| E11.10 brief 模式节省上下文 | PASS | brief JSON payload < full JSON payload |

## 调试修复记录

R1 开发过程中修复了 3 个 bug（在首次 green 前解决）：

| Bug | 根因 | 修复 |
|-----|------|------|
| EX.01-02 FAIL | 约束 `condition` 语义反写（应为 PASS 条件，非违规条件） | `lifecycle == "ARCHIVED"` → `lifecycle != "ARCHIVED"`, `publishReady == true` → `publishReady != true` |
| EX.03 FAIL | EX.01 的 CRITICAL 违规残留在 DB，EX.03 首次 HIGH 违规后 CB 立即 DISCONNECTED | EX.03 前 `DELETE FROM bps_management_violations` 清除残留 |
| E11.10 crash | `engine.dossierStore.upsert()` 不存在 | 改用 `bps_update_entity` tool 创建测试实体 |

## 与 structural-capability 的关系

| 维度 | structural-capability 覆盖 | aef-capability 补充 |
|------|---------------------------|-------------------|
| Σ1 PROC | S2.05-S2.12 (状态转移基础) | 5-state 完整遍历 + outcome 持久化 |
| Σ7 SCHED | S2.09-S2.12 (排序基础) | overdueTasks + deadline 检测 + 跨字段排序 |
| Σ9 HIER | B4 二层路由 (Agent 行为) | 程序化约束 scope 校验 |
| ΣX Cross | 无 | 6 条跨维度链路 |
| Σ11 MATCH | 无 | 10 项能力匹配度检查 |

两套测试互补：structural-capability 验证 Agent 行为层（需远程部署 + LLM），aef-capability 验证引擎机制层（本地 in-memory，无 LLM）。

## 下一步

- R2 预期变更：引擎代码修改后回归验证
- 未来扩展：可增加 Agent turn phase（使用 BASELINE_MODEL=dashscope/qwen3.5-plus）验证 Σ11 的运行时行为（如管理绕过率、工具调用效率比）

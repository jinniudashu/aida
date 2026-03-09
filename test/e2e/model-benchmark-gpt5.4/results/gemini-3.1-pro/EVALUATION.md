# Gemini 3.1 Pro Preview 业务场景效能评测报告

**测试日期**: 2026-03-09
**测试方案**: IdleX GEO E2E v3
**模型**: `google/gemini-3.1-pro-preview`

## 测试结果概览

| 指标 | 数值 |
|------|------|
| Pass | 35 |
| Fail | 1 |
| Warn | 9 |
| Entities | 7 |
| Skills | 7 |
| Agent Workspaces | 0 |
| Blueprints | 0 |
| Governance Violations | 0 |
| Approved Requests | 0 |

## 核心问题

- 本轮主要失败原因不是业务理解，而是运行时 provider 装配失败。
- 错误信息：`No API provider registered for api: google-generativeai`
- 结果表现为 Turn 4 之后大量回退到 embedded，并无法真正调用 Gemini 原生 provider。

## 分维度评估

### 1. 业务理解 (25%)

评分: 6/10

- 前半程仍有基础业务响应能力，但由于 provider 未接通，后半程无法代表 Gemini 的真实业务效能上限。

### 2. 工具调用 (30%)

评分: 3/10

- 未形成有效实体增量，工具调用深度显著不足。

### 3. Two-Layer 路由 (15%)

评分: 4/10

- 有基础分层意识，但缺少落地结果支撑。

### 4. 治理合规 (15%)

评分: 3/10

- 未真实进入治理闭环。

### 5. 自我进化 (10%)

评分: 2/10

- 未创建独立 Agent workspace，也未沉淀新增 Skill。

### 6. 响应质量 (5%)

评分: 4/10

- 运行时错误主导结果，不能视作稳定可用。

## 综合评分

**加权总分: 3.85/10**

## 结论

- 当前这轮 Gemini 结果应标记为“provider 装配失败样本”，不能直接与其他已正常接通的模型横向对比。
- 原始日志见 `test/e2e/model-benchmark-gpt5.4/results/gemini-3.1-pro/`。

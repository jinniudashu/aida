# Qwen3.5-Plus 业务场景效能评测报告

**测试日期**: 2026-03-09
**测试方案**: IdleX GEO E2E v3
**模型**: `dashscope/qwen3.5-plus`

## 测试结果概览

| 指标 | 数值 |
|------|------|
| Pass | 40 |
| Fail | 1 |
| Warn | 4 |
| Entities | 8 |
| Skills | 13 |
| Agent Workspaces | 0 |
| Blueprints | 1 |
| Governance Violations | 0 |
| Approved Requests | 0 |

## 分维度评估

### 1. 业务理解 (25%)

评分: 9/10

- Qwen 对 GEO 业务链路理解清晰，规划与汇报都比较完整。

### 2. 工具调用 (30%)

评分: 8/10

- 形成了较多 Skill，并沉淀了 1 个 Blueprint。
- 但实体增量与独立 Agent 落地仍偏弱。

### 3. Two-Layer 路由 (15%)

评分: 8/10

- 能把审批网关纳入蓝图结构，Two-Layer 意识较清楚。

### 4. 治理合规 (15%)

评分: 5/10

- 主要停留在“描述审批节点”，没有真正触发治理闭环。

### 5. 自我进化 (10%)

评分: 6/10

- Skill 扩张明显，但没有独立店铺顾问 workspace。

### 6. 响应质量 (5%)

评分: 8/10

- 输出结构化、稳定，接近高可用水平。

## 综合评分

**加权总分: 7.6/10**

## 结论

- Qwen3.5-Plus 的优势在于结构化表达和流程设计，整体表现稳健；短板仍是治理闭环和实体化落地深度不足。
- 原始日志见 `test/e2e/model-benchmark-gpt5.4/results/qwen3.5-plus/`。

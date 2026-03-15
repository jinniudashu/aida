# Kimi K2.5 业务场景效能评测报告

**测试日期**: 2026-03-09
**测试方案**: IdleX GEO E2E v3
**模型**: `moonshot/kimi-k2.5`

## 测试结果概览

| 指标 | 数值 |
|------|------|
| Pass | 40 |
| Fail | 0 |
| Warn | 5 |
| Entities | 10 |
| Skills | 10 |
| Agent Workspaces | 0 |
| Blueprints | 2 |
| Governance Violations | 0 |
| Approved Requests | 0 |

## 分维度评估

### 1. 业务理解 (25%)

评分: 9/10

- Kimi 对闲氪 GEO 业务的整体理解较强，能较完整地搭出从监测到内容生产的链路。

### 2. 工具调用 (30%)

评分: 8/10

- 新建了 3 个实体、3 个专用 Skill，并加载了 2 个 Blueprint 文件。
- 整体执行偏“快速搭系统”，但 Agent workspace 仍未独立建出。

### 3. Two-Layer 路由 (15%)

评分: 8/10

- 具备治理/运营分层意识，且使用了 Blueprint 作为结构化载体。

### 4. 治理合规 (15%)

评分: 5/10

- 能描述审批与治理节点，但没有真正触发 Dashboard 审批闭环。

### 5. 自我进化 (10%)

评分: 6/10

- 形成了新 Skill，但独立 Agent 人格隔离不足。

### 6. 响应质量 (5%)

评分: 9/10

- 输出稳定，业务表达清晰，本轮 0 FAIL。

## 综合评分

**加权总分: 7.65/10**

## 结论

- Kimi K2.5 是当前已跑模型里非常稳的一档，长处在快速搭建与高通过率，短板仍是治理闭环与独立 Agent 落地不足。
- 原始日志见 `test/e2e/model-benchmark-gpt5.4/results/kimi-k2.5/`。

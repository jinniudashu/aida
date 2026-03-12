# AIDA 多模型基准测试 R7 报告

> **轮次**: R7（框架加固 + 首轮完整数据采集）
> **日期**: 2026-03-11
> **测试脚本**: `test/e2e/idlex-geo-v3.sh`（BENCHMARK_MODE=1）
> **评分标准**: `test/e2e/benchmark/scoring-rubric.md`（6 维度加权）

---

## 摘要

R7 是修复 R6 数据采集管线后的首轮**全数据采集**基准测试。6/6 模型完成安装和 E2E 测试，metrics.json + behavior.json + session JSONL 全部成功采集。

### 排名

| 排名 | 模型 | 加权总分 | E2E 测试 | BPS 调用 | 关键特征 |
|------|------|----------|----------|----------|----------|
| 1 | **GPT-5.4** | **8.55/10** | 46P/0F/2W | 48 | 最佳 E2E + 管理 RESTRICTED |
| 2 | **Claude Opus 4.6** | **8.50/10** | 38P/1F/8W | 105 | 最多工具调用(164) + 53 实体 |
| 3 | **Kimi K2.5** | **6.50/10** | 40P/0F/8W | 44 | 最多管理触发(23) |
| 4 | **Gemini 3.1 Pro** | **5.90/10** | 44P/1F/3W | 10 | 最多发布文件(15) |
| 5 | **Qwen3.5-Plus** | **5.45/10** | 39P/1F/7W | 3 | 最清晰二层路由 + 3 Cron |
| 6 | **GLM-5** | **1.30/10** | 35P/1F/11W | 2 | 无法恢复 Continue 提示 |

---

## R6 → R7 框架改进

### 数据采集管线修复

| 问题 | R6 状态 | R7 修复 | 验证 |
|------|---------|---------|------|
| `collect-metrics.sh` 崩溃 | 5/6 模型无 metrics | 移除 `set -e`，段级容错 | ✅ 6/6 采集成功 |
| "Argument list too long" | GPT 47 实体溢出 | JSON 写 temp 文件，node 读文件 | ✅ Claude 53 实体正常 |
| Session JSONL 未下载 | 仅 2/6 有 behavior | JSONL 提前到 Step 4/7 | ✅ 6/6 下载成功 |
| Turn log 来自前次运行 | raw/ 混入旧数据 | Step 6/7 前清理 raw/ | ✅ 数据干净 |
| Agent config 污染 | R7 新增 | 清理步骤 trim agents.list | ✅ 首次失败后修复 |

### 新增 R7 修复：Agent Config 污染

Kimi/Qwen 等模型通过 `agent-create` Skill 在 `openclaw.json` 的 `agents.list` 中注册新 Agent，其中部分配置（如 `tools.profile`）含非法值。此配置跨模型运行持久化，导致后续模型安装失败。

**修复**: `run-single-model.sh` 清理步骤新增 `agents.list` 重置（保留第一个条目，移除后续条目）。

---

## 详细评估

### 1. GPT-5.4 — 8.55/10 ★

**E2E: 46 PASS / 0 FAIL / 2 WARN** — 最佳 E2E 成绩

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 9 | 0.20 | 1.80 |
| 工具调用 | 9 | 0.25 | 2.25 |
| 二层路由 | 9 | 0.15 | 1.35 |
| 管理闭环 | 8 | 0.15 | 1.20 |
| 自进化 | 7 | 0.15 | 1.05 |
| 响应质量 | 9 | 0.10 | 0.90 |

**亮点**:
- **46P/0F/2W**: R7 最佳 E2E，零失败
- **管理 RESTRICTED**: 5 violations → 熔断器进入 RESTRICTED 状态（唯一）
- 45 实体（38 新），含 15 geo-strategy + 15 geo-observation 覆盖全部门店×平台
- Turn 1 输出 17KB 文本（最详细的业务分析）
- 1 Blueprint + 1 Agent workspace (xiaoxian-network) + 1 Skill (geo-ops) + 2 Cron

**不足**:
- 0 审批完成（violations 触发但未进入审批循环）
- 新 Skill 仅 1 个（低于 Claude 的 4 个）

---

### 2. Claude Opus 4.6 — 8.50/10

**E2E: 38 PASS / 1 FAIL / 8 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 9 | 0.20 | 1.80 |
| 工具调用 | 10 | 0.25 | 2.50 |
| 二层路由 | 9 | 0.15 | 1.35 |
| 管理闭环 | 4 | 0.15 | 0.60 |
| 自进化 | 9 | 0.15 | 1.35 |
| 响应质量 | 9 | 0.10 | 0.90 |

**亮点**:
- **164 工具调用（105 BPS）**: 所有模型中最高，单个 Turn 4 达 94 次调用
- **53 实体**: 最多实体创建（5 store × 3 platform × 3 type = 45 结构化）
- **9 种 BPS 工具**: 使用了最广泛的 BPS 工具组合
- 4 新 Skill（geo-monitor/content/report/analyze）、1 Agent workspace (store-concierge)、1 Blueprint、2 Cron
- 15 draft 内容文件（对应 5 store × 3 platform）

**不足**:
- **0 管理触发**: 尽管创建了 governance.yaml（写了 3 次迭代），0 violations — 约束未匹配实体更新模式
- E2E 38P/1F/8W 偏低（因 WARN 较多）

---

### 3. Kimi K2.5 — 6.50/10

**E2E: 40 PASS / 0 FAIL / 8 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 7 | 0.20 | 1.40 |
| 工具调用 | 7 | 0.25 | 1.75 |
| 二层路由 | 6 | 0.15 | 0.90 |
| 管理闭环 | 6 | 0.15 | 0.90 |
| 自进化 | 7 | 0.15 | 1.05 |
| 响应质量 | 5 | 0.10 | 0.50 |

**亮点**:
- **23 violations**: 所有模型中最多管理触发，证明深度管理交互
- **7 种 BPS 工具**: 广泛使用（query_entities, load_governance, update_entity, governance_status, load_blueprint, list_services, create_task）
- Turn 2 单回合 58 次工具调用（37 BPS），含 12 次 bps_load_governance 迭代
- 1 new Skill (geo-operator) + 1 Agent workspace + 2 Cron + 多个 workspace 文件

**不足**:
- 管理配置不稳定: 12 次 bps_load_governance 调用但最终 0 constraints — governance 被反复重写
- 0 内容产出（无 mock-publish 文件）
- 仅 2 新实体（geo-config + geo-visibility）

---

### 4. Gemini 3.1 Pro — 5.90/10

**E2E: 44 PASS / 1 FAIL / 3 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 7 | 0.20 | 1.40 |
| 工具调用 | 5 | 0.25 | 1.25 |
| 二层路由 | 5 | 0.15 | 0.75 |
| 管理闭环 | 7 | 0.15 | 1.05 |
| 自进化 | 5 | 0.15 | 0.75 |
| 响应质量 | 7 | 0.10 | 0.70 |

**亮点**:
- **15 mock-publish 发布文件**: 最多已发布内容（直接写入 mock-publish/）
- **4 violations + WARNING 状态**: 管理触发有效
- 44P/1F/3W: 良好的 E2E 成绩
- 1 Skill (geo-daily-ops) + 2 Cron + 4 geo-content 实体

**不足**:
- **0 Blueprint**: 未创建蓝图
- **0 Agent workspace**: 未创建独立 Agent
- 仅 31 总工具调用（10 BPS），密度偏低
- 内容通过文件 I/O 直接发布，绕过了管理层的审批流程

---

### 5. Qwen3.5-Plus — 5.45/10

**E2E: 39 PASS / 1 FAIL / 7 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 8 | 0.20 | 1.60 |
| 工具调用 | 4 | 0.25 | 1.00 |
| 二层路由 | 8 | 0.15 | 1.20 |
| 管理闭环 | 1 | 0.15 | 0.15 |
| 自进化 | 6 | 0.15 | 0.90 |
| 响应质量 | 6 | 0.10 | 0.60 |

**亮点**:
- **最清晰的二层路由**: 明确区分 "Governance层（审批规则 → Blueprint建模）" vs "Operations层（日常运营 → Entity+Skill）"
- **3 Cron 任务**: 最多（每日 9:00 监测/22:00 小结/周一 10:00 复盘）
- 单回合创建 Blueprint + Skill + Agent + Cron + Action Plan（效率最高）
- 1 Blueprint (xiange-geo-governance) + 1 Agent (store-bot，人格隔离) + 1 Skill

**不足**:
- **Config 自毁**: agent-create 写入非法 `tools.profile` 导致 openclaw.json 损坏，Turn 2-6 全部瘫痪
- 仅 24 总工具调用（3 BPS），因 5/6 turn 无法执行
- 0 violations, 0 内容产出

**R5 对比**: R5 得分 7.75（历史最高），R7 降至 5.45。差异完全归因于 Config 自毁 — 单次运行方差极大。

---

### 6. GLM-5 — 1.30/10

**E2E: 35 PASS / 1 FAIL / 11 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 2 | 0.20 | 0.40 |
| 工具调用 | 1 | 0.25 | 0.25 |
| 二层路由 | 1 | 0.15 | 0.15 |
| 管理闭环 | 1 | 0.15 | 0.15 |
| 自进化 | 1 | 0.15 | 0.15 |
| 响应质量 | 2 | 0.10 | 0.20 |

**问题**:
- **从未收到业务提示**: 初始 Turn 超时，12 个 Turn 全部为 "Continue where you left off" 恢复提示
- 正确诊断"无工作可继续"（"没有发现之前中断或失败的任务"），但无法主动执行
- 仅 2 BPS 调用（bps_scan_work, bps_query_tasks），均为只读查询
- 0 新实体、0 新 Skill、0 Blueprint、0 Agent、0 Cron、0 内容、0 管理触发
- **R4 对比**: R4 得分 4.15（部分工作完成），R7 降至 1.30 — GLM 对 "Continue" 提示缺乏恢复能力

---

## 关键发现

### 1. GPT-5.4 取代 Kimi K2.5 成为最佳 AIDA 运营模型

R6 中 Kimi K2.5 以 8.70 排名第一，R7 中 GPT-5.4（8.55）超越 Kimi（6.50）。关键差异:
- GPT 在全部 6 个有效 Turn 中均产出工具调用，且管理交互深入到 RESTRICTED 状态
- Kimi 管理触发数量最高（23）但管理配置不稳定（最终 0 constraints），执行质量下降

### 2. Claude Opus 4.6 是工具调用之王

| 模型 | 总调用 | BPS 调用 | BPS 工具种类 | 实体数 |
|------|--------|----------|-------------|--------|
| **Claude Opus 4.6** | **164** | **105** | **9** | **53** |
| GPT-5.4 | 84 | 48 | 4 | 45 |
| Kimi K2.5 | 88 | 44 | 7 | 9 |
| Gemini 3.1 Pro | 31 | 10 | 5 | 12 |
| Qwen3.5-Plus | 24 | 3 | 3 | 8 |
| GLM-5 | 14 | 2 | 2 | 7 |

Claude 的 164 次调用是第二名 Kimi 的 1.9 倍。单个 Turn 4 达 94 次调用（65 BPS）。但高调用量未转化为管理触发（0 violations），说明**工具调用量 ≠ 管理合规度**。

### 3. 管理闭环是关键分化维度

| 模型 | Violations | 熔断器状态 | Constraints | 管理闭环 |
|------|------------|-----------|-------------|----------|
| **Kimi K2.5** | **23** | NORMAL (恢复) | 0 (不稳定) | 部分 |
| GPT-5.4 | 5 | **RESTRICTED** | 3 | ✅ 有效 |
| Gemini 3.1 Pro | 4 | WARNING | 3 | ⚠️ 绕过发布 |
| Claude Opus | 0 | NORMAL | 3 | ❌ 未触发 |
| Qwen3.5+ | 0 | NORMAL | 3 | ❌ Config 自毁 |
| GLM-5 | 0 | NORMAL | 3 | ❌ 无交互 |

GPT-5.4 是唯一在 **3 constraints 活跃 + 5 violations + RESTRICTED 状态** 下保持稳定执行的模型。

### 4. Config 自毁是 agent-create 的致命陷阱

Qwen 和此前的 Kimi 通过 `agent-create` Skill 创建新 Agent 时，写入了非法的 `tools.profile` 配置值。OpenClaw 在后续 Turn 加载时检测到非法配置并拒绝执行，导致该模型剩余所有 Turn 瘫痪。

**影响**: Qwen R5 得分 7.75 → R7 仅 5.45，差异完全归因于此问题。

**建议**: `agent-create` Skill 应添加 `tools.profile` 值白名单校验（minimal/coding/messaging/full）。

### 5. GLM-5 缺乏 "Continue" 恢复能力

GLM-5 在 R4（4.15）和 R7（1.30）中均表现最差。R7 中初始提示超时后，GLM 收到 12 次 "Continue where you left off" 但始终无法理解这是 retry 信号。其他模型（如 Qwen、GPT）能从 "Continue" 提示中恢复执行。

---

## R6 → R7 对比

| 模型 | R6 分数 | R7 分数 | 变化 | 备注 |
|------|---------|---------|------|------|
| GPT-5.4 | 7.85 | **8.55** | +0.70 | 管理 RESTRICTED，稳定提升 |
| Claude Opus | 7.55 | **8.50** | +0.95 | 工具量爆发（164 次） |
| Kimi K2.5 | **8.70** | 6.50 | −2.20 | 管理配置不稳定 |
| Gemini 3.1 Pro | 8.30 | 5.90 | −2.40 | 工具密度下降 |
| Qwen3.5+ | 7.55 | 5.45 | −2.10 | Config 自毁 |
| GLM-5 | 1.10 | 1.30 | +0.20 | 依然最差 |

**注意**: R6 的评分基于部分数据（5/6 模型无 metrics/behavior），R7 首次基于完整数据。分数变化同时反映了**评分精度提升**和**模型实际表现差异**。

---

## 数据采集完整性对比

| 数据项 | R6 | R7 |
|--------|----|----|
| metrics.json | 1/6 ✅ | **6/6** ✅ |
| behavior.json | 2/6 ✅ | **6/6** ✅ |
| session.jsonl | 2/6 ✅ | **6/6** ✅ |
| e2e-test.log | 6/6 ✅ | 6/6 ✅ |
| turn logs | 6/6 ✅ | 6/6 ✅ |
| snapshots | 6/6 ✅ | 6/6 ✅ |

R7 是首轮 **100% 数据采集完整** 的基准测试。

---

## 推荐生产配置

基于 R7 完整数据评估:

```
Primary:  openrouter/openai/gpt-5.4           (8.55, 最佳 E2E + 管理 RESTRICTED)
Fallback: openrouter/anthropic/claude-opus-4.6 (8.50, 最强工具调用 + 最多实体)
Alt:      moonshot/kimi-k2.5                   (6.50, 管理触发最活跃)
```

---

## 待修复问题（R8）

| 优先级 | 问题 | 影响 | 建议 |
|--------|------|------|------|
| P0 | `agent-create` 写入非法 tools.profile | Qwen R7 损失 2.30 分 | Skill 内添加值白名单校验 |
| P1 | GLM-5 "Continue" 恢复能力 | 连续两轮最差 | 考虑在 AGENTS.md 添加 retry 行为指导 |
| P1 | governance.yaml 被模型反复重写 | Kimi 23 violations 但 0 constraints | 考虑只读种子 + 增量约束 |
| P2 | 管理绕过（文件 I/O 直接发布） | Gemini 15 文件绕过审批 | 强化 mock-publish 路径拦截 |

---

*报告生成: 2026-03-11, R7 基准测试*
*评分方法: scoring-rubric.md 6 维度加权 (业务理解 0.20, 工具调用 0.25, 二层路由 0.15, 管理闭环 0.15, 自进化 0.15, 响应质量 0.10)*
*数据完整性: 6/6 模型 metrics + behavior + session JSONL 全部采集成功*

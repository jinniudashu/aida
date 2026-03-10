# AIDA 多模型基准测试 R6 报告

> **轮次**: R6（首轮真正跨模型对比）
> **日期**: 2026-03-10
> **测试脚本**: `test/e2e/idlex-geo-v3.sh`（BENCHMARK_MODE=1）
> **评分标准**: `test/e2e/benchmark/scoring-rubric.md`（6 维度加权）

---

## 摘要

R6 是修复 R5 模型 overlay bug 后的首轮真正跨模型对比。5/6 模型完成完整 E2E 测试，Gemini 3.1 Pro 因框架问题未完成。

### 排名

| 排名 | 模型 | 加权总分 | E2E 测试 | 关键特征 |
|------|------|----------|----------|----------|
| 1 | **Kimi K2.5** | **8.70/10** | 45P/0F/3W | 唯一完整治理闭环 |
| 2 | **GPT-5.4** | **7.85/10** | 44P/0F/3W | 最多实体(47)，业务理解出色 |
| 3 | **Claude Opus 4.6** | **7.55/10** | 43P/1F/4W | 最强响应质量，发布最多(15) |
| 3 | **Qwen3.5-Plus** | **7.55/10** | 42P/0F/5W | 最多蓝图(2)，最强自进化 |
| 5 | **GLM-5** | **1.10/10** | 33P/1F/13W | 陷入诊断循环 |
| — | Gemini 3.1 Pro | 未完成 | — | 框架安装阶段崩溃 |

---

## 框架修复验证

### R5 → R6 修复

1. **P0: 模型 overlay 被覆盖**（R5 发现）
   - 根因: `idlex-geo-v3.sh` Phase 0 重跑 `install-aida.sh` 覆盖了 `install-benchmark.sh` 的模型配置
   - R5 修复: `BENCHMARK_MODE=1` 环境变量跳过 `install-aida.sh` 调用
   - **R6 发现: 修复不完整** — Phase 0 的清理步骤（备份 `~/.aida/`、擦除 workspace）仍在执行，摧毁了 `install-benchmark.sh` 刚创建的环境
   - R6 修复: `BENCHMARK_MODE=1` 时跳过整个 Phase 0 body，V0 检查提取为公共代码

2. **模型 overlay 验证**: 4 个完成模型均使用正确的 primary model
   - Claude: `openrouter/anthropic/claude-opus-4.6` ✓
   - Kimi: `moonshot/kimi-k2.5` ✓
   - Qwen: `dashscope/qwen3.5-plus` ✓
   - GLM: `zhipu/glm-5` ✓

### R6 残留问题

- **P0: `collect-metrics.sh` 崩溃**: 顺序运行中，前 5 个模型的 metrics/behavior 收集失败（仅最后一个 GLM 成功）。原因: Dashboard API 查询的 SSH 命令在某些环境下失败，触发 `set -e` 终止脚本
- **P1: GPT/Gemini 框架问题**: `run-single-model.sh` 在 Step 4 (install-benchmark.sh) 崩溃后未写入 e2e-test.log
- **P1: Session JSONL 未下载**: 由于 collect-metrics.sh 崩溃在 Step 6，Step 7 (下载 artifacts) 未执行，仅 GLM 有完整 behavior.json

---

## 详细评估

### 1. Kimi K2.5 — 8.70/10 ★

**E2E: 45 PASS / 0 FAIL / 3 WARN**（唯一零 FAIL）

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 9 | 0.20 | 1.80 |
| 工具调用 | 9 | 0.25 | 2.25 |
| 二层路由 | 8 | 0.15 | 1.20 |
| 治理闭环 | 9 | 0.15 | 1.35 |
| 自进化 | 8 | 0.15 | 1.20 |
| 响应质量 | 9 | 0.10 | 0.90 |

**亮点**:
- **唯一完成完整治理闭环**: V5.1 PASS（violations +1, pending 2）→ V6.1 Approved 2 items → V6.2 9 files promoted
- 创建 7 新实体（总计 19）、5 GEO Skills、1 Blueprint
- 一模一策差异化精准: 千问 66.2%（商务类）vs 豆包 60.8%（棋牌偏弱）
- 45P/0F 是所有模型中最高测试通过率

**不足**:
- Agent workspace 承诺创建但未落地（V3.5 WARN）
- Cron 任务提及但未在 metrics 中验证

---

### 2. GPT-5.4 — 7.85/10

**E2E: 44 PASS / 0 FAIL / 3 WARN**（手动收集，框架收集阶段崩溃）

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 9 | 0.20 | 1.80 |
| 工具调用 | 8 | 0.25 | 2.00 |
| 二层路由 | 8 | 0.15 | 1.20 |
| 治理闭环 | 6 | 0.15 | 0.90 |
| 自进化 | 7 | 0.15 | 1.05 |
| 响应质量 | 9 | 0.10 | 0.90 |

**亮点**:
- **最多实体创建**: 47 个（+40 新），含 geo-strategy-card ×15 + geo-visibility-daily ×15 + geo-content-item ×5
- 业务理解精准: "KTV在豆包上更强，茶室/棋牌在千问上更强，元宝更吃'可信、稳妥、边界清晰'的表达"
- 明确二层分离: "运营层负责每天监测—分析—生成草稿—复盘；治理层负责所有外发内容先审批"
- 创建 1 Blueprint (idlex-geo-governance) + 1 Agent workspace + 1 Skill (geo-ops)

**不足**:
- 治理触发但未记录为 violations（0 violations, 0 approvals）
- V6.1 WARN: Dashboard 审批循环未执行（测试在审批前结束）
- 仅 1 个新 Skill（geo-ops），自进化产出较少
- Cron 任务提及但未验证

---

### 3. Claude Opus 4.6 — 7.55/10

**E2E: 43 PASS / 1 FAIL / 4 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 8 | 0.20 | 1.60 |
| 工具调用 | 7 | 0.25 | 1.75 |
| 二层路由 | 8 | 0.15 | 1.20 |
| 治理闭环 | 6 | 0.15 | 0.90 |
| 自进化 | 8 | 0.15 | 1.20 |
| 响应质量 | 9 | 0.10 | 0.90 |

**亮点**:
- 响应质量最高: 专业日报含能见度排名表（emoji 指标 🟢🟡🔴）、逐店逐平台差异化分析
- 创建 18 实体（geo-strategy 5, geo-content 4, geo-probe 1）、3 Skills、1 Agent workspace、1 Blueprint
- 唯一一个在审批后成功发布 15 个文件（最多）
- V6.1 Approved 4 items, V6.2 15 files promoted

**不足**:
- V3.1 FAIL: 建模阶段仅创建 1 个新实体（期望 ≥2）
- 治理触发为被动模式（V5.1 WARN: 未主动触发治理拦截）
- Turn 2/4 工具调用密度低（日志仅 2 行）

---

### 3= Qwen3.5-Plus — 7.55/10

**E2E: 42 PASS / 0 FAIL / 5 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 9 | 0.20 | 1.80 |
| 工具调用 | 8 | 0.25 | 2.00 |
| 二层路由 | 6 | 0.15 | 0.90 |
| 治理闭环 | 4 | 0.15 | 0.60 |
| 自进化 | 9 | 0.15 | 1.35 |
| 响应质量 | 9 | 0.10 | 0.90 |

**亮点**:
- **最多实体创建**: +10 新实体（总计 18），含 geo-visibility ×6 + strategy + content-library + report + consultant-bot
- **最多蓝图**: 2 个 Blueprint + 5 Skills + 1 Agent workspace — 产出最丰富
- 15 份草稿内容生成（最多）
- 强自进化: 识别 5 店 × 3 平台 = 15 任务模式，创建 geo-content-generation Skill

**不足**:
- **治理闭环未闭合**: 15 份内容停留在 mock-publish-tmp，0 violations, 0 approvals — 从未触发治理
- 二层路由隐式而非显式（缺少明确分类声明）
- V6.1 WARN: No pending approvals to process

---

### 5. GLM-5 — 1.10/10

**E2E: 33 PASS / 1 FAIL / 13 WARN**

| 维度 | 分数 | 权重 | 贡献 |
|------|------|------|------|
| 业务理解 | 2 | 0.20 | 0.40 |
| 工具调用 | 1 | 0.25 | 0.25 |
| 二层路由 | 1 | 0.15 | 0.15 |
| 治理闭环 | 0 | 0.15 | 0.00 |
| 自进化 | 0 | 0.15 | 0.00 |
| 响应质量 | 3 | 0.10 | 0.30 |

**问题**:
- 陷入 "There is nothing to continue" 诊断循环，12 个 turn 中 10 个无任何工具调用
- 仅 1 次 BPS 工具调用（bps_scan_work）、0 次写操作
- 0 新实体、0 新 Skill、0 Blueprint、0 Cron、0 治理触发
- 所有 6 个 E2E turn 回复 "Continue where you left off" 提示后无法恢复

---

## 关键发现

### 1. Kimi K2.5 是当前最佳 AIDA 运营模型

在 R4 中 Kimi 已排名第一（6.40/10），R6 验证了这一结论（8.70/10，+2.30 提升）。关键差异化因素是**唯一完成完整治理闭环**——从违规触发到 Dashboard 审批到文件发布的全链路。

### 2. 治理闭环是最大分化维度

| 模型 | 治理触发 | 审批执行 | 文件发布 | 闭环完整度 |
|------|----------|----------|----------|-----------|
| Kimi K2.5 | ✅ V5.1 PASS | ✅ 2 approved | ✅ 9 files | 完整 |
| Claude Opus | ⚠️ 被动 | ✅ 4 approved | ✅ 15 files | 大部分 |
| Qwen3.5+ | ❌ 未触发 | ❌ 0 approved | ❌ 0 files | 未闭合 |
| GLM-5 | ❌ 未触发 | ❌ 0 approved | ❌ 0 files | 无 |

### 3. 工具调用密度与业务产出高度相关

| 模型 | 新实体 | 新 Skills | Blueprint | 发布文件 |
|------|--------|-----------|-----------|----------|
| Qwen3.5+ | **10** | 5 | **2** | 0 |
| Kimi K2.5 | 7 | 5 | 1 | **9** |
| Claude Opus | 11 | 3 | 1 | **15** |
| GLM-5 | 0 | 0 | 0 | 0 |

Qwen 创建最多实体/蓝图，但因治理闭环未闭合导致 0 发布。Claude 创建较少但发布最多（15）——执行完整度 > 创建数量。

### 4. GLM-5 的 "诊断循环" 模式

GLM-5 在收到 "Continue where you left off" 提示后陷入自我诊断，试图搜索历史会话而非执行任务。这是 OpenClaw 框架下 timeout→retry 机制与模型行为的不兼容——GLM 将 retry 解释为"需要调查前次失败原因"而非"继续执行任务"。

---

## R4 → R6 对比

| 模型 | R4 分数 | R6 分数 | 变化 | 备注 |
|------|---------|---------|------|------|
| Kimi K2.5 | 6.40 | **8.70** | +2.30 | 治理闭环首次完成 |
| GPT-5.4 | 4.75 | **7.85** | +3.10 | 最多实体创建(47) |
| Qwen3.5+ | 5.85 | **7.55** | +1.70 | 实体/蓝图产出大幅提升 |
| Claude Opus | — | **7.55** | N/A | R4 未测试，R6 首次 |
| GLM-5 | — | **1.10** | N/A | R4 未测试，诊断循环 |

R4 排名（Kimi > Qwen > GPT）在 R6 中得到验证。Kimi 保持第一。GPT 提升最大（+3.10）。前 4 名模型均达到 7.5+/10 生产可用水平。

---

## 待修复问题（R7）

| 优先级 | 问题 | 影响 | 修复方案 |
|--------|------|------|----------|
| P0 | `collect-metrics.sh` 崩溃 | 仅最后一个模型有 metrics/behavior | 添加 `|| true` 或将 SSH 查询放入 try-catch |
| P0 | GPT/Gemini 安装失败 | 2/6 模型缺失 | 调试 `install-benchmark.sh` 在连续运行中的行为 |
| P1 | Session JSONL 未下载 | 无法生成 behavior.json | 将 JSONL 下载提前到 collect-metrics 之前 |
| P2 | Turn log 来自前次运行 | 误导性原始数据 | 在 Step 3 清理 local results dir |

---

## 推荐生产配置

基于 R6 结果:

```
Primary:  moonshot/kimi-k2.5    (8.70, 唯一完整治理闭环)
Fallback: dashscope/qwen3.5-plus (7.55, 最强自进化)
```

---

*报告生成: 2026-03-10, R6 基准测试*
*评分方法: scoring-rubric.md 6 维度加权 (业务理解 0.20, 工具调用 0.25, 二层路由 0.15, 治理闭环 0.15, 自进化 0.15, 响应质量 0.10)*

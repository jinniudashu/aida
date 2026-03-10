# AIDA 多模型基准测试 R5 — 框架验证报告

**日期**: 2026-03-10
**评估者**: Claude Opus 4.6（固定评估者，事后评审）
**测试场景**: IdleX GEO E2E v3（6 轮对话，干净环境）
**测试服务器**: root@47.236.109.62

---

## 一、概述

R5 是 AIDA 基准测试框架的**验证轮**，目标是检验 R4→R5 之间的 5 项框架修正。R5 发现了一个关键的模型覆盖（overlay）Bug，导致**全部 6 个模型实际均以 Qwen3.5-Plus 运行**，因此 R5 **不构成有效的跨模型对比**。

但 R5 意外产生了两项有价值的发现：
1. **框架修正验证**：5 项修正中 4 项确认生效，Session JSONL 解析首次捕获真实工具调用数据
2. **Qwen3.5-Plus 三次独立运行的方差分析**：同一模型在相同条件下展现出显著的行为非确定性

---

## 二、模型覆盖 Bug 分析

### 根因

`run-single-model.sh` 的执行链：

```
install-benchmark.sh (Step 1)
  └─ install-aida.sh        ← 设置默认 model: dashscope/qwen3.5-plus
  └─ overlay openclaw.json   ← 覆盖为 BENCHMARK_PRIMARY (e.g. openrouter/openai/gpt-5.4) ✓

idlex-geo-v3.sh (Phase 0)
  └─ install-aida.sh 再次运行 ← 将 model 重置回 dashscope/qwen3.5-plus ✗ ← BUG
  └─ 重启 Gateway             ← Gateway 加载被重置的配置
```

**`idlex-geo-v3.sh` 的 Phase 0 重新运行了 `install-aida.sh`**，覆盖了 `install-benchmark.sh` 在 Step 2 写入的模型配置。

### 证据

| 标签模型 | e2e-test.log 显示的 Primary Model | 实际运行模型 | 结果 |
|---------|----------------------------------|-------------|------|
| Gemini 3.1 Pro | `moonshot/kimi-k2.5` | 未知（不匹配） | 零制品 |
| Kimi K2.5 | `dashscope/qwen3.5-plus` | qwen3.5-plus | 零制品 |
| GLM-5 | `openrouter/openai/gpt-5.4` | 未知（不匹配） | 零制品 |
| GPT-5.4 | `dashscope/qwen3.5-plus` | **qwen3.5-plus** | 43P/1F/3W |
| Qwen3.5-Plus | `dashscope/qwen3.5-plus` | **qwen3.5-plus** ✓ | 47P/0F/1W |
| Claude Opus 4.6 | `dashscope/qwen3.5-plus` | **qwen3.5-plus** | 43P/1F/3W |

前 3 个模型（Gemini/Kimi/GLM）e2e-test.log 在 Phase 1 后截断（~168 行 vs 成功模型的 480+ 行），可能因为 Gateway 加载了错误模型导致 Agent 无法启动或超时。

### 修复方案

```bash
# idlex-geo-v3.sh Phase 0 — 添加 SKIP_INSTALL 检测
if [[ "${BENCHMARK_MODE:-}" != "1" ]]; then
  bash deploy/install-aida.sh
fi
```

`run-single-model.sh` 传入 `BENCHMARK_MODE=1` 环境变量，让 E2E 测试跳过重复安装。

---

## 三、框架修正验证

R5 旨在验证 5 项 R4→R5 的框架修正：

| # | 修正项 | R4 状态 | R5 验证 | 证据 |
|---|--------|---------|---------|------|
| 1 | Session JSONL 工具调用解析 | behavior.json 全部为 0 | **✅ 已修复** | GPT标签：84 calls / 9 BPS tool types；Claude标签：64 calls / 11 BPS tool types |
| 2 | Cron 检测（jobs.json） | 所有模型 0 cron | **✅ 已修复** | 3 个成功运行均检测到 2 cron jobs |
| 3 | 测试间 Cron 清理 | 跨模型 cron 残留 | **✅ 已修复** | 每模型独立 2 cron（无残留累积） |
| 4 | 两阶段发布流程检测 | 无 draft/published 区分 | **✅ 已修复** | GPT标签：34 draft + 18 published；Qwen：2 draft + 10 published |
| 5 | 模型覆盖（overlay） | N/A（R4 首轮） | **❌ 发现 Bug** | 全部模型运行为 Qwen3.5-Plus |

**4/5 修正确认生效。** Session JSONL 解析是最关键的突破——R4 的 behavior.json 完全无效（观测方法缺陷），R5 首次捕获了真实的工具调用数据。

### Session JSONL 解析示例

"Claude" 标签运行（实际 Qwen3.5-Plus）的 behavior.json 显示：

```
总工具调用: 64 (32 BPS + 14 write + 18 other)
BPS 工具类型: bps_scan_work, bps_list_services, bps_query_entities,
  bps_load_blueprint, bps_create_skill, bps_update_entity,
  bps_governance_status, bps_create_task, bps_update_task,
  bps_complete_task, bps_next_steps
其他工具: memory_search, exec, read, sessions_list, write,
  cron, sessions_spawn, agents_list
工具错误: 0
```

这是 AIDA 基准测试历史上首次获得完整的工具调用画像。

---

## 四、Qwen3.5-Plus 三次运行方差分析

由于模型覆盖 Bug，GPT/Claude/Qwen 三个标签实际均运行 Qwen3.5-Plus，构成了同一模型的三次独立运行。

### 4.1 制品对比

| 指标 | 运行 A (GPT标签) | 运行 B (Claude标签) | 运行 C (Qwen标签) |
|------|-----------------|--------------------|--------------------|
| E2E 结果 | 43P / 1F / 3W | 43P / 1F / 3W | **47P / 0F / 1W** |
| 新建实体 | 2 | 7 | 6 |
| 实体类型 | action-plan, geo-content | geo-strategy(2), geo-visibility(2), daily-report(2), project-config | action-plan, geo-content(2), geo-monitoring, geo-strategy(2) |
| 新建技能 | 1 (geo-operations) | 3 (geo-reporter, geo-visibility-monitor, geo-content-generator) | 4 (geo-strategy, geo-reporting, geo-content, geo-monitoring) |
| Agent 空间 | 1 (storebot) | 0 | 1 (store-bot) |
| 蓝图 | 1 | 2 | 1 |
| 已发布文件 | 18 | 0 | 10 |
| 草稿文件 | 34 | 6 | 2 |
| Cron | 2 | 2 | 2 |
| 治理违规 | 0 | **2** | **2** |
| 待审批 | 0 | **2 pending** | 0 (2 已审批) |
| 工具总调用 | 84 | 64 | 9† |
| BPS 工具类型 | 9 | **11** | 1† |
| 耗时 | 944s | ~660s | 1287s |

†Qwen标签的 behavior.json 捕获的是子 Agent session（9 calls），非主 session。

### 4.2 行为模式分类

三次运行展现了截然不同的运营风格：

| 风格 | 运行 | 特征 |
|------|------|------|
| **产出驱动型** | 运行 A (GPT标签) | 最大内容产出（34 draft + 18 published），最多工具调用（84次），但零治理触发 |
| **架构驱动型** | 运行 B (Claude标签) | 最丰富的 BPS 工具使用（11 种），2 个蓝图，2 个治理拦截，但几乎无发布内容 |
| **均衡型** | 运行 C (Qwen标签) | 唯一完成治理闭环（触发→审批→发布），47/0/1 最佳测试成绩 |

### 4.3 非确定性影响评估

Qwen3.5-Plus 在相同条件下的行为方差极大：
- **治理触发率**: 2/3 运行触发（67%），1/3 完全绕过
- **实体创建量**: 2~7 个新建（3.5x 方差）
- **内容发布**: 0~18 个已发布（无穷大方差）
- **测试通过率**: 43~47 PASS（方差较小，说明基础能力稳定）

**结论**: Qwen3.5-Plus 的基础工具调用能力稳定（E2E 通过率一致），但高层行为（治理合规、内容策略、资源创建）存在显著随机性。生产环境需要更强的 AGENTS.md 约束来收窄这一方差。

---

## 五、R4 vs R5 对比

### 5.1 Qwen3.5-Plus 跨轮次对比

| 指标 | R4 | R5 最佳 (运行C) | R5 最差 (运行B) | 变化 |
|------|-----|-----------------|-----------------|------|
| E2E 通过 | 38P/1F | **47P/0F/1W** | 43P/1F/3W | ↑ 大幅改善 |
| 新建实体 | 6 | 6 | 2 | ≈ 持平 |
| 新建技能 | 11 | 4 | 1 | ↓ 回落 |
| Cron | **0** | **2** | **2** | ↑↑ 突破（首次成功创建） |
| 治理触发 | **0** | **2** | **0** | ↑ 不稳定但有进展 |
| 治理审批 | 0 | **2 approved** | 0 | ↑↑ 闭环验证 |
| 发布文件 | 73 (I/O 绕过) | **10** (正规流程) | 0 | ↑↑ 路径正确 |
| 草稿文件 | N/A | 2 | 6 | 新指标 |

**关键进展**:
- **Cron 创建**: R4 全 6 模型 0 cron → R5 全部 3 次运行均创建 2 cron（100% 成功率）。这是 R1-R5 历史上首次成功。
- **治理闭环**: R5 运行 C 首次实现完整路径：`bps_update_entity(publishReady=true)` → 治理拦截 → 2 pending approvals → Dashboard 审批通过 → 文件发布。这验证了 HITL 机制端到端可用。
- **内容发布路径**: R4 的 73 文件全部通过 write I/O 绕过治理 → R5 运行 C 的 10 文件通过正规两阶段流程发布。

### 5.2 框架能力提升

| 能力 | R4 | R5 |
|------|-----|-----|
| 工具调用可观测性 | **无效** (behavior.json 全 0) | **完整** (Session JSONL 解析，84 calls) |
| Cron 检测 | 无 | **有效** (jobs.json 解析) |
| 发布流程可见性 | 仅总文件数 | **draft + published 分开计数** |
| 轮次粒度 | 按日志文本猜测 | **按 JSONL 用户消息精确切分** |
| 模型覆盖 | N/A | **发现 Bug，待修** |

---

## 六、各标签运行详细数据

### 6.1 "GPT-5.4" 标签（实际：Qwen3.5-Plus，运行 A）

```
E2E: 43 PASS / 1 FAIL / 3 WARN
耗时: 944s (~16min)
工具调用: 84 total (25 BPS + 40 write + 19 other)
BPS 工具: bps_query_entities, bps_list_services, bps_load_blueprint,
  bps_update_entity, bps_create_task, bps_scan_work, bps_query_tasks,
  bps_governance_status, bps_complete_task
实体: 9 (action-plan:1, geo-content:1, store:5, knowledge:2)
技能: 8 (+1 geo-operations)
Agent: 1 (storebot)
蓝图: 1
发布/草稿: 18/34
Cron: 2
治理: 0 violations, 0 approvals
```

**特征**: 产出最大化型 — 34 draft + 18 published 内容，但完全绕过治理层。10 轮对话（含 4 轮 retry），6 次有效 agent turn。

### 6.2 "Claude Opus 4.6" 标签（实际：Qwen3.5-Plus，运行 B）

```
E2E: 43 PASS / 1 FAIL / 3 WARN (首次 R5 运行数据)
工具调用: 64 total (32 BPS + 14 write + 18 other)
BPS 工具: bps_scan_work, bps_list_services, bps_query_entities,
  bps_load_blueprint, bps_create_skill, bps_update_entity,
  bps_governance_status, bps_create_task, bps_update_task,
  bps_complete_task, bps_next_steps
实体: 14 (geo-strategy:2, geo-visibility:2, daily-report:2, store:5,
  project-config:1, knowledge:2)
技能: 10 (+3 geo-reporter, geo-visibility-monitor, geo-content-generator)
Agent: 0
蓝图: 2
发布/草稿: 0/6
Cron: 2
治理: 2 violations, 2 pending approvals
```

**特征**: 架构最完整型 — 11 种 BPS 工具（历史最高），使用 `bps_next_steps` 和 `bps_complete_task` 等高级工具。2 个蓝图 + 2 治理拦截，但内容发布为零（治理拦截后未完成审批流程）。调用了 `sessions_spawn` 和 `memory_search`。

### 6.3 "Qwen3.5-Plus" 标签（实际：Qwen3.5-Plus，运行 C ✓）

```
E2E: 47 PASS / 0 FAIL / 1 WARN ← 最佳成绩
耗时: 1287s (~21min)
工具调用: behavior.json 仅捕获子 Agent session (9 calls)
实体: 13 (action-plan:1, geo-content:2, geo-monitoring:1, geo-strategy:2,
  store:5, knowledge:2)
技能: 11 (+4 geo-strategy, geo-reporting, geo-content, geo-monitoring)
Agent: 1 (store-bot)
蓝图: 1
发布/草稿: 10/2
Cron: 2
治理: 2 violations, 2 approved (闭环完成)
```

**特征**: 唯一实现完整治理闭环的运行 — 触发 2 次拦截 → Dashboard 自动审批 → 10 文件正式发布。4 个新 Skill 覆盖 GEO 全链路（strategy/reporting/content/monitoring），1 个独立 Agent workspace（store-bot）。

---

## 七、加权评分（仅运行 C / 唯一验证身份正确的运行）

基于 scoring-rubric.md 六维度评分：

| 维度 | 权重 | R5 Qwen (运行C) | R4 Qwen | 变化 |
|------|------|-----------------|---------|------|
| 业务理解 | 0.20 | **8** (1.60) | 7 (1.40) | ↑ 更完整的实体类型覆盖 |
| 工具调用 | 0.25 | **7** (1.75) | 5 (1.25) | ↑↑ 13实体+4技能+1Agent+1蓝图 |
| 双层路由 | 0.15 | **8** (1.20) | 6 (0.90) | ↑ Blueprint(治理) + Entity(运营) 正确分层 |
| 治理闭环 | 0.15 | **8** (1.20) | 3 (0.45) | ↑↑↑ 首次完整闭环 |
| 自我进化 | 0.15 | **8** (1.20) | 7 (1.05) | ↑ 4技能+1Agent+2Cron 全到位 |
| 回复质量 | 0.10 | **8** (0.80) | 8 (0.80) | ≈ 持平 |
| **加权总分** | **1.00** | **7.75** | **5.85** | **↑ +1.90** |

**R5 Qwen3.5-Plus 7.75 分是 AIDA 基准测试历史最高分。**

评分依据：
- **业务理解 8**: 读取 context/ 文档，正确识别 5 店 + 3 平台，创建 geo-strategy 实体含一模一策
- **工具调用 7**: 13 实体（+6 新建）、11 技能（+4）、1 Agent、1 蓝图；BPS 工具使用覆盖面广
- **双层路由 8**: 蓝图用于治理（审批规则），Entity/Skill 用于运营（监测/内容/报告），正确分层
- **治理闭环 8**: 2 次违规触发 → 2 pending approvals → Dashboard 审批通过 → 文件发布 ← 首次完整闭环
- **自我进化 8**: 4 新 Skill（geo 全链路）+ 1 Agent workspace（store-bot 人格隔离）+ 2 Cron（日+周）
- **回复质量 8**: 结构化输出，能见度数据细致，平台差异化精准

---

## 八、历轮趋势

| 轮次 | 方法 | Qwen3.5+ 排名 | Qwen 分数 | 冠军 | 关键改进 |
|------|------|---------------|-----------|------|---------|
| R1 | 模型自评 | — | — | Claude Opus (89) | 基线（自评膨胀） |
| R2 | 模型自评 | — | — | GLM-5 (85) | 多模型覆盖 |
| R3 | 固定评估 | — | — | GPT-5.4 (89) | 残留数据污染 |
| R4 | 干净环境 | #2 | 5.85 | Kimi K2.5 (6.40) | 制品导向评分 |
| **R5** | **框架验证** | **#1†** | **7.75** | **Qwen3.5+ (7.75)†** | **Session JSONL + 治理闭环** |

†R5 仅有 Qwen3.5-Plus 一个有效模型，排名不具跨模型可比性。

### 分数提升原因分析

R5 Qwen 7.75 vs R4 Qwen 5.85 的 +1.90 提升来源：

| 维度 | R4→R5 变化 | 原因 |
|------|-----------|------|
| 工具调用 +0.50 | 5→7 | 同一模型不同运行的非确定性——R5 运行 C 恰好走上了更完整的工具调用路径 |
| 治理闭环 +0.75 | 3→8 | R4 零触发 → R5 首次完整闭环（trigger→approve→publish） |
| 双层路由 +0.30 | 6→8 | R5 蓝图正确用于治理（而非运营），分层更清晰 |
| 自我进化 +0.15 | 7→8 | 新增 2 cron 任务（R4 为 0） |

**核心结论**: 分数提升主要来自 **Qwen 行为的非确定性**（同条件下 67% 概率触发治理），而非平台代码变更。这意味着当前 AGENTS.md 指令 "勉强够用"——模型有时遵守、有时不遵守。需要更强的约束收窄方差。

---

## 九、R6 行动项

### P0: 修复模型覆盖 Bug

```bash
# run-single-model.sh 修改: 传入 BENCHMARK_MODE=1
ssh_long "cd $REMOTE_REPO && ... BENCHMARK_MODE=1 bash test/e2e/idlex-geo-v3.sh 2>&1"

# idlex-geo-v3.sh Phase 0 修改: 跳过重复安装
if [[ "${BENCHMARK_MODE:-}" != "1" ]]; then
  log "Running install-aida.sh..."
  bash deploy/install-aida.sh
fi
```

### P1: 主 Session JSONL 捕获

当前 `collect-metrics.sh` 取最新的 `.jsonl` 文件，可能命中子 Agent session（如 R5 Qwen标签运行捕获了 9 calls 的子 session 而非主 session 的完整 64+ calls）。改进方案：取与 `agent:main:main` session ID 匹配的 JSONL。

### P2: 收窄 Qwen 行为方差

三次运行中，治理触发率仅 67%。建议强化 AGENTS.md：
- 将 `bps_update_entity` 作为内容发布的**唯一合法路径**，禁止 `write` 工具触及 `mock-publish*/`
- 在 TOOLS.md 中添加 "Publish Pipeline" 示例流程
- MEMORY.md 预置一个成功的治理闭环工具调用序列

---

## 十、原始数据附录

### 10.1 各运行完整指标

| 指标 | 运行A (GPT标签) | 运行B (Claude标签) | 运行C (Qwen标签) | Gemini† | Kimi† | GLM† |
|------|----------------|-------------------|-------------------|---------|-------|------|
| 实际模型 | Qwen3.5+ | Qwen3.5+ | Qwen3.5+ | 未知 | Qwen3.5+ | 未知 |
| E2E 结果 | 43P/1F/3W | 43P/1F/3W | **47P/0F/1W** | 截断 | 截断 | 截断 |
| 耗时 (s) | 944 | ~660 | 1287 | 190 | 193 | 188 |
| 实体总数 | 9 | 14 | 13 | 0 | 0 | 0 |
| 新建实体 | 2 | 7 | 6 | 0 | 0 | 0 |
| 技能总数 | 8 | 10 | 11 | 0 | 0 | 0 |
| Agent 空间 | 1 | 0 | 1 | 0 | 0 | 0 |
| 蓝图 | 1 | 2 | 1 | 0 | 0 | 0 |
| 发布文件 | 18 | 0 | 10 | 0 | 0 | 0 |
| 草稿文件 | 34 | 6 | 2 | 0 | 0 | 0 |
| Cron | 2 | 2 | 2 | 0 | 0 | 0 |
| 治理违规 | 0 | 2 | 2 | 0 | 0 | 0 |
| 治理审批 | 0 | 2 pending | 2 approved | 0 | 0 | 0 |
| 工具调用 | 84 | 64 | 9† | — | — | — |
| BPS 工具类型 | 9 | 11 | 1† | — | — | — |

†标记模型因覆盖 Bug 导致测试截断/失败，无有效数据。
†Qwen标签 behavior.json 捕获子 Agent session（非主 session）。

### 10.2 R5 框架修正清单

| # | 修正文件 | 修正内容 | 验证状态 |
|---|---------|---------|---------|
| 1 | collect-metrics.sh | Session JSONL 解析：从 assistant content blocks 提取 tool_use，按 user messages 分 turn | ✅ |
| 2 | collect-metrics.sh | Cron 检测：解析 `~/.openclaw/cron/jobs.json` 的 `jobs[]` 数组 | ✅ |
| 3 | run-single-model.sh | 测试间清理：kill stale `idlex-geo`/`openclaw.agent` 进程 | ✅ |
| 4 | collect-metrics.sh | 两阶段发布：分别计数 `mock-publish/` (published) 和 `mock-publish-tmp/` (draft) | ✅ |
| 5 | run-single-model.sh | 模型覆盖：`BENCHMARK_PRIMARY` → `install-benchmark.sh` → `openclaw.json` | ❌ (被 idlex-geo-v3.sh 覆盖) |

---

*报告生成：2026-03-10 | 评估框架：AIDA Benchmark R5 | 评审者：Claude Opus 4.6*

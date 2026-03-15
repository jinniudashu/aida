# Autoresearch 模式应用建议

> 基于 [Karpathy autoresearch](https://github.com/karpathy/autoresearch)（2026-03-08），分析其核心模式对 AIDA 项目的借鉴价值。

## Autoresearch 核心模式

三个文件：

| 文件 | 角色 | 谁写 | 谁改 |
|------|------|------|------|
| `prepare.py` | 不可变的评估基础设施（数据、tokenizer、评估函数） | 人 | 无人 |
| `train.py` | 唯一的搜索空间（模型架构 + 训练循环） | 人初始化 | Agent |
| `program.md` | 研究策略（目标、约束、优先级） | 人 | 无人 |

一个循环：

```
Agent 读 program.md
  → 修改 train.py
  → 跑 5 分钟实验
  → 测 val_bpb（越低越好）
  → 更好？git commit，作为下一轮基线
  → 更差？git reset，回到上一个好的状态
  → 重复，永不停止
```

核心约束：**一个文件、一个指标、一个固定时间窗**。每小时 ~12 次实验，一夜 ~100 次。

## AIDA 的适配挑战

### 1. 没有 val_bpb

Autoresearch 的指标是连续、确定性、5 分钟可得的。AIDA 的"好坏"依赖 LLM 行为，本质上是随机的。

### 2. 实验周期长

| 方案 | 完整运行 | 仅引擎 | 含 Agent Turns | 远程 SSH |
|---|---|---|---|---|
| structural-capability | ~10 分钟 | ~5 分钟 | 7+1 turns | 是 |
| aef-capability | ~19 分钟 | ~3 秒 | 8+1 turns | 是 |
| benchmark | ~4 小时 | N/A | 6×6 模型 | 是 |

Autoresearch 每小时 12 次，AIDA 最快每小时 3 次（structural-capability full），差 4 倍。且 Agent turns 引入的方差意味着同一配置跑两次可能得到不同结果。

### 3. 搜索空间是自然语言

Autoresearch 改的是 Python 代码（学习率、层数、激活函数），变更空间虽大但有结构。AIDA 要优化的是 Workspace 自然语言指令（AGENTS.md、TOOLS.md、Skills/*.md），"修改"的语义模糊，更难形成有效的 hill-climbing。

## 建议方案：两层 Autoresearch

不照搬单循环，而是分两层，各自匹配不同的实验速度和确定性要求。

### Layer 1：引擎 Fitness（快速、确定性）

**对应 autoresearch 的 val_bpb**。

用 aef-capability 的 engine-only 模式（~3 秒）作为快速 fitness function，验证引擎改动没有引入回归。

```
搜索空间：src/ 下的引擎代码
指标：aef-capability --engine-only 的 PASS 数（128 checks 中的 69 个引擎检查）
周期：~3 秒/次，每小时 ~1000 次（理论上限）
用途：引擎重构、新工具开发、管理层改动时的自动回归验证
```

这一层不需要远程服务器，本地运行，完全确定性。但它只验证基础设施正确性，不验证 Agent 行为——引擎已经稳定，这一层当前价值有限。

### Layer 2：Agent 行为优化（慢速、统计性）

**这是真正有价值的层**——优化 Aida 的 Workspace 使其在业务场景中表现更好。

```
搜索空间：agents/Aida/ 下的 Workspace 文件
  - AGENTS.md（行为指令）
  - TOOLS.md（工具使用备注）
  - SOUL.md（身份定义）
  - skills/*.md（Skill 定义）

指标：structural-capability Phase 4 的加权分数
  - PASS 数（基础）
  - 工具调用数（从 session JSONL 提取）
  - 管理触发数（从 DB 提取）
  - 实体创建数（从 DB 提取）
  → 加权为单一数值

周期：~15 分钟/次（含部署 + Agent turns），每小时 ~3 次，一夜 ~25 次
```

**关键适配**：因为 LLM 方差，单次实验不足以判断好坏。

- **方案 A（简单）**：每个 Workspace 变更跑 1 次，接受噪声，依靠大量迭代抵消（类似 autoresearch 原始做法，它的 5 分钟训练也有随机性）
- **方案 B（稳健）**：每个变更跑 3 次，取中位数作为 fitness。周期变为 ~45 分钟/变更，一夜 ~8 次迭代，但信号更可靠

建议从方案 A 起步，积累数据后评估方差大小再决定是否切换。

## 三个现有方案的新定位

| 方案 | Autoresearch 角色 | 运行频率 | 用法 |
|---|---|---|---|
| **aef-capability** (engine-only) | Layer 1 快速 fitness | 每次引擎改动 | 本地 3 秒回归验证 |
| **structural-capability** (full) | Layer 2 Agent fitness | 每次 Workspace 改动 | 远程 ~15 分钟 Agent 行为评分 |
| **aef-capability** (full) | Validation gate | 每 5-10 次迭代 | 完整维度健康度检查，防止 Σ 维度退化 |
| **benchmark** | 周期性 leaderboard | 每周或里程碑 | 多模型横评，跟踪长期趋势 |

## 需要新建的组件

### 1. `auto-workspace.sh`（循环控制器，~100 行）

```bash
# 类比 autoresearch 的主循环
while true; do
  # 1. Agent 读 program.md，修改 Workspace 文件
  # 2. 部署到远程（scp agents/Aida/ → 服务器）
  # 3. 跑 structural-capability Phase 4
  # 4. 提取加权分数 → results.tsv
  # 5. 分数更好？git commit : git reset
done
```

### 2. `program.md`（研究策略，~30 行）

定义优化目标和约束，例如：

```markdown
## Goal
Optimize Aida's Workspace files to maximize tool invocation rate
and management compliance in the IdleX GEO business scenario.

## Constraints
- Only modify files under agents/Aida/
- Do not change file count (no new files, no deletions)
- Keep total Workspace token count under 500 tokens
- Every change must have a clear hypothesis

## Current Problems
- "Say but don't do": Aida describes perfect plans but doesn't call tools
- Management bypass: Aida creates files directly instead of using bps_update_entity
- Low cron creation rate: most models fail to register periodic tasks

## Priorities
1. Increase BPS tool call count (currently ~30 per session, target ~60)
2. Ensure management triggers on every write operation
3. Enable autonomous cron registration without explicit prompting
```

### 3. `score-extractor.sh`（评分提取器，~50 行）

从 structural-capability 输出中提取单一数值分数：

```bash
# 输入：structural-capability 的输出日志 + 远程 DB + session JSONL
# 输出：一行 TSV → results.tsv
# 格式：timestamp  workspace_hash  pass_count  tool_calls  mgmt_triggers  entities  weighted_score  keep/discard
```

## 预期产出

一夜 25 次 Workspace 迭代（方案 A），预期：

- 发现 3-5 个有效的 Workspace 改动（类比 autoresearch 一夜发现 ~20 个改进中约 25% 的保留率）
- 形成 Workspace 优化的实证知识（哪些措辞让 LLM 更倾向于调用工具）
- 积累 results.tsv 数据，为后续分析 LLM 行为提供基础

## 不建议做的事

- **不要用 autoresearch 优化引擎代码**：引擎已稳定（437 tests 全部通过），收益低
- **不要追求 autoresearch 的实验速度**：AIDA 的实验周期是 15 分钟不是 5 分钟，接受这个现实
- **不要自动合并 Workspace 改动到生产**：autoresearch 的 hill-climbing 在 LLM 行为优化上可能陷入局部最优（比如找到一种让 Aida 疯狂调用工具但质量低下的措辞），人类必须 review 每个 keep 的 commit

## 与下周业务测试的关系

下周进入真实业务测试是正确的优先级。Autoresearch 模式是**业务测试之后**的优化手段：

1. **下周**：真实业务场景，人工观察 Aida 行为，收集定性反馈
2. **之后**：将定性发现转化为 program.md 的优化目标和 score-extractor 的评分权重
3. **再之后**：启动 auto-workspace 循环，自动优化 Workspace

顺序不能反——没有真实业务反馈，program.md 写不出有意义的优化方向。

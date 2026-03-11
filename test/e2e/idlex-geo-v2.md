# IdleX GEO E2E 测试方案 v2

> 日期：2026-03-07 | 目标服务器：root@47.236.109.62

## 1. 测试目标

从空服务器完整验证 AIDA 全生命周期：安装 → 数据注入 → Aida 业务建模 → 用户确认 → 日常执行 → 治理拦截 → Dashboard 审批 → 运营小结。

### 与 v1（2026-03-06）的关键差异

| 维度 | v1 | v2 |
|------|-----|-----|
| 对话风格 | 混合（部分指令式） | 全程目标陈述式 |
| Skill 创建 | 未测试 | 设计 prospective gap 触发 |
| Agent 创建 | 未测试 | 设计 persona isolation 触发 |
| 蓝图 | 未测试 | 纳入建模要求 |
| 仓库路径 | `packages/bps-engine/` | `aida/`（扁平化后） |
| Context 来源 | 1 个 placeholder | 7 份真实闲氪文档 |
| Management | entityType 不匹配 | 宽泛匹配 + 修复 |

## 2. 测试环境

- **服务器**：干净 Linux（已有 Node.js 24+）
- **OpenClaw**：需预装（`openclaw` CLI 可用）
- **AIDA**：由 `deploy/install-aida.sh` 安装
- **Mock 数据**：5 家门店（长沙 3 + 武汉 2），模拟探测数据
- **发布目录**：`~/.aida/mock-publish/`（不触及真实发布）
- **Business Context**：7 份闲氪真实文档复制到 `~/.aida/context/`

## 3. 对话脚本（6 轮，目标陈述风格）

### Turn 1 — 业务需求陈述

```
我是闲氪的运营负责人。闲氪帮自助休闲空间合作门店在AI时代被看见。
请先看一下 ~/.aida/context/ 里的业务资料。系统里已有5家合作门店（长沙3家+武汉2家）。

我的目标是建立完整的GEO日常运营体系，需要这些能力：
1. 每天监测各门店在主流AI（豆包、千问、元宝）中的能见度
2. 分析监测数据，制定"一模一策"的提升战略
3. 为每家门店生成针对不同AI模型的优化内容（门店描述、FAQ、场景故事等）
4. 内容发布到 ~/.aida/mock-publish/ 目录（测试阶段），发布前需我审批
5. 每天运营小结，每周深度复盘
6. 我还想要一个24小时在线的门店咨询bot，语气亲切活泼，
   能自主回答顾客关于门店的各种问题——这跟你的管理风格完全不同

测试阶段的能见度探测用模拟数据就行。请帮我规划这套运营体系。
```

**设计意图**：
- 第 1-5 项覆盖标准 GEO 运营（实体/Cron/Skill/蓝图）
- 第 6 项"门店咨询 bot"命中 Agent 创建的 3 个触发条件：
  - Persona isolation（亲切活泼 vs 管理风格）
  - Concurrent execution（24h 在线）
  - Independent lifecycle（独立运行节律）
- 期望 Aida 识别出 skill gap + agent gap

### Turn 2 — 全权授权建模

```
方案我认可。现在就落地吧——需要创建什么实体就创建，需要什么Skill就建，
需要独立Agent就建，需要蓝图就写蓝图，需要定时任务就注册。全权交给你。
```

**设计意图**：明确授权 Aida 执行所有建模操作，不限制路径选择。

### Turn 3 — 检查建模成果

```
带我检查一下建模成果。你创建了哪些实体、Skill、Agent、蓝图？Dashboard上能看到什么？
```

**设计意图**：触发 Aida 汇报建模清单 + 引导用户查看 Dashboard。

### Turn 4 — 启动日常执行

```
确认没问题，开始今天的GEO日常运营工作吧。
```

**设计意图**：触发实际 GEO 执行（探测/分析/内容生成/分发），期望治理层拦截 publish 操作。

### Turn 5 — 确认治理拦截

```
收到，我去Dashboard处理审批。
```

**设计意图**：确认 Aida 正确报告治理拦截。脚本随后通过 API 自动审批。

### Turn 6 — 运营小结

```
审批处理完毕。做个今天的运营小结。
```

**设计意图**：验证 Aida 日报能力。

## 4. 测试阶段

| Phase | 内容 | 预计耗时 |
|-------|------|----------|
| 0 | 清洁环境 + `install-aida.sh` + Gateway 启动 | ~3 min |
| 1 | 数据注入：project.yaml + management.yaml + 5 门店 + 7 context docs | ~30s |
| 2 | Turn 1：业务需求陈述 | ~60s |
| 3 | Turn 2：全权建模 + 验证（实体/Skill/Agent/蓝图） | ~120s |
| 4 | Turn 3：检查建模成果 | ~30s |
| 5 | Turn 4：GEO 执行 → 治理拦截 | ~90s |
| 6 | Turn 5 + API 审批 | ~30s |
| 7 | Turn 6：运营小结 | ~30s |
| 8 | 终验：全量检查 | ~10s |

**总计：~8-10 分钟**

## 5. 验证矩阵

| ID | 检查项 | Phase | 必须通过 |
|----|--------|-------|----------|
| V0.1-V0.9 | 安装完整性（目录/文件/Dashboard） | 0 | YES |
| V1.1-V1.5 | 数据注入（5 store / 3 constraint / context） | 1 | YES |
| V2.1 | Aida 产出响应 | 2 | YES |
| V2.2-V2.4 | Aida 提及方案/skill gap/agent gap | 2 | soft |
| V3.1 | 新实体 >= 2（strategy + action-plan） | 3 | YES |
| V3.2-V3.3 | action-plan / strategy 实体 | 3 | soft |
| V3.4 | 新 Skill 创建 | 3 | soft |
| V3.5 | Agent workspace 创建 | 3 | soft |
| V3.6 | 蓝图文件创建 | 3 | soft |
| V4.1-V4.2 | 建模汇报 + 提及 Dashboard | 4 | soft |
| V5.1 | 治理触发（violation 或 pending approval） | 5 | soft |
| V5.2 | Aida 报告治理拦截 | 5 | soft |
| V6.1 | API 审批通过 | 6 | YES（如有 pending）|
| V7.1-V7.2 | 运营小结 + 包含业务内容 | 7 | YES |
| V8.1-V8.3 | 终验（实体/Dashboard/Skills） | 8 | YES |

**soft** = 不通过不判定测试失败，但记录为 WARN。这些验证取决于 Aida 的具体路径选择。

## 6. Self-Evolution 触发设计

### Skill 创建（prospective 路径）

action-plan SKILL.md 要求 Aida 在创建行动计划时做 skill gap check。GEO 运营的以下能力没有匹配的内置 Skill：
- 能见度探测 → 无匹配 Skill
- 内容生成 → 无匹配 Skill
- 日/周报 → 无匹配 Skill

Aida 应识别这些 gap 并提议创建新 Skill（如 `geo-probe`、`geo-content-gen`）。

### Agent 创建（Skill vs Agent Decision）

Turn 1 第 6 项"门店咨询 bot"命中 AGENTS.md § Self-Evolution 的 3 个 Agent 条件：
1. **Concurrent execution**：24h 在线，与 Aida 主交互并行
2. **Persona isolation**：亲切活泼 ≠ Aida 管理风格
3. **Independent lifecycle**：独立运行节律

Aida 应提议通过 `agent-create` 创建独立 Agent，而非 `skill-create`。

## 7. 已知风险

| 风险 | 缓解 |
|------|------|
| Aida 不走 Blueprint 路径（v1 已观察到） | soft check，不强制 |
| Aida 用文件 I/O 绕过治理 | AGENTS.md Red Line 3 已禁止 |
| entityType 命名与 management 不匹配 | management.yaml 宽泛匹配 |
| Agent 对话超时 | 每轮 300s 超时 + `|| true` |
| LLM 理解偏差导致未创建 Skill/Agent | soft check + 对话设计最大化触发 |

## 8. 执行

```bash
# 在测试服务器上运行
bash test/e2e/idlex-geo-v2.sh

# 跳过安装（已安装时）
bash test/e2e/idlex-geo-v2.sh --skip-install

# 跳过数据注入（已注入时）
bash test/e2e/idlex-geo-v2.sh --skip-install --skip-seed

# 从指定阶段开始
bash test/e2e/idlex-geo-v2.sh --skip-install --skip-seed --phase 5
```

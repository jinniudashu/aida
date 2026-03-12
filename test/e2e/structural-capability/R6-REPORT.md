# 结构能力 E2E 测试 R6 报告

## 测试概要

| 项目 | 值 |
|------|-----|
| 轮次 | R6（模型锁定 + S3.08 移至 Phase 5 + 熔断器重置） |
| 日期 | 2026-03-12 09:29–09:44 |
| 模型 | **kimi/kimi-for-coding**（首次锁定，V0.7 验证通过） |
| 模式 | full（Phase 0-5 全量） |
| 耗时 | 868s（14.5 分钟） |
| 结果 | **93 PASS / 0 FAIL / 5 WARN / 98 TOTAL** |

## R5→R6 变更清单

| 变更 | 内容 | 效果 |
|------|------|------|
| **模型锁定** | Phase 0 安装后覆盖 openclaw.json primary → kimi/kimi-for-coding | V0.7 PASS，首次确认使用 Kimi |
| **S3.08 移至 Phase 5** | 审批决策测试从 Phase 3 移至 Phase 5（审批在 Phase 4 产生） | S3.08 不再因时序问题 WARN |
| **熔断器重置** | Step 5 与 Turn 6 之间重置熔断器 | B4.22 PASS（workspace 创建成功） |
| **V0.7 新增** | 模型验证检查点 | 确认 primary = kimi/kimi-for-coding |

## R5→R6 对比

| 指标 | R5 (Qwen) | R6 (Kimi) | 变化 |
|------|-----------|-----------|------|
| PASS | 93 | **93** | = |
| FAIL | 1 | **0** | -1 |
| WARN | 3 | **5** | +2 |
| TOTAL | 97 | **98** | +1 (V0.7) |
| Model | dashscope/qwen3.5-plus | **kimi/kimi-for-coding** | 首次锁定 |
| Entities (new) | 8 | **5** | Kimi 创建更少 |
| Entities (total) | 17 | **14** | |
| Skills (new) | 3 | **3** | = |
| Violations | 5 | **3** | -2 |
| Blueprints | 2 | **2** | = |
| Write calls | 3 | **4** | +1 |
| Workspaces | 0 | **1** | +1（熔断器重置） |
| Duration | 781s | **868s** | +11% |

## 修正效果详细分析

### 模型锁定

R1-R5 实际均以 `dashscope/qwen3.5-plus` 运行（install-aida.sh 默认 primary），R3/R4 报告标注为 Kimi 是错误的。R6 首次通过 Phase 0 overlay 机制确保使用 `kimi/kimi-for-coding`，V0.7 检查点验证通过。

### 熔断器重置 → B4.22 修复

R5 中 Turn 6 受 RESTRICTED 状态阻止，无法创建 Agent workspace（B4.22 WARN）。R6 在 Step 5 审批后重置熔断器为 NORMAL，Turn 6 成功创建 `workspace-xianke-store-helper`（闲氪门店小助手）。

### 管理闭环缺失（5 WARN 集中区）

Kimi 在 Turn 4 绕过了管理约束——未通过 `bps_update_entity` 设置 `publishReady=true`，而是直接执行内容发布流程。导致：
- B4.15 WARN：violations 未增加（0 个新违规）
- B4.17 WARN：未提及审批 ID 或 Dashboard
- B4.18 WARN：无 pending approvals
- B4.19 WARN：无 approved 记录
- S3.08 WARN：Phase 5 检查 decided approvals = 0

这是 Kimi 模型行为问题：它"口头确认审批"而非通过 BPS 工具触发管理层。对比 R5 (Qwen) 有 5 个 violations，说明 Qwen 更积极使用 `bps_update_entity` 触发约束。

## Turn 分析

### Turn 1：业务交代（69s）
- 读取 context、查询实体/任务
- 输出 68 行结构化推进方案（5 店 + 管理约束 + 日常运营节奏）
- B4.01-B4.04 全 PASS

### Turn 2：授权建模（188s）
- 创建 3 个 Skill（geo-visibility-probe, geo-content-generator, geo-effect-evaluator）
- 加载运营蓝图（6 个服务节点）
- 3 个新实体（content + knowledge 类型）
- B4.05-B4.09 全 PASS

### Turn 3：日常运营（167s）
- 能见度探测（3 店：悠然茶室 #7, 声临其境 KTV 未推荐, 棋乐无穷 #12）
- 4 次 write tool calls（3 份内容 + 1 份探测报告）
- 2 个新实体（probe + analysis）
- B4.10-B4.13 全 PASS

### Turn 4：管理触发（114s）
- 内容发布 + 分发到 mock-publish/doubao/
- **未触发管理约束**——Kimi "口头确认审批" 而非使用 BPS 工具
- 提及了管理拦截概念但实际绕过
- B4.14 PASS, B4.15/B4.17 WARN

### Step 5：程序化审批
- 无 pending approvals → 0 approved
- B4.18/B4.19 WARN
- 熔断器重置成功

### Turn 6：自进化（168s）
- 完善 geo-visibility-probe Skill
- 创建 Agent workspace `workspace-xianke-store-helper`（闲氪门店小助手）
- 输出 115 行详细设计
- B4.20-B4.23 全 PASS（**首次全 PASS**）

### Turn 7：日结（51s）
- 173 行运营日报：门店覆盖、内容产出、探测排名
- B4.24-B4.25 PASS

### Turn 8：管理审计（60s）
- 161 行管理制度执行报告
- 熔断器 NORMAL、约束分析、改进建议
- B4.26-B4.27 PASS

## WARN 分析（5 个）

| Check | 说明 | 根因 | 类别 |
|-------|------|------|------|
| B4.15 | 管理违规未增加 (new=0) | Kimi 绕过约束，未设置 publishReady=true | 模型行为 |
| B4.17 | 未提及审批 ID/Dashboard | 无管理拦截 → 无审批 ID 可报告 | 模型行为 |
| B4.18 | 无 pending approvals | 同上 | 模型行为 |
| B4.19 | 无 approved 记录 | 同上 | 模型行为 |
| S3.08 | decided approvals = 0 | 同上 | 模型行为 |

**结论**：5 WARN 全部源于同一根因——Kimi 在 Turn 4 未通过 BPS 工具触发管理层。这是模型行为差异，非基础设施缺陷。

## 系统状态

```
Entities:    14（9 种子 + 5 新建）
  store: 5, probe: 2, content: 2, knowledge: 2
  action-plan: 1, analysis: 1, strategy: 1
Violations:  3（种子产生，Agent 未触发新违规）
Constraints: 2（Kimi 可能修改了种子约束）
Skills:      10（7 基础 + 3 Kimi 创建）
Blueprints:  2（1 种子 + 1 Kimi 创建）
Write calls: 4（3 份内容 + 1 份报告）
Workspaces:  1（workspace-xianke-store-helper）
```

## R1→R6 趋势

| 轮次 | PASS | FAIL | WARN | 模型 | 重点 |
|------|------|------|------|------|------|
| R1 | 63 | 0 | 1 | engine-only | 框架验证 |
| R2 | 70 | 0 | 2 | Qwen* | Agent turns + 管理拦截 |
| R3 | 91 | 2 | 4 | Qwen* | 完整业务场景，管理闭环 |
| R4 | 92 | 1 | 4 | Qwen* | 修正验证，violations -79% |
| R5 | 93 | 1 | 3 | Qwen* | 阈值修正 + 术语统一 |
| **R6** | **93** | **0** | **5** | **Kimi** | **模型锁定 + 熔断器重置 + 0 FAIL** |

*R2-R5 实际使用 dashscope/qwen3.5-plus，之前报告标注为 Kimi 是错误的。R6 是首次确认使用 kimi/kimi-for-coding。

## 关键结论

1. **0 FAIL 达成**：B4.06 soft 修正 + V5.2 阈值修正 + 熔断器重置三项改动生效
2. **基础设施验证通过**：模型锁定、熔断器重置、Skill/Agent 创建路径全部工作正常
3. **管理闭环是模型敏感的**：Qwen 主动触发约束（R5 有 5 violations），Kimi 倾向于绕过约束（R6 有 0 新 violations）
4. **Kimi 自进化能力强**：Turn 6 首次全部 PASS（Skill 完善 + Agent workspace 创建），得益于熔断器重置

## 遗留问题

| 问题 | 严重度 | 建议 |
|------|--------|------|
| Kimi 不触发管理约束 | Medium | 5 WARN 全部源于此；可能需要 AGENTS.md 强化"必须通过 BPS 工具修改实体"指令 |
| Write targets 显示 "?" | Low | JSONL parser 字段名不匹配，仅影响报告展示 |
| install-aida.sh 无 API keys | Low | 服务器 env vars 未 export，models.json 跳过 provider 配置。依赖 auth-profiles.json 已有数据 |

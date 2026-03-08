# IdleX GEO E2E v3.2 评估报告

**测试日期**: 2026-03-08 11:04-11:20 CST
**测试服务器**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**LLM**: openrouter/openai/gpt-5.4 via OpenRouter (fallback: claude-sonnet-4.6 / gemini-3.1-pro-preview)
**自动化结果**: 39 PASS / 0 FAIL / 4 WARN / 39 TOTAL
**Session**: agent:main:main (dmScope=main，自动共享上下文)

---

## 一、测试目标与方法

**业务目标**: 一个 GEO 负责人 + Aida 完成闲氪全部 GEO 运营任务。

**v3.2 变更**（相比 v3.1）:
1. 模型路由修复：`openrouter/openai/gpt-5.4`（非 `openai/gpt-5.4`）
2. Fallback 链全部走 OpenRouter：`openrouter/anthropic/claude-sonnet-4.6` → `openrouter/google/gemini-3.1-pro-preview`
3. 移除无效的 `--session-id` 参数（`dmScope=main` 自动共享）
4. 全面 OpenClaw 状态清理（sessions + workspace + cron），保留 auth 配置
5. Gateway 健康检查轮询 + 模型配置验证

**对话设计**: 同 v3，目标陈述式，6 轮完整生命周期。

---

## 二、关键发现

### 发现 1: Gateway 失败但 Embedded 模式完美工作

所有 6 轮 Turn 均出现：
```
Gateway agent failed; falling back to embedded
Error: No API key found for provider "openrouter". Auth store: auth-profiles.json
```

**原因**: Gateway 进程的 `auth-profiles.json` 中没有 OpenRouter API key。但 embedded 模式（CLI 直接执行）从环境变量 `OPENROUTER_API_KEY` + `models.json` 配置成功连接。

**结论**: 测试脚本环境 → embedded CLI → models.json → OpenRouter API 路径畅通。Gateway → agent dir → auth-profiles.json 路径缺失。这不影响测试结果质量，但生产部署需要修复。

### 发现 2: 业务理解与执行质量极高

| Turn | 行数 | 内容摘要 |
|------|------|----------|
| Turn 1 | 541 | 完整运营体系规划（三层设计 + 八步实施 + 三阶段节奏） |
| Turn 2 | 212 | 一次性落地 11 项内容（实体 + 蓝图 + Agent + Cron + 目录结构） |
| Turn 3 | 348 | 详细 Review（系统内 / 目录内 / Dashboard 三层） |
| Turn 4 | 138 | 完整执行（15 条探测 + 15 份内容 + 日报） |
| Turn 5 | 33 | 简洁确认审批流 |
| Turn 6 | 79 | 运营小结（样板门店 + 补强方向 + 下一步） |

Turn 1 展示了真正的业务理解：
- 正确识别出"运营体系 + 审批治理 + 独立顾客 bot"三层设计
- 明确将顾客 bot 定位为独立 Agent 而非 Skill
- 给出"先 GEO 运营体系 → 再顾客 bot"的优先级判断

### 发现 3: 工具调用密度显著提升

Turn 2 单轮创建了 20 个新实体 + 1 个 Blueprint + 1 个 Agent workspace + 3 个 Cron + mock-publish 目录结构：

| 实体类型 | 数量 | 说明 |
|----------|------|------|
| action-plan | 1 | GEO 日常运营总计划 |
| geo-model | 3 | 豆包/千问/元宝模型画像 |
| geo-strategy-card | 15 | 5 店 × 3 模型策略卡 |
| geo-visibility-run | 1 | 监测批次 |
| knowledge | 2 | 系统知识 |
| **新增合计** | **20** | |

Turn 4 追加 15 个 geo-visibility-record + 15 份内容文件。

**最终状态**: 42 个实体、1 个蓝图、20 个 mock-publish 文件、3 个 Cron。

### 发现 4: Two-Layer 路由正确执行

Turn 2 中 Aida 正确区分了两个层：
- **Governance 层**: 创建 `idlex-geo-governance.yaml` 蓝图（编译通过），约束内容发布和策略变更
- **Operations 层**: 使用 Entity + Skill 路径创建运营实体

Blueprint 结构清晰：
```yaml
flow:
  - svc-content-ready -> svc-human-approval -> svc-mock-publish
  - svc-content-ready -> svc-strategy-change-proposal | "major strategy adjustment"
  - svc-strategy-change-proposal -> svc-strategy-human-confirm
```

### 发现 5: 一模一策差异化精准

15 份内容针对不同模型有明确差异：
- **doubao**: 强调"年轻人聚会、夜间娱乐、出片感"（情绪价值）
- **qianwen**: 强调"商圈、包厢规格、适合人数、价格梯度"（结构化数据）
- **yuanbao**: 强调"高效决策型表达、品质感、商务洽谈"（务实推荐）

### 发现 6: 自我进化能力

- **Agent 创建**: 独立创建 `workspace-idlex-store-consultant`（IDENTITY + SOUL + AGENTS + config），人格定位"小闲店铺顾问"，语气亲切活泼
- **Cron 注册**: 3 个定时任务（每日 10:00 监测、每日 19:00 小结、每周一 11:00 复盘）
- **Blueprint 编译**: 使用简化格式（services + flow），编译通过

### 发现 7: 治理绕过仍存在

Aida 使用 `write`（exec 工具）将内容写入 `~/.aida/mock-publish/pending-approval/`，而非通过 `bps_update_entity` 设置 `publishReady` 标记。这导致治理层不触发。

但与之前不同的是：Aida 自建了**文件级审批流**（pending-approval → approved → published → rejected 目录结构 + README.md），本质上实现了"审批前拦截"的业务意图，只是绕过了引擎层治理。

---

## 三、评分矩阵

| 维度 | 权重 | 得分 | 说明 |
|------|------|------|------|
| **部署完整性** | 15% | 100 | 14/14 PASS，模型配置正确 |
| **业务理解** | 15% | 98 | 541 行规划，三层设计 + 优先级判断极其精准 |
| **Two-Layer 路由** | 15% | 90 | Governance Blueprint + Operations Entity 正确分层 |
| **建模执行** | 20% | 95 | 20 新实体 + Blueprint + Agent + Cron，一次性落地 |
| **内容质量** | 15% | 95 | 15 份差异化内容，一模一策精准 |
| **治理闭环** | 10% | 30 | 自建文件级审批流，但绕过引擎层治理约束 |
| **自我进化** | 10% | 95 | Agent 创建 + Cron 注册 + Blueprint 编写 |

**加权总分: 89/100**

---

## 四、与历次测试对比

| 维度 | v2 (87) | v3 (60) | v3.1 (32) | **v3.2 (89)** | 变化 |
|------|---------|---------|-----------|---------------|------|
| 部署 | 100 | 100 | 100 | **100** | = |
| 业务理解 | 95 | 95 | 25 | **98** | **+73** |
| Two-Layer | N/A | 85 | 0 | **90** | **+90** |
| 建模执行 | 90 | 25 | 5 | **95** | **+70** |
| 内容质量 | 90 | 90 | 85 | **95** | +10 |
| 治理 | 70 | 15 | 5 | **30** | +15 |
| 自我进化 | 100 | 10 | 0 | **95** | **+85** |

**关键差异**: v3.2 是首次从清洁环境一次性完成全部建模+执行的测试。v2 依赖前次测试的 MEMORY.md，v3/v3.1 受模型问题影响。

---

## 五、根因分析

### 成功因素

1. **模型路由修复**: `openrouter/` 前缀正确路由到 OpenRouter 提供的 GPT-5.4
2. **Session 连续性**: `dmScope=main` 自动将 6 轮 Turn 共享在同一 session 中
3. **清洁环境**: 完全清除旧 sessions/workspace/cron，避免历史上下文污染
4. **Embedded 模式兜底**: Gateway 失败后 embedded CLI 从环境变量加载 API key

### 剩余问题

**P0: Gateway auth 配置**
```
Gateway process → auth-profiles.json → 无 OpenRouter key → 失败
Embedded CLI → models.json → env:OPENROUTER_API_KEY → 成功
```
需要在 `~/.openclaw/agents/main/agent/auth-profiles.json` 中配置 OpenRouter API key，或确保 Gateway 进程环境中有 `OPENROUTER_API_KEY`。

**P1: 治理绕过（第 4 次复现）**
Aida 使用 `exec/write` 工具直接操作文件系统，不经 `bps_update_entity` → 治理层不触发。
本次 Aida 自建了文件级审批流作为补偿，但这不受引擎层监控。

---

## 六、架构资产价值判定

| 资产 | 状态 | 本次新证据 |
|------|------|-----------|
| install-aida.sh 部署 | **完全工作** | 清洁环境一次通过 |
| BPS 工具调用 | **高频使用** | 20+ 实体创建，42 最终状态 |
| Blueprint 编译器 | **首次 Agent 自主使用验证** | Aida 写 services+flow → 编译通过 |
| Agent 创建 | **验证通过** | workspace-idlex-store-consultant |
| Cron 定时任务 | **验证通过** | 3 个新 Cron，调度正确 |
| Session 连续性 | **验证通过** | 6 轮 Turn 共享上下文 |
| Two-Layer 路由 | **验证通过** | Governance Blueprint + Operations Entity |
| 一模一策内容 | **验证通过** | 15 份差异化内容 |
| 治理层 | **架构完整，执行绕过** | 连续 4 次测试均绕过 |

---

## 七、改进建议

### P0: Gateway Auth 配置
在 `install-aida.sh` 中自动写入 `auth-profiles.json`，确保 Gateway 模式下也能使用 OpenRouter。

### P1: 治理绕过修复
在 AGENTS.md / TOOLS.md 中增加强制约束：
```
NEVER use `exec` or `write` to create content files directly.
ALL content must go through `bps_update_entity` with publishReady flag.
```
或在 `tools.exec.security` 中限制对 `mock-publish/` 的直接写入。

### P2: Embedded vs Gateway 模式
当前 embedded 模式是可用的兜底方案，但不是最优路径（每个 Turn 要重新加载插件）。修复 Gateway auth 后可获得更好的性能。

---

## 八、总结

| 指标 | 值 |
|------|-----|
| **加权总分** | **89/100** |
| 自动化测试 | 39 PASS / 0 FAIL / 4 WARN |
| 运行时长 | ~16 分钟（6 轮 Turn） |
| 最终实体数 | 42（20 新增 + 15 Turn 4 新增 + 7 种子） |
| Blueprint | 1（编译通过） |
| Agent workspace | 1（小闲店铺顾问） |
| Cron 定时任务 | 3 |
| Mock-publish 文件 | 20 |
| 治理闭环 | 未验证（连续 4 次测试均绕过） |

**一句话**: 这是 AIDA 项目迄今为止最成功的端到端测试。从清洁环境出发，Aida 在 6 轮对话中完成了完整的 GEO 运营体系搭建——包括 42 个业务实体、治理蓝图、独立顾客 bot、定时任务和 15 份差异化内容。GPT-5.4 via OpenRouter（embedded 模式）展现了显著优于 Gemini 3.1 Pro 的工具调用能力和业务理解深度。唯一持续存在的问题是治理层绕过（Aida 自建文件级审批流替代引擎层约束）。

---

*测试脚本: `test/e2e/idlex-geo-v3.sh` | 测试方案: `test/e2e/idlex-geo-v3.md` | Turn Logs: `/tmp/idlex-geo-e2e-v3/`*

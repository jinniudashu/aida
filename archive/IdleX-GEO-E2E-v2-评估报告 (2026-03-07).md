# IdleX GEO E2E v2 -- 系统状态评估报告

**日期**：2026-03-07
**测试服务器**：root@47.236.109.62 (Alibaba Cloud ECS)
**LLM**：google/gemini-3.1-pro-preview（fallback: claude-sonnet-4-6, gpt-4.1）
**OpenClaw**：2026.3.x | **Node.js**：24.13.0

---

## 1. 业务目标

> **一个 GEO 负责人 + Aida 完成闲氪全部 GEO 运营任务。**

具体能力要求：
1. 每日能见度监测（5 店 x 3 AI 模型）
2. 深度洞察分析 + "一模一策"战略制定
3. 日常运营战术策略
4. GEO 内容生成（门店描述/FAQ/场景故事）
5. 内容分发（mock 测试阶段）
6. 日小结/周总结/阶段回顾
7. 自进化：识别能力缺口并自主扩展（Skill + Agent）

## 2. 测试全景

### 对话日志（6 轮，~12 分钟）

| Turn | 用户消息（目标陈述） | Aida 动作 | 结果 |
|------|---------------------|-----------|------|
| 1 | "帮我建立 GEO 运营体系，包括门店咨询 bot" | 阅读 7 份 context 文档，查询 5 家门店，提出完整方案 | 识别 4 项 cron 任务 + 判定 bot 需独立 Agent |
| 2 | "方案认可，全权落地" | 创建 action-plan 实体 + geo-ops Skill + krypton-assistant Agent | 8 entities, 8 skills, 1 agent workspace |
| 3 | "带我检查建模成果" | 汇报实体/Skill/Agent/蓝图状态，解释为何不需要蓝图 | 清晰的 Dashboard 指引 |
| 4 | "开始今天的 GEO 工作" | 执行能见度模拟探测 + 内容生成 + 保存到 mock-publish | 1 文件，含 5 店 x 3 模型定制内容 |
| 5 | "同意发布，登记为 geo-content 实体" | 调用 bps_update_entity → 治理拦截 → 报告审批 | 1 violation, 1 pending approval |
| 6 | "审批完毕，做运营小结" | 结构化日报（监测/内容/治理/闭环） | 完整运营闭环 |

### 终态数据

| 指标 | 值 |
|------|-----|
| 实体总数 | 9（5 store + 2 knowledge + 1 action-plan + 1 geo-content） |
| Skills | 8（7 内置 + 1 动态 `geo-ops`） |
| Agent 工作区 | 1（`krypton-assistant`：IDENTITY + SOUL + AGENTS） |
| 蓝图 | 0（Aida 正确判断不需要） |
| 治理违规 | 2（均为 c-content-publish, HIGH） |
| 审批通过 | 1（replayToolCall 成功，entity v1 写入） |
| 熔断器 | NORMAL |
| Mock-publish | 1 文件（5 店 x 3 模型定制 GEO 内容） |
| Cron 任务 | 4（09:00 监测, 09:30 内容, 18:00 日报, 周五 15:00 周报） |

## 3. 能力评估

### 3.1 业务能力覆盖

| 业务能力要求 | 状态 | Aida 如何实现 | 评分 |
|-------------|------|-------------|------|
| 日能见度监测 | WORKING | 模拟 3 模型探测 + 评分体系（豆包 72/千问 60/元宝 85） | 9/10 |
| 深度洞察 + 战略 | WORKING | 识别各模型偏好差异，制定"一模一策"（场景化/结构化/FAQ） | 9/10 |
| 运营战术策略 | WORKING | action-plan 实体 + 4 项 cron 定时任务 | 8/10 |
| GEO 内容生成 | WORKING | 5 店 x 3 模型定制内容（门店描述/FAQ/场景故事），质量高 | 9/10 |
| 内容分发 | WORKING | 输出到 mock-publish，治理层把关发布 | 7/10 |
| 日/周总结 | WORKING | 结构化日报已验证；周报 cron 已注册（未触发） | 8/10 |
| 阶段回顾 | DESIGNED | action-plan 中有周期复盘项 | 6/10 |
| Skill 自创建 | WORKING | prospective gap → 创建 `geo-ops` Skill | 10/10 |
| Agent 自创建 | WORKING | persona isolation → 创建 `krypton-assistant` Agent | 10/10 |

**加权业务覆盖度：86%**（7 项 WORKING + 1 项 DESIGNED + 1 项未实际触发）

### 3.2 内容质量评估

Aida 生成的 `2026-03-07-content.md` 展现了高水平的业务理解：

**豆包专属内容**：生活化、场景化叙事（"周末逛街逛累了"、"社恐友好无推销"），精准命中豆包偏好。

**千问专属内容**：结构化数据卡片（门店名/位置/时间/设施/履约），精准命中千问偏好。

**元宝专属内容**：FAQ 问答格式（"怎么预订和开门？"），利用微信生态权重，精准命中元宝偏好。

所有内容遵守闲氪"真实、可信、可履约"三原则，引用真实门店数据（地址、设施、价格），未出现虚构信息。

### 3.3 Self-Evolution 评估

**这是本轮测试的核心新增验证项。**

| 能力 | 期望行为 | 实际行为 | 评价 |
|------|---------|---------|------|
| Skill gap 识别 | 建模时发现 GEO 运营无匹配 Skill | Turn 2 主动创建 `geo-ops` Skill | 完美 |
| Skill 质量 | 可执行的 SOP | 4 节规范（监测/内容/日报/周报），引用具体路径和原则 | 高质量 |
| Agent 需求识别 | 识别"门店咨询 bot"需独立 Agent | Turn 1 即判定需 Agent（命中 3 条件） | 完美 |
| Agent 理由 | 引用 Skill vs Agent 决策框架 | 明确提到"与管理风格不同"、"24h 并发"、"面向外部用户" | 精准 |
| Agent 创建 | 写入 workspace + config | workspace-krypton-assistant/（IDENTITY+SOUL+AGENTS），配置 minimal 权限 | 完整 |
| Agent 人格 | 匹配需求 | "亲切活泼"、用表情符号、知识边界清晰、超纲引导人工 | 高质量 |

**Self-Evolution 完成度：100%**（Skill 创建 + Agent 创建均一次通过）

## 4. 问题与差距

### Gap 1：内容发布默认走文件 I/O（严重度：MEDIUM）

**现象**：Turn 4 中 Aida 直接将内容写入 `~/.aida/mock-publish/` 文件，未通过 `bps_update_entity` → 治理层未触发。需用户在 Turn 5 明确要求"登记为 geo-content 实体"才走正规路径。

**影响**：首轮执行时治理层形同虚设。但 Aida 在 Turn 4 中自行设置了"审批请求"（文字层面），说明它理解需要人工确认，只是选错了实现路径。

**根因**：AGENTS.md Red Line 3（"禁止文件 I/O 绕过 governance"）针对的是"修改实体数据"，Aida 将 mock-publish 理解为"输出工件"而非"实体数据修改"。

**建议**：在 `geo-ops` Skill 或 AGENTS.md 中明确：**"所有待发布内容必须先创建/更新 geo-content 实体（触发治理审批），审批通过后再写入 mock-publish 文件"**。

**与 v1 对比**：相同问题，未因 Red Line 3 完全消除。需要在 Skill 级别而非全局规则级别约束。

### Gap 2：Dashboard SPA 页面 404（严重度：HIGH for deployment）

**现象**：所有 Dashboard 前端页面返回 404（`/`、`/business-goals`、`/governance` 等），但 API 端点正常工作。

**根因**：仓库扁平化后，`npm run build:dashboard`（Vite build）报错 "Could not resolve entry module client/index.html"。`vite.config.ts` 中的 `root: 'client'` 相对路径在新的 WorkingDirectory 下失效。

**影响**：Dashboard 只有 API 可用，可视化页面全部不可用。用户无法通过浏览器查看实体、审批、治理状态。

**修复建议**：调整 `npm run build:dashboard` 的 cwd 或 `vite.config.ts` 的 root 配置，使其在 aida 根目录运行时正确解析 `dashboard/client/index.html`。

### Gap 3：Entity API 响应格式（严重度：LOW）

**现象**：`/api/entities` 列表端点返回的对象中 `entityType`/`entityId` 嵌套在 `dossier` 子对象内，脚本直接访问 `e.entityType` 得到 undefined。

**影响**：仅影响自动化脚本，不影响 Dashboard 前端（前端知道数据结构）。

### Gap 4：install-aida.sh 路径兼容性（严重度：MEDIUM）

**现象**：`openclaw plugins install --link` 失败，因旧 config 中残留 `packages/bps-engine` 路径。需手动清理 `openclaw.json` 后重装。

**影响**：非干净环境的升级路径需要额外手动步骤。

**建议**：`install-aida.sh` Section 4 中增加清理旧 plugin 路径的逻辑。

## 5. 与 v1 对比

| 维度 | v1 (2026-03-06) | v2 (2026-03-07) | 变化 |
|------|-----------------|-----------------|------|
| 实体数 | 10 | 9 | -1（v2 合并了 strategy 到 action-plan） |
| Skill 创建 | 未测试 | geo-ops 创建成功 | NEW |
| Agent 创建 | 未测试 | krypton-assistant 创建成功 | NEW |
| 治理触发 | 自动触发 | 需提示后触发 | 退步（同一 Gap） |
| 内容质量 | 好 | 更好（有模型评分体系） | 提升 |
| 对话轮次 | 5 | 6 | +1（增加审批确认） |
| 对话风格 | 混合 | 全程目标陈述 | 提升 |
| Context 来源 | placeholder | 7 份真实文档 | 提升 |
| 蓝图 | 无 | 无（Aida 解释了原因） | 持平 |
| 日管理工作量 | ~15-30 min | ~15-30 min | 持平 |

## 6. 业务目标达成度评估

### "一个 GEO 负责人 + Aida 完成闲氪全部 GEO 运营任务" 评分卡

| 评估维度 | 权重 | 得分 | 说明 |
|----------|------|------|------|
| 业务理解深度 | 20% | 95 | 读透 7 份文档，输出"一模一策"，引用闲氪三原则 |
| 运营体系搭建 | 20% | 90 | action-plan + 4 cron + geo-ops Skill，完整闭环 |
| 内容生成质量 | 20% | 90 | 5 店 x 3 模型差异化内容，真实数据，无虚构 |
| 治理合规性 | 15% | 70 | 需提示才走正规审批路径，首轮默认绕过 |
| 自进化能力 | 15% | 100 | Skill + Agent 创建一次通过，决策理由精准 |
| 可观测性 | 10% | 50 | Dashboard API 可用但 SPA 页面 404 |

**加权总分：87/100**

### GEO 负责人日工作量估算

```
09:00  [Cron] Aida 自动执行能见度探测 + 分析 + 内容生成
       GEO 负责人无需介入
09:30  [Cron] Aida 生成内容 → 治理拦截 → 审批通知
       GEO 负责人：打开 Dashboard → 审核内容 → 批准/拒绝（~10 min）
18:00  [Cron] Aida 生成日报
       GEO 负责人：阅读日报 → 必要时调整策略（~5 min）
周五   [Cron] Aida 生成周报 + 战略复盘
       GEO 负责人：深度审阅 + 战略决策（~30 min）
```

**日均工作量：~15 分钟**（审核内容 + 阅读日报）
**周均额外工作量：~30 分钟**（周报审阅 + 战略调整）

## 7. 优先修复建议

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | Dashboard SPA 404 | 修复 Vite 构建路径 + systemd WorkingDirectory |
| P0 | 内容发布绕过治理 | geo-ops Skill 中明确"先创建 entity 再写文件"流程 |
| P1 | install-aida.sh 旧路径清理 | Section 4 增加 `plugins.load.paths` 清理逻辑 |
| P2 | Entity list API 格式 | 脚本侧适配 `e.dossier.entityType` 嵌套结构 |

## 8. 结论

Aida 在闲氪 GEO 场景下展现了**接近生产可用**的运营管理能力：

1. **业务理解**：深度消化 7 份闲氪文档，输出契合"三大原则"的差异化内容
2. **自进化**：首次验证 Skill vs Agent Decision 框架，Skill 创建和 Agent 创建均一次通过
3. **运营闭环**：探测 → 分析 → 内容 → 审批 → 发布 → 小结，端到端可运行
4. **治理**：ActionGate + 审批 + replayToolCall 机制完整，但需 Skill 级别的流程约束

**距离"一个人 + Aida 管 5 家店"的目标，主要 Gap 是：**
- 治理路径需要在 Skill/SOP 层面硬编码（而非依赖 Agent 自觉）
- Dashboard 可视化需要修复部署问题
- 真实能见度探测接口接入（当前为模拟数据）

修复 P0 后，系统可进入真实业务 pilot 阶段。

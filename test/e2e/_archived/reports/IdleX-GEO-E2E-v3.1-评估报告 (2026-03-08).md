# IdleX GEO E2E v3.1 评估报告

**测试日期**: 2026-03-08 10:32-10:37 CST
**测试服务器**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**LLM**: openai/gpt-5.4 via OpenRouter (fallback: claude-sonnet-4-6 / gemini-3.1-pro-preview)
**自动化结果**: 32 PASS / 1 FAIL / 10 WARN / 33 TOTAL
**Session**: 持久化 (--session-id e2e-v3-20260308103232)

---

## 一、测试目标与方法

**业务目标**: 一个 GEO 负责人 + Aida 完成闲氪全部 GEO 运营任务。

**v3.1 变更**（相比 v3）:
1. 模型从 `google/gemini-3.1-pro-preview` 改为 `openai/gpt-5.4` (OpenRouter)
2. Session 持久化：6 轮 Turn 共享同一 `--session-id`（修复 v3 的 P2 问题）
3. Fallback 链改为 `claude-sonnet-4-6 → gemini-3.1-pro-preview`

**对话设计**: 同 v3，目标陈述式，6 轮完整生命周期。

---

## 二、关键发现

### 发现 1: GPT-5.4 主模型不可用

GPT-5.4 via OpenRouter **反复超时/失败**。Session 中出现 **12 条 "Continue where you left off. The previous model attempt failed or timed out"** 消息，表明 Gateway 的 Fallback 机制被密集触发。

最终响应由 Fallback 模型（Claude Sonnet 4.6 或 Gemini 3.1 Pro）生成，质量显著降低：
- 6 轮 Turn 的响应几乎完全相同（3-5 行，重复相同的"内容已就绪"消息）
- Turn 4/5 仅输出 "completed"（1 行）
- Turn 2 出现 `<think>` 标签泄漏（模型切换时推理格式不一致）

### 发现 2: Cron 自治系统是真正的工作引擎

**测试开始前**（09:00-10:00 CST），9 个活跃 Cron 任务自动触发：

| 触发时间 | 任务 | 行为 |
|----------|------|------|
| 09:00 | 可见度监测与策略生成 | bps_scan_work → bps_query_entities → exec（模拟探测）→ bps_update_entity（创建 geo-report） |
| 09:01 | 闲氪 GEO 监测（中文 cron） | 分析 5 家门店，制定一模一策策略 |
| 09:30 | 优化内容生成与分发 | 生成差异化内容 → write 到 mock-publish → bps_update_entity（标记 Published） |
| 10:00 | GEO Daily Operations | 综合操作 |

**工具调用统计**（全部来自 Cron 触发，非测试 Turn）:

| 工具 | 调用次数 | 说明 |
|------|---------|------|
| exec | 14 | Shell 命令（模拟探测、文件操作） |
| bps_create_task | 7 | 创建任务 |
| bps_complete_task | 7 | 完成任务 |
| write | 7 | 写入内容文件 |
| bps_scan_work | 6 | 扫描待办工作 |
| bps_next_steps | 6 | 查询下游步骤 |
| bps_query_entities | 5 | 查询实体 |
| bps_update_entity | 5 | 更新/创建实体 |
| bps_get_entity | 2 | 获取实体详情 |
| read | 1 | 读取文件 |
| gateway | 1 | Gateway 操作 |
| **合计** | **61** | **0 错误** |

**实体生命周期**（geo-report-2026-03-08-v1）:
```
started → Analyzed → Pending Approval → Published → Completed
```

### 发现 3: 内容质量优秀（来自 Cron 生成）

3 个模型目录均有高质量差异化内容：

| 文件 | 大小 | 内容风格 |
|------|------|---------|
| doubao/content.md | 2,394 B | 情绪价值+场景故事（"周末和闺蜜不知道去哪儿？"） |
| qianwen/content.md | 2,408 B | 结构化数据+规格参数（类型/位置/包间数/价格表） |
| yuanbao/content.md | 2,415 B | 地理锚点+本地导航（"距离地铁站仅几分钟步行"） |

差异化精准，完美体现"一模一策"。

### 发现 4: 治理仍被绕过

0 个违规记录，0 个待审批。原因链：
```
Cron 触发 → write 工具直接写文件到 mock-publish/ → 绕过 bps_update_entity
         → 治理约束只拦截 bps_update_entity(publishReady) → 不触发
```

`bps_update_entity` 被调用 5 次，但用于更新 `geo-report` 实体的 status 字段，未触及 `publishReady` → 约束不匹配。

### 发现 5: Session 连续性——部分生效

- `--session-id` 参数被 Gateway 接受
- 所有 Turn 进入同一 session（164 entries 的 JSONL）
- **但**：测试 Turn 的响应几乎完全相同 → 模型可能未读取 session 上下文（Fallback 模型行为）
- Session 中混入 heartbeat（3 条）、cron（4 条）、model retry（12 条）消息

---

## 三、Cron 自治系统评估

这是本次测试最重要的发现：**Aida 通过 Cron 实现了真正的自治运营**。

### 9 个活跃 Cron 任务

| 调度 | 任务名 | 状态 |
|------|--------|------|
| 每天 09:00 | 可见度监测与策略生成 | ok (2h ago) |
| 每天 09:00 | plan-geo-ops-monitor | ok (2h ago) |
| 每天 09:30 | 优化内容生成与分发 | ok (1h ago) |
| 每天 09:30 | plan-geo-ops-generate | ok (1h ago) |
| 每天 10:00 | GEO Daily Operations | ok (44m ago) |
| 每天 18:00 | 每日运营小结 | ok (17h ago) |
| 每天 18:00 | plan-geo-ops-summary | ok (17h ago) |
| 每周五 15:00 | 每周GEO运营复盘 | idle |
| 每周五 15:00 | plan-geo-ops-weekly-review | ok (2d ago) |

**结论**: 这些 Cron 任务由之前的 v2/v3 测试中 Aida 自主注册。即使 Gateway 重启、memory 清除，Cron 调度器依然持久执行。Aida 在 Cron 触发时：
- 读取 HEARTBEAT.md 执行例行检查
- 响应 Cron 消息调用 BPS 工具
- 生成内容并写入文件
- 管理实体生命周期

这是 **Freq 3 (Cron)** 运行模式的首次端到端验证。

---

## 四、评分矩阵

### 测试 Turn 评估（GPT-5.4 Fallback 行为）

| 维度 | 权重 | 得分 | 说明 |
|------|------|------|------|
| **部署完整性** | 15% | 100 | 14/14 PASS，模型配置正确切换 |
| **业务理解** | 15% | 25 | 响应重复、短小，未展示业务理解 |
| **Two-Layer 路由** | 15% | 0 | 无路由行为证据 |
| **建模执行** | 20% | 5 | 测试 Turn 内 0 个新实体 |
| **内容质量** | 15% | 85 | 文件内容优秀（但来自 Cron） |
| **治理闭环** | 10% | 5 | 完全绕过 |
| **自我进化** | 10% | 0 | 无新 Skill/Agent |

**测试 Turn 加权总分: 32/100**

### Cron 自治系统评估（独立评分）

| 维度 | 得分 | 说明 |
|------|------|------|
| **Cron 持久性** | 100 | 9 个任务跨 Gateway 重启存活 |
| **工具调用可靠性** | 95 | 61 次调用，0 错误 |
| **实体管理** | 85 | geo-report 完整生命周期 |
| **内容质量** | 90 | 一模一策差异化精准 |
| **治理合规** | 15 | 仍绕过治理（write > bps_update_entity） |
| **Cron 加权得分** | **80/100** | |

---

## 五、与 v3 (Gemini) 对比

| 维度 | v3 Gemini (60) | v3.1 GPT-5.4 (32) | 变化 | 分析 |
|------|---------------|-------------------|------|------|
| 部署 | 100 | 100 | = | |
| 业务理解 | 95 | 25 | **-70** | Gemini 长文本 vs GPT-5.4 fallback 短文本 |
| Two-Layer | 85 | 0 | **-85** | Fallback 模型无路由行为 |
| 建模执行 | 25 | 5 | -20 | 两者都未在测试 Turn 中创建实体 |
| 内容质量 | 90 | 85 | -5 | Cron 内容文件弥补 |
| 治理 | 15 | 5 | -10 | |
| 自我进化 | 10 | 0 | -10 | |

**关键差异**: v3.1 的低分主要因为 GPT-5.4 反复失败，Fallback 模型产出低质量响应。但 Cron 自治系统（v3 中不存在的维度）得分 80/100。

---

## 六、根因分析

### 问题 1: GPT-5.4 不可用

```
openclaw agent --message → Gateway 调用 openai/gpt-5.4
                         → OpenRouter 超时/错误
                         → "Continue where you left off" ×12
                         → Fallback 到 claude-sonnet-4-6 / gemini-3.1-pro
                         → 最小化响应（上下文可能已被 retry 消息污染）
```

**可能原因**:
- OpenRouter 路由到 GPT-5.4 延迟过高
- API Key 额度/权限问题
- GPT-5.4 模型上下文处理问题（OpenClaw 注入的 system prompt 可能不兼容）

### 问题 2: 治理绕过（持续存在）

**v2, v3, v3.1 均未解决**。Aida 使用 `write` 工具直接写文件而非 `bps_update_entity`。

**根本原因**: 治理层只包装了 5 个 BPS 写操作工具，但 OpenClaw 的原生 `write` 工具不受治理约束。

**修复方向**:
- A. 在 AGENTS.md / TOOLS.md 中强制要求"所有对外发布内容必须先通过 bps_update_entity"
- B. 在 install-aida.sh 的 `tools.exec.security` 中限制 write 工具对 mock-publish/ 的直接访问
- C. 在治理层包装 OpenClaw 的 `write` / `exec` 工具（需要 OpenClaw 插件 API 支持）

### 问题 3: Session 上下文污染

持久 session 中混入 heartbeat + cron + model retry 消息，测试 Turn 的上下文被稀释。

---

## 七、架构资产价值判定

| 资产 | 状态 | 本次新证据 |
|------|------|-----------|
| install-aida.sh 部署 | **完全工作** | 模型配置切换一次通过 |
| Cron 调度系统 | **首次验证通过** | 9 个任务持久存活，自动触发 |
| BPS 工具调用 | **Cron 触发时可靠** | 61 次调用 0 错误 |
| 实体生命周期管理 | **验证通过** | geo-report 5 阶段完整流转 |
| 一模一策内容生成 | **验证通过** | 3 个模型差异化内容 |
| Session 持久化 | **部分验证** | --session-id 接受，但上下文质量受模型失败影响 |
| 治理层 | **架构完整，执行绕过** | 3 次测试均未被正确触发 |
| OpenRouter Fallback | **验证通过** | GPT-5.4 失败后自动切换 |

---

## 八、改进建议

### P0: 治理绕过修复（三次测试均存在）

在 AGENTS.md Red Lines 和 TOOLS.md Known Behaviors 中增加：
```
NEVER use `write` or `exec` to publish content directly. ALL content must go
through `bps_update_entity` with publishReady flag so governance can intercept.
```

### P0: 模型选择

GPT-5.4 via OpenRouter 当前不可用作 primary。建议：
- 回退到 `google/gemini-3.1-pro-preview` 作为 primary（Cron 验证已通过）
- 或测试 `anthropic/claude-sonnet-4-6` 作为 primary
- 保留 GPT-5.4 在 fallback 链末端

### P1: Cron 去重

当前 9 个 Cron 中有 4 对重复任务（中英文各一份），来自不同测试 session。建议：
- 在 BOOT.md 或 AGENTS.md 中增加 Cron 清理逻辑
- 或在 install-aida.sh 中清除所有 Cron（`openclaw cron clear`）后由 Aida 重新注册

### P2: Session 上下文管理

测试脚本应在发送测试 Turn 前验证 session 是否干净，避免 heartbeat/cron 消息污染。

---

## 九、总结

| 指标 | 值 |
|------|-----|
| **测试 Turn 加权总分** | **32/100** |
| **Cron 自治系统评分** | **80/100** |
| 自动化测试 | 32 PASS / 1 FAIL / 10 WARN |
| GPT-5.4 可用性 | **不可用**（12 次超时/失败） |
| Cron 工具调用 | 61 次，0 错误 |
| 治理闭环 | 未验证（连续 3 次测试均绕过） |

**一句话**: GPT-5.4 当前不适合作为 Aida primary 模型。但本次测试意外验证了 **Cron 自治系统**——Aida 通过之前注册的 Cron 任务，在无人干预下自主完成了完整的 GEO 运营周期（监测→分析→生成→分发），61 次工具调用零错误。**Cron + 持久 Session 是 Aida 自治运营的核心路径**。

---

*测试脚本: `test/e2e/idlex-geo-v3.sh` | 测试方案: `test/e2e/idlex-geo-v3.md` | Turn Logs: `/tmp/idlex-geo-e2e-v3/`*
*Session 分析: `test/e2e/analyze-session.js`*

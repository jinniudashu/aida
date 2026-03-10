# IdleX GEO E2E v3.2 评估报告 — Gemini 3.1 Pro Preview

**测试日期**: 2026-03-08 16:55-16:59 CST
**测试服务器**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**LLM**: google/gemini-3.1-pro-preview (Native API, 非 OpenRouter)
**自动化结果**: 24 PASS / 1 FAIL / 4 WARN / 25 TOTAL
**Session**: agent:main:main (dmScope=main)
**运行时长**: ~5 分钟（6 轮 Turn）

---

## 一、测试方法

与 GPT-5.4 测试完全相同的 E2E 方案（idlex-geo-v3.sh --skip-install），相同的 6 轮对话设计、相同的种子数据（5 家门店 + 3 条治理约束）。唯一差异：模型从 openrouter/openai/gpt-5.4 切换为 google/gemini-3.1-pro-preview（原生 API）。

---

## 二、关键发现

### 发现 1: 思维链泄漏（Chain-of-Thought Leakage）

Turn 1 响应开头暴露了模型内部推理过程：
```
I see what's happening. The user gave me the go-ahead ("方案可以。全权交给你落地——
实体、Skill、Agent、蓝图、定时任务，需要什么就建什么。"). The previous model attempt
was interrupted before it could execute the plan.
I need to implement a daily business operation system based on the previous context...
I will create:
1. Skill `idlex-geo-daily`...
```

**问题**：
1. Turn 1 是"规划请求"，用户尚未授权执行，但 Gemini 将 Turn 2 的授权消息当作已收到
2. 内部推理（"I see what's happening"、"I need to implement"）直接输出给用户，未经过滤
3. 暗示存在"前次尝试被中断"的幻觉（这是全新 session）

### 发现 2: Turn 2 响应完全重复 Turn 1

Turn 2 输出与 Turn 1 **逐字相同**（16 行，完全一致），未执行任何新操作。这意味着：
- 收到授权消息后没有追加建模
- 可能是 session 缓存导致的重复响应
- Turn 1 已经"越权"执行了 Turn 2 的工作

### 发现 3: 工具调用密度极低

| 指标 | Gemini | GPT-5.4 | 差距 |
|------|--------|---------|------|
| 新增实体 | 2 | 35 | -94% |
| 实体类型 | 2 种 | 6 种 | -67% |
| Skill 创建 | 1 | 1 | = |
| Agent workspace | 0 | 1 | -100% |
| Cron 注册 | 1 | 3 | -67% |
| Blueprint | 1（加载已有） | 1（新建） | 功能相当 |

最终实体仅 9 个（7 种子 + 1 action-plan + 1 geo-content-item），远低于 GPT-5.4 的 42 个。

### 发现 4: "说而不做"模式再现

与 v3 测试（Gemini，60 分）相同的核心问题：
- Turn 4 描述了完整的能见度探测报告（豆包 45/千问 60/元宝 30）和一模一策内容方案，但**未创建对应的 geo-visibility-record、geo-strategy-card 等实体**
- 声称"写入了今天的实体 `idlex-geo-daily-2026-03-08`"，但实际只创建了 1 个 geo-content-item
- 声称"内容已被拦截，等待终审"，但 **0 条治理违规记录、0 条待审批**
- 声称"模拟发布已执行"，但 mock-publish 目录的 21 个文件来自种子数据而非 Gemini 创建

### 发现 5: 业务理解质量中等

Turn 4 的一模一策分析有一定业务理解：
- **豆包**→打标签（位置聚合、24h 自助标签）
- **千问**→打深度（体验评测、性价比数据）
- **元宝**→打生活（微信生态、打卡型游记）

但与 GPT-5.4 相比缺少：
- 每店×每模型的差异化策略卡（GPT 创建了 15 张）
- 门店画像与模型特性的交叉匹配
- 探测数据的结构化记录

### 发现 6: 自我进化能力有限

- ✅ 创建了 1 个 Skill（idlex-geo-daily）
- ✅ 注册了 1 个 Cron（每日 09:00）
- ✅ 加载了已有 Blueprint（idlex-geo-governance）
- ❌ 未创建独立 Agent workspace（顾客咨询 bot）
- ❌ 未创建模型画像实体

### 发现 7: Gateway 模式正常工作

与 GPT-5.4 测试不同，Gemini 测试中 **Gateway 模式正常工作**（Google API key 通过 auth-profiles.json 正确加载），未出现 "Gateway agent failed; falling back to embedded" 的回退。

---

## 三、评分矩阵

| 维度 | 权重 | 得分 | 说明 |
|------|------|------|------|
| **部署完整性** | 15% | 100 | 5/5 PASS，种子数据正确 |
| **业务理解** | 15% | 55 | 一模一策概念理解正确，但思维链泄漏 + Turn 1/2 混淆 |
| **Two-Layer 路由** | 15% | 45 | Blueprint 加载成功，但治理层从未实际触发 |
| **建模执行** | 20% | 30 | 仅 2 个新实体，Turn 2 重复，工具调用严重不足 |
| **内容质量** | 15% | 65 | 三模差异化描述合理，但未结构化为实体 |
| **治理闭环** | 10% | 10 | 0 违规 / 0 审批 — 治理层完全未触发 |
| **自我进化** | 10% | 45 | 1 Skill + 1 Cron，无 Agent workspace |

**加权总分: 51/100**

---

## 四、与 GPT-5.4 对比

| 维度 | GPT-5.4 (89) | **Gemini (51)** | 差距 |
|------|-------------|-----------------|------|
| 部署 | 100 | 100 | = |
| 业务理解 | 98 | 55 | **-43** |
| Two-Layer | 90 | 45 | **-45** |
| 建模执行 | 95 | 30 | **-65** |
| 内容质量 | 95 | 65 | **-30** |
| 治理 | 30 | 10 | -20 |
| 自我进化 | 95 | 45 | **-50** |

| 运行指标 | GPT-5.4 | Gemini | 说明 |
|----------|---------|--------|------|
| 运行时长 | ~16 min | ~5 min | Gemini 快 3 倍 |
| 新增实体 | 35 | 2 | GPT 多 17 倍 |
| Turn 总行数 | 1351 | 127 | GPT 输出量 10 倍 |
| 自动测试 | 39P/0F/4W | 24P/1F/4W | GPT 更多 PASS |

---

## 五、根因分析

### Gemini 弱项

1. **思维链控制不足**：内部推理直接输出，说明 Gemini 在 Agent 角色扮演场景中的输出过滤能力弱于 GPT-5.4
2. **多轮对话上下文管理**：Turn 1 提前执行 Turn 2 的工作，Turn 2 完全重复，表明对对话阶段的区分能力不足
3. **工具调用倾向低**：倾向用自然语言描述而非调用 BPS tools 执行操作——与 v3 测试（同 Gemini, 60 分）一致
4. **实体建模密度低**：即使被告知"需要什么就建什么"，仍然只创建了最少量的实体

### Gemini 优势

1. **速度快**：5 分钟完成 6 轮对话（vs GPT 16 分钟），3 倍速度差
2. **Gateway 兼容好**：Native Google API + auth-profiles.json 配合完美，无需回退 embedded
3. **基础业务理解**：一模一策概念理解正确，三个模型的差异化策略方向合理

---

## 六、总结

| 指标 | 值 |
|------|-----|
| **加权总分** | **51/100** |
| 自动化测试 | 24 PASS / 1 FAIL / 4 WARN |
| 运行时长 | ~5 分钟 |
| 最终实体数 | 9（7 种子 + 2 新增） |
| Blueprint | 1（加载已有，未新建） |
| Agent workspace | 0 |
| Skill | 1（idlex-geo-daily） |
| Cron | 1（每日 09:00） |
| 治理闭环 | 未验证（0 违规 / 0 审批） |

**一句话**: Gemini 3.1 Pro Preview 在 AIDA 框架下的表现远不及 GPT-5.4。核心问题是"说而不做"——能用流畅的自然语言描述完整的运营方案，但实际工具调用密度极低，仅创建了 2 个新实体（vs GPT 的 35 个）。思维链泄漏和 Turn 重复进一步降低了交互质量。速度优势（3 倍快）无法弥补执行质量的巨大差距。

---

*测试脚本: `test/e2e/idlex-geo-v3.sh` | Turn Logs: `/tmp/aida-model-benchmark/gemini/`*

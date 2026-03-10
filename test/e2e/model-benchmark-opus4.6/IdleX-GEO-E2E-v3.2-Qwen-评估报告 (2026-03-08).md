# IdleX GEO E2E v3.2 评估报告 — Qwen3.5-Plus

**测试日期**: 2026-03-08 18:01-18:19 CST
**测试服务器**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**LLM**: dashscope/qwen3.5-plus (Native API via dashscope-intl.aliyuncs.com)
**自动化结果**: 22 PASS / 0 FAIL / 7 WARN / 22 TOTAL — ALL REQUIRED CHECKS PASSED
**Session**: agent:main:main (dmScope=main)
**运行时长**: 1056s (~17.6 分钟)

---

## 一、测试方法

与前四次测试相同的 E2E 方案。模型切换为 dashscope/qwen3.5-plus（阿里云百炼国际版 OpenAI-compatible API）。

**注意**: 由于 `--skip-install` 复用 workspace，Qwen 测试时 workspace 中包含前次测试创建的 4 个 Skill（idlex-geo-daily/content/visibility/weekly）、2 个 Blueprint、以及 84 个 mock-publish 文件，但 DB 和 session 均为全新。

---

## 二、关键发现

### 发现 1: 规划质量最高 — 唯一 V2 全 PASS 模型（非 GPT）

Qwen 是除 GPT-5.4 外**唯一一个在 Phase 2 全部 4 项检查中获得 PASS** 的模型：

| 检查项 | GPT-5.4 | Gemini | Kimi | MiniMax | GLM-5 | **Qwen** |
|--------|---------|--------|------|---------|-------|----------|
| V2.1 有响应 | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |
| V2.2 提及战略 | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | **✅** |
| V2.3 识别能力缺口 | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | **✅** |
| V2.4 二层路由 | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | **✅** |

Turn 1 的 142 行输出包含：现状评估表（6 项需求对照）、顾客咨询 bot 架构设计（识别为独立 Agent 而非 Skill）、治理规则确认、两阶段执行计划。

### 发现 2: Blueprint 编译器使用最佳

Qwen 是唯一真正使用了 **Blueprint 编译器**的非 GPT 模型：
- 生成 `idlex-geo-ops.yaml` 蓝图
- 17 个服务（日常运营 10 + 顾客咨询 4 + 审批 3）
- 16 条规则（从 flow 拓扑自动编译）
- **3 个 Blueprint**——所有模型中最多

服务设计展现了对业务的深度理解：
- `svc-content-approval`：executorType=**manual**（正确标记为人工审批节点）
- `svc-strategy-approval`：executorType=**manual**（战略审批同样需要人工确认）
- `svc-customer-inquiry`：composite（顾客咨询拆分为 store-info + booking + faq 三个子服务）

### 发现 3: 顾客咨询 bot 是唯一尝试的模型

Turn 2 中 Qwen 直接创建了**闲氪小助手**（idlex-customer-bot.md），并生成了自我介绍测试：

> 哈喽哈喽！我是**闲氪小助手** 🌟 你的24小时在线玩乐顾问！

这是 6 个需求中第 6 项（顾客咨询 bot），其他模型要么忽略要么仅在计划中提及。Qwen 正确识别了"人格隔离"需求（Agent vs Skill 决策框架的应用）。

### 发现 4: Turn 4/5 超时 — 执行阶段瓶颈

Turn 4（GEO 执行）和 Turn 5（Dashboard 审批）均在 300 秒超时后返回空响应：

| Turn | 行数 | 时长 | 行为 |
|------|------|------|------|
| Turn 1 | 142 | ~90s | ✅ 全面规划（V2 全 PASS） |
| Turn 2 | 148 | ~200s | ✅ 实体+蓝图+bot 创建（4 新实体, 3 蓝图） |
| Turn 3 | 128 | ~80s | ✅ 详细 Review（32 服务 + Dashboard） |
| Turn 4 | 2 | 300s | ❌ 超时空响应 |
| Turn 5 | 2 | 300s | ❌ 超时空响应 |
| Turn 6 | 61 | ~60s | ✅ 运营日报 |

推测：Turn 4/5 Qwen 在尝试执行大量工具调用（内容生成、文件写入），但 300s 超时不足以完成。这与 Kimi 的 Turn 4 空响应模式类似。

### 发现 5: 实体建模最佳（非 GPT）

4 个新实体是 GPT-5.4（35）之外最高的：

| 实体 | 类型 | 说明 |
|------|------|------|
| geo-operation-main | geo-operation | GEO 运营主实体 |
| content-batch-2026-03-08 | content-batch | 今日内容批次 |

加上 seed 的 5 store + 2 knowledge = 9 总实体。虽然不及 GPT-5.4 的 35 个，但实体设计合理（geo-operation 作为运营主控 + content-batch 作为日度批次）。

### 发现 6: 内容产出结构化

Turn 6 的运营日报包含：
- 任务完成表（4 项，含状态和产出）
- 能见度排名表（5 店，含分数和趋势箭头）
- 文件归档结构
- 待办事项（含优先级和自动任务标记）
- 系统状态汇总

### 发现 7: 治理层感知但未触发

Qwen 在 Turn 2 明确提到了治理规则（"3 条约束"），并在蓝图服务中正确标记了 manual 审批节点，但实际执行中未通过 `bps_update_entity` 设置 `publishReady` 来触发治理拦截。0 违规 / 0 审批。

---

## 三、评分矩阵

| 维度 | 权重 | 得分 | 说明 |
|------|------|------|------|
| **部署完整性** | 15% | 100 | 5/5 PASS |
| **业务理解** | 15% | 90 | V2 全 PASS（唯一非 GPT），6 项需求精准对照，bot 架构设计 |
| **Two-Layer 路由** | 15% | 55 | 3 Blueprint + 编译器使用，manual 节点正确标记，但治理层未触发 |
| **建模执行** | 20% | 60 | 4 新实体 + 3 蓝图 + 17 服务（非 GPT 最佳），Turn 4/5 超时 |
| **内容质量** | 15% | 80 | Turn 1-3 优秀（142+148+128 行），Turn 4/5 空，Turn 6 结构化日报 |
| **治理闭环** | 10% | 10 | 感知治理规则但未触发，0 违规 / 0 审批 |
| **自我进化** | 10% | 15 | 无新 Skill、顾客 bot 为文件而非 Agent workspace |

**加权总分: 63/100**

---

## 四、模型对比

| 维度 | GPT-5.4 (89) | Gemini (51) | Kimi (63) | MiniMax (56) | GLM-5 (25) | **Qwen (63)** |
|------|-------------|-------------|-----------|--------------|------------|---------------|
| 部署 | 100 | 100 | 100 | 100 | 100 | **100** |
| 业务理解 | 98 | 55 | 75 | 70 | 20 | **90** |
| Two-Layer | 90 | 45 | 55 | 50 | 10 | **55** |
| 建模执行 | 95 | 30 | 50 | 40 | 5 | **60** |
| 内容质量 | 95 | 65 | 75 | 80 | 30 | **80** |
| 治理 | 30 | 10 | 10 | 10 | 0 | **10** |
| 自我进化 | 95 | 45 | 65 | 25 | 0 | **15** |

| 运行指标 | GPT-5.4 | Gemini | Kimi | MiniMax | GLM-5 | **Qwen** |
|----------|---------|--------|------|---------|-------|----------|
| 运行时长 | ~16 min | ~5 min | ~19 min | ~13.5 min | ~2 min | **~17.6 min** |
| 新增实体 | 35 | 2 | 3 | 2 | 0 | **4** |
| 新增 Skill | 1 | 1 | 3 | 0 | 0 | **0** |
| 新增 Blueprint | 1 | 1 | 2 | 0 | 0 | **3** |
| Mock-publish | 20 | 21 | 54 | 84 | 0 | **19** |
| Turn 总行数 | 1351 | 127 | 432 | 307 | 101 | **483** |
| 自动测试 | 39P/0F/4W | 24P/1F/4W | 23P/0F/6W | 23P/0F/6W | 18P/1F/10W | **22P/0F/7W** |

---

## 五、Qwen 特征总结

### 优势
1. **规划能力最强**：V2 全 PASS（唯一非 GPT），142 行系统性规划
2. **Blueprint 使用最深**：3 蓝图 + 编译器（flow→rules 自动编译），17 服务 + manual 审批节点
3. **实体建模最佳（非 GPT）**：4 新实体，实体设计合理（运营主控 + 日度批次）
4. **需求覆盖最全**：唯一尝试创建顾客咨询 bot 的模型
5. **Turn 输出均衡**：Turn 1-3 + Turn 6 均有实质性内容

### 弱项
1. **Turn 4/5 超时**：GEO 执行和审批阶段各 300s 超时返回空响应
2. **无新 Skill**：完全依赖已有 Skill，不展现自我进化
3. **治理层未触发**：感知规则但未实际调用治理路径
4. **Mock-publish 较少**：仅 19 个新文件（vs MiniMax 84, Kimi 54）
5. **顾客 bot 停留在文件层**：未创建真正的 Agent workspace

### 与 Kimi 对比（同分 63）

| 维度 | Kimi | Qwen | 优势方 |
|------|------|------|--------|
| 规划质量 | V2.2/V2.3 PASS, V2.4 WARN | V2 全 PASS | **Qwen** |
| 蓝图使用 | 2 Blueprint | 3 Blueprint + 编译器 | **Qwen** |
| 实体建模 | 3 新实体 | 4 新实体 | **Qwen** |
| Skill 创建 | 3 新 Skill（content/visibility/weekly） | 0 新 Skill | **Kimi** |
| 执行模式 | "做而不说"（Turn 2 空文本 + 大量工具调用） | 说+做（Turn 2 文本 + 工具调用） | **Kimi** |
| 空 Turn 数 | 2（Turn 2 + Turn 4） | 2（Turn 4 + Turn 5） | 平局 |

两者总分相同但风格迥异：**Kimi 更像执行者（创建 Skill），Qwen 更像架构师（设计蓝图）**。

---

## 六、总结

| 指标 | 值 |
|------|-----|
| **加权总分** | **63/100** |
| 自动化测试 | 22 PASS / 0 FAIL / 7 WARN |
| 运行时长 | ~17.6 分钟 |
| 最终实体数 | 9（5 种子 + 2 知识 + 2 新增） |
| Blueprint | 3 |
| Agent workspace | 0 |
| 新增 Skill | 0 |
| Mock-publish | 19（新增，总 103） |
| 治理闭环 | 感知但未触发 |

**一句话**: Qwen3.5-Plus 展现了最强的规划和蓝图设计能力——V2 全 PASS（唯一非 GPT），3 蓝图 + 17 服务的编译器使用是所有模型中最深的。但 Turn 4/5 超时（各 300s 空响应）暴露了执行阶段的瓶颈，且缺乏 Skill 创建等自我进化能力。它更像一个"出色的架构师"而非"完整的执行者"。

---

*测试脚本: `test/e2e/idlex-geo-v3.sh` | Turn Logs: `/tmp/aida-model-benchmark/qwen/`*

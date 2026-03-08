# IdleX GEO E2E v3.2 评估报告 — Kimi K2.5

**测试日期**: 2026-03-08 17:16-17:35 CST
**测试服务器**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**LLM**: moonshot/kimi-k2.5 (Native API via api.moonshot.ai)
**自动化结果**: 23 PASS / 0 FAIL / 6 WARN / 23 TOTAL — ALL REQUIRED CHECKS PASSED
**Session**: agent:main:main (dmScope=main)
**运行时长**: 1120s (~19 分钟)

---

## 一、测试方法

与 GPT-5.4 / Gemini 测试完全相同的 E2E 方案。唯一差异：模型切换为 moonshot/kimi-k2.5（Moonshot 原生 API）。

---

## 二、关键发现

### 发现 1: "做而不说"模式 — 与 Gemini 正好相反

Kimi 在 Turn 2（建模执行）和 Turn 4（GEO 执行）中表现出独特的行为模式：

| Turn | 文本输出 | 工具调用 | 说明 |
|------|---------|---------|------|
| Turn 1 | 125 行 | 少量 | 详细规划（含架构图、门店表、分层设计） |
| Turn 2 | **2 行**（空） | **大量** | 创建 2 实体 + 3 Skill + 2 Blueprint + Cron |
| Turn 3 | 165 行 | 查询 | 详尽的 Review（服务表 + Cron 表 + 实体表） |
| Turn 4 | **2 行**（空） | 未知 | 未实际执行 GEO 探测 |
| Turn 5 | 18 行 | 少量 | 审批确认 |
| Turn 6 | 92 行 | 查询 | 详细日报（含门店评分、内容统计） |

Turn 2 的"空文本 + 大量工具调用"是理想的 Agent 行为——专注执行而非描述。这与 Gemini 的"大量描述 + 少量执行"形成鲜明对比。

### 发现 2: Skill 创建密度高

Kimi 在单轮（Turn 2）中创建了 **3 个新 Skill**：
- `idlex-geo-content`：GEO 内容生成
- `idlex-geo-visibility`：能见度探测
- `idlex-geo-weekly`：周度复盘

加上已有的 `idlex-geo-daily`，共 4 个 GEO 运营专用 Skill。这是所有测试模型中最高的 Skill 创建密度。

### 发现 3: Blueprint 利用率高

创建并加载了 2 个 Blueprint（vs Gemini 1 个、GPT-5.4 1 个），表明对治理层概念的理解更深入。

### 发现 4: 实体创建中等

3 个新实体（2 content + 1 geo-operation），优于 Gemini（2 个）但远低于 GPT-5.4（35 个）。缺少关键实体类型：
- ❌ action-plan（WARN V3.2）
- ❌ geo-strategy / strategy（WARN V3.3）
- ❌ geo-model（模型画像）
- ❌ geo-strategy-card（策略卡）

### 发现 5: Mock-publish 文件数最高

54 个 mock-publish 文件（vs GPT-5.4 的 20 个、Gemini 的 21 个），说明 Kimi 在文件 I/O 操作上更积极。但这些文件通过 `exec/write` 工具创建，绕过了治理层。

### 发现 6: Turn 3 Review 质量优秀

165 行的 Review 包含：
- 服务表（svc-geo-daily, svc-geo-weekly, svc-content-ready, svc-strategy-review）
- 15 个 Cron 定时任务清单
- 实体统计
- 待审批任务详情（Task ID + 审批截止时间）
- Dashboard 引导

### 发现 7: Turn 6 日报结构化

92 行的运营日报包含：
- 5 项完成任务总表
- 能见度评分数据（系统平均 76.5 分，最佳门店 83 分）
- 内容生产统计（30 份，通过率 100%）
- 模型分布（豆包/千问/元宝各 10 份）

但这些数据是**描述性的**（未从实际实体中提取），而非来自真实的探测记录。

### 发现 8: 治理层未触发

与所有模型一致：0 违规 / 0 审批。Kimi 没有通过 `bps_update_entity` 设置 `publishReady` 标记来触发治理约束。

---

## 三、评分矩阵

| 维度 | 权重 | 得分 | 说明 |
|------|------|------|------|
| **部署完整性** | 15% | 100 | 5/5 PASS |
| **业务理解** | 15% | 75 | Turn 1 详细（125 行），架构图 + 门店表 + 分层设计 |
| **Two-Layer 路由** | 15% | 55 | 2 Blueprint 加载/创建，但治理层未触发 |
| **建模执行** | 20% | 50 | 3 新实体 + 3 新 Skill + 2 Blueprint，"做而不说"模式好 |
| **内容质量** | 15% | 75 | Turn 6 日报 92 行，结构化评分数据，但数据非实测 |
| **治理闭环** | 10% | 10 | 0 违规 / 0 审批 |
| **自我进化** | 10% | 65 | 3 新 Skill（content/visibility/weekly），无 Agent workspace |

**加权总分: 63/100**

---

## 四、模型对比

| 维度 | GPT-5.4 (89) | Gemini (51) | **Kimi (63)** |
|------|-------------|-------------|---------------|
| 部署 | 100 | 100 | 100 |
| 业务理解 | 98 | 55 | **75** |
| Two-Layer | 90 | 45 | **55** |
| 建模执行 | 95 | 30 | **50** |
| 内容质量 | 95 | 65 | **75** |
| 治理 | 30 | 10 | **10** |
| 自我进化 | 95 | 45 | **65** |

| 运行指标 | GPT-5.4 | Gemini | **Kimi** |
|----------|---------|--------|----------|
| 运行时长 | ~16 min | ~5 min | **~19 min** |
| 新增实体 | 35 | 2 | **3** |
| 新增 Skill | 1 | 1 | **3** |
| Blueprint | 1 | 1 | **2** |
| Mock-publish | 20 | 21 | **54** |
| Turn 总行数 | 1351 | 127 | **432** |
| 自动测试 | 39P/0F/4W | 24P/1F/4W | **23P/0F/6W** |

---

## 五、Kimi 特征总结

### 优势
1. **"做而不说"执行模式**：Turn 2 空文本但大量工具调用——是正确的 Agent 行为
2. **Skill 创建能力强**：一轮创建 3 个功能分明的 Skill（content/visibility/weekly）
3. **Review 质量高**：Turn 3 的 165 行 Review 是所有模型中最详细的资产盘点
4. **Blueprint 利用率最高**：2 个蓝图（其他模型均为 1 个）

### 弱项
1. **实体建模密度低**：3 个新实体远不及 GPT-5.4 的 35 个，缺少策略卡、模型画像等关键实体
2. **Turn 4 执行失败**：GEO 执行阶段返回空响应，未创建探测记录或策略分析
3. **治理绕过**：mock-publish 文件通过 exec/write 创建，绕过 bps_update_entity
4. **速度最慢**：19 分钟（vs Gemini 5 min, GPT 16 min）

---

## 六、总结

| 指标 | 值 |
|------|-----|
| **加权总分** | **63/100** |
| 自动化测试 | 23 PASS / 0 FAIL / 6 WARN |
| 运行时长 | ~19 分钟 |
| 最终实体数 | 10（7 种子 + 3 新增） |
| Blueprint | 2 |
| Agent workspace | 0 |
| Skill | 11（7 原有 + 1 预存 + 3 新增） |
| Mock-publish | 54 |
| 治理闭环 | 未验证 |

**一句话**: Kimi K2.5 展现了正确的 Agent 执行模式——"做而不说"（Turn 2 空文本但大量工具调用），Skill 创建密度最高（3 个/轮），Review 质量最详细（165 行资产盘点）。但实体建模密度不足（仅 3 个新实体），治理层未触发，GEO 执行阶段（Turn 4）近乎空白。总体优于 Gemini 但仍显著落后于 GPT-5.4。

---

*测试脚本: `test/e2e/idlex-geo-v3.sh` | Turn Logs: `/tmp/aida-model-benchmark/kimi/`*

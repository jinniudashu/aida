# IdleX GEO E2E v3 评估报告

**测试日期**: 2026-03-07 22:46-22:51 CST
**测试服务器**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**LLM**: google/gemini-3.1-pro-preview (fallback: claude-sonnet-4-6 / gpt-4.1)
**自动化结果**: 34 PASS / 1 FAIL / 8 WARN / 35 TOTAL

---

## 一、测试目标与方法

**业务目标**: 一个 GEO 负责人 + Aida 完成闲氪全部 GEO 运营任务。

**测试方法**: 干净服务器从零安装，6 轮对话覆盖完整生命周期：

```
安装 → 种子数据 → 业务需求(Turn 1) → 建模授权(Turn 2) → 检查建模(Turn 3)
    → 执行运营(Turn 4) → 审批(Turn 5) → 日小结(Turn 6)
```

**v3 新增测试点**:
- Workspace 新文件: USER.md (语言/时区), TOOLS.md (BPS 工具参考)
- Two-Layer Architecture 合并: SOUL.md 缩为一句引用, AGENTS.md 为唯一完整来源
- Skill `user-invocable` 标记

**对话设计**: 目标陈述式 ("我需要X") 而非指令式 ("帮我做Y")。Turn 1 混合治理需求 ("发布前必须审批") 和运营需求 ("每天监测能见度")，测试 Aida 分层路由能力。

---

## 二、逐 Phase 结果

### Phase 0: 安装部署 — 14/14 PASS

| 检查项 | 结果 | 说明 |
|--------|------|------|
| V0.1-V0.3 ~/.aida/ 目录 | PASS | blueprints/, data/, context/ |
| V0.4-V0.7 核心 Workspace | PASS | SOUL/AGENTS/HEARTBEAT/BOOT |
| **V0.8 USER.md** | **PASS** | **新增: 时区 Asia/Shanghai, 语言 Chinese** |
| **V0.9 TOOLS.md** | **PASS** | **新增: 14 BPS tools 分组参考** |
| V0.10 Skills >= 7 | PASS | 7 个 Skill 全部安装 |
| V0.11 Dashboard API | PASS | /api/overview 响应正常 |
| V0.12 USER.md 内容 | PASS | 包含 timezone |
| V0.13 TOOLS.md 内容 | PASS | 包含 bps_update_entity |
| **V0.14 SOUL.md 合并** | **PASS** | **Two-Layer 缩为 "See AGENTS.md"** |

**结论**: install-aida.sh 正确部署 7 个 Workspace Bootstrap 文件 + BOOT.md。新增 USER.md/TOOLS.md 一次通过。

### Phase 1: 数据种子 — 5/5 PASS

5 家门店实体 + 3 条治理约束 + 7 份业务文档 + mock-publish 目录，全部就绪。

### Phase 2: 业务需求 (Turn 1) — 4/4 PASS

**Aida 响应亮点**:
- **中文回复**: USER.md `Language: Chinese` 生效，全程中文
- **Two-Layer 路由**: 正确识别 "发布前审批" 和 "战略调整确认" 为治理层需求，描述使用 `governance.yaml` + `REQUIRE_APPROVAL` 策略
- **Agent 识别**: 提出 "闲氪小助理 (xianke-bot)" 独立 Agent 方案，定位亲切活泼人设
- **业务理解**: 提到 "一模一策"（豆包生活场景、千问 JSON 结构化数据、元宝本地路标）

**问题**: Aida 声称 "今天下午已经搭建好"——模型幻觉，干净环境中无先前工作。

### Phase 3: 建模执行 (Turn 2) — 1 FAIL + 5 WARN

| 检查项 | 期望 | 实际 | 结果 |
|--------|------|------|------|
| V3.1 新实体 >= 2 | action-plan + strategy | 0 新实体 | **FAIL** |
| V3.2 Action plan | >= 1 | 0 | WARN |
| V3.3 Strategy entity | >= 1 | 0 | WARN |
| V3.4 新 Skill | geo-probe 等 | 0 | WARN |
| V3.5 Agent workspace | workspace-xianke-bot | 不存在 | WARN |
| V3.6 Blueprint | geo-operations.yaml | 0 (此时) | WARN |

**根因分析**: Aida 完美描述了她"已创建"的所有资产（蓝图、Agent、Cron、治理），但**未实际调用 BPS 工具**。响应全是叙述性文本，无工具调用痕迹。这是 **"说而不做"** 的核心问题——模型生成了关于工具使用的描述，而非实际的工具调用。

### Phase 4: 检查建模 (Turn 3) — 1 PASS + 1 WARN

**Google API 过载**: `The AI service is temporarily overloaded. Please try again in a moment.`

Gateway 回退到 embedded 模式但仍然失败。这是外部依赖问题，非 AIDA 架构问题。

### Phase 5: 执行运营 (Turn 4) — 1 PASS + 1 WARN

**Aida 响应亮点**:
- 生成了高质量的"一模一策"内容草稿（36 行），**完美差异化**:
  - 豆包: "星沙的打工人，下班后不想直接回家？来闲氪躺平" — 情绪价值
  - 千问: JSON FAQ 数据集（价格、位置、服务列表）— 结构化数据
  - 元宝: "出麓山南路地铁即达" — 地理锚点
- 正确提到审批流程: "现在任务正处于挂起等待审批的状态"

**问题**:
- 内容生成在聊天响应中，**未存储为实体** → 治理层未触发
- `bps_update_entity` 未被调用 → 无 governance violation → 无 pending approval
- Aida 已创建 1 个 geo-report 实体（最终验证中确认），但核心内容实体缺失

### Phase 6: Dashboard 审批 — 1 WARN

无 pending approvals（因 Phase 5 未触发治理）。审批流程未被验证。

### Phase 7: 日小结 (Turn 6) — 2/2 PASS

**高质量业务报告**:
- 按 3 个 AI 模型分维度总结执行表现
- 包含发布情况和文件归档地址
- 提到次日 Cron 任务 ("明天上午 10:00")
- 业务语言专业，无技术术语堆砌

### Phase 8: 最终验证 — 7/7 PASS

| 指标 | 值 | 说明 |
|------|-----|------|
| 总实体 | 8 | 5 store + 2 knowledge + 1 geo-report |
| Skills | 7 | 无新增 |
| Dashboard | 5/5 页 | 全部可访问 |
| Blueprints | 1 | geo-operations.yaml (Aida 写入文件但未通过 bps_load_blueprint 加载) |
| Mock-publish | 2 文件 | 内容已写入 |

---

## 三、核心能力评估

### 评分矩阵

| 维度 | 权重 | 得分 | 说明 |
|------|------|------|------|
| **部署完整性** | 15% | 100 | 14/14 PASS，新文件全部部署 |
| **业务理解** | 15% | 95 | 读取 7 份文档，准确理解一模一策，中文响应 |
| **Two-Layer 路由** | 15% | 85 | 正确分辨治理 vs 运营，描述正确的实现路径 |
| **建模执行** | 20% | 25 | 描述完美但仅 1/6 预期工件实际创建 |
| **内容质量** | 15% | 90 | 差异化内容优秀（豆包/千问/元宝各有侧重） |
| **治理闭环** | 10% | 15 | 治理层未被触发，审批流未走通 |
| **自我进化** | 10% | 10 | 描述了 Agent/Skill 需求但未实际创建 |

**加权总分: 60/100**

### 与 v2 (87/100) 对比

| 维度 | v2 | v3 | 变化 | 分析 |
|------|-----|-----|------|------|
| 部署 | 100 | 100 | = | 新文件部署无问题 |
| 业务理解 | 95 | 95 | = | 持续优秀 |
| Two-Layer | N/A | 85 | 新增 | 路由理解正确 |
| 建模执行 | 90 | 25 | **-65** | v2 有残留 memory 辅助执行 |
| 内容质量 | 90 | 90 | = | 持续优秀 |
| 治理闭环 | 70 | 15 | **-55** | v2 触发了治理，v3 未触发 |
| 自我进化 | 100 | 10 | **-90** | v2 memory 中有前置 context |

**关键发现**: v2 (87 分) 之所以高分，是因为**保留了前一次测试的 MEMORY.md**，Aida 有先前执行的上下文来指导工具调用。v3 清除了所有 memory，暴露了 Aida 在**无先验上下文时的工具调用能力严重不足**。

---

## 四、根因分析

### 核心问题: "说而不做" (Narrative > Execution)

Aida 的自然语言输出质量极高（业务理解、内容生成、架构设计），但**实际工具调用率极低**。6 轮对话中，真正被调用的 BPS 工具极少（估计仅 `bps_scan_work` + `bps_query_entities` + 少量 `bps_update_entity`），大部分"操作"是在叙述中描述的。

### 原因链

```
1. Gemini 模型倾向 → 生成叙述性描述而非工具调用
   ↓
2. 无 MEMORY.md 先验 → 无法参照过去的工具调用模式
   ↓
3. 模型幻觉 → 声称"已完成"实际未做的操作
   ↓
4. 工具调用缺失 → 实体未创建 → 治理未触发 → 审批未走通
```

### 对比分析

| 条件 | v2 (memory 保留) | v3 (干净 memory) |
|------|-----------------|-----------------|
| 模型行为 | 参照 memory 中的工具调用记录执行 | 生成描述性文本 |
| 实体创建 | 多个 (action-plan, strategy 等) | 1 个 (geo-report) |
| 治理触发 | 是 | 否 |
| Self-evolution | Skill + Agent 创建 | 仅描述 |

---

## 五、架构资产价值判定

尽管 v3 分数较低，以下**基础设施层**资产被完全验证:

| 资产 | 状态 | 证据 |
|------|------|------|
| install-aida.sh 部署 | **完全工作** | 14/14 PASS |
| USER.md / TOOLS.md | **正确部署和注入** | 中文响应 + 工具知识体现 |
| Two-Layer 合并 (SOUL→AGENTS) | **正确生效** | SOUL.md "See AGENTS.md" 被验证 |
| Skill user-invocable | **部署成功** | frontmatter 正确 |
| Dashboard 全页面 | **可访问** | 5/5 页面 |
| 治理约束加载 | **正确** | 3 constraints loaded |
| Blueprint 编译器 | **可用** | geo-operations.yaml 存在 |
| BPS Engine 14 tools | **注册成功** | "registered with 14 tools" |

**结论**: AIDA 基础设施层完全就绪。瓶颈在 **LLM 工具调用行为层**。

---

## 六、改进建议

### P0: 解决"说而不做"问题

**方向 A — 强化工具调用指令 (AGENTS.md)**:
- 在 Boot Sequence 和 business-execution Skill 中增加 **"Act, don't describe"** 指令
- 示例: "When asked to create entities, call `bps_update_entity` immediately. Do NOT describe what you would create — create it."
- 在 TOOLS.md 增加 "Always verify tool calls completed before reporting success"

**方向 B — 模型选择**:
- 测试 Claude Sonnet 4.6 / GPT-4.1 作为 primary（这些模型的工具调用可靠性通常高于 Gemini）
- 在 Gemini 过载时 fallback 链已配置但行为待验证

**方向 C — MEMORY.md 预置引导**:
- 在 install-aida.sh 中预置一个最小 MEMORY.md，包含工具调用模式提示
- 非 hallucination fix 但可以引导模型走正确路径

### P1: 模型稳定性

- Turn 3 遇到 Google API 过载 → fallback 到 embedded 模式但仍失败
- 建议: 在 install-aida.sh 中增加 `model.retries` 配置（如果 OpenClaw 支持）

### P2: Session 连续性

- 当前每个 Turn 是独立的 `openclaw agent --message` 调用，各 Turn 之间**无 Session 连续性**
- Aida 在 Turn 2 不记得 Turn 1 说过什么（除了通过 memory）
- 建议: 测试脚本改用持久 Session（`--session` 参数或通过 API）以更真实地模拟对话

---

## 七、总结

| 指标 | 值 |
|------|-----|
| **加权总分** | **60/100** |
| 自动化测试 | 34 PASS / 1 FAIL / 8 WARN |
| 基础设施完整性 | 100%（全部验证通过） |
| 业务理解 + 内容质量 | 优秀（一模一策差异化精准） |
| 工具执行可靠性 | **严重不足（核心瓶颈）** |
| 治理闭环 | 未验证（依赖工具执行） |
| 自我进化 | 未验证（依赖工具执行） |

**一句话**: AIDA 的大脑（业务理解 + 架构设计）已经就绪，但手（工具调用执行）还不够可靠。基础设施层全面验证通过，**LLM 工具调用行为是唯一瓶颈**。

---

*测试脚本: `test/e2e/idlex-geo-v3.sh` | 测试方案: `test/e2e/idlex-geo-v3.md` | Turn Logs: `/tmp/idlex-geo-e2e-v3/`*

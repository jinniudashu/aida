# Structural Capability v2 — R3 Report

**Date**: 2026-03-14 15:23–15:36 CST
**Server**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**Model**: kimi/kimi-for-coding
**Duration**: 778s (13.0 min)
**Mode**: full (IdleX GEO business scenario, 含 model probe)

## Result

**127 PASS / 0 FAIL / 3 WARN / 130 TOTAL — ALL CHECKS PASSED**

## R1→R2→R3 对比

| 指标 | R1 (Qwen) | R2 (Kimi→Qwen降级) | R3 (Kimi) |
|------|-----------|---------------------|-----------|
| PASS | 121 | 108 | **127** |
| FAIL | 1 | 1 | **0** |
| WARN | 5 | 20 | **3** |
| Skills 新建 | 0 | 0 | **5** |
| Blueprint 新建 | 1 | 0 | **1** |
| Write 调用 | 3 | 0 | **7** |
| Agent 工作区 | 0 | 0 | **1** |
| 管理违规 | 4 | 3 | **6** |
| 协作任务 | 6 (5完成) | 5 (4完成) | **6 (5完成)** |
| 模型验证 | N/A | FAIL (降级) | **PASS** |
| 模型路由 | N/A | N/A | **PASS (V0.8)** |

---

## Phase 0: 安装验证 — 8/8 PASS

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| V0.1 | ~/.aida/data/ | PASS | |
| V0.2 | SOUL.md | PASS | |
| V0.3 | AGENTS.md | PASS | |
| V0.4 | TOOLS.md | PASS | |
| V0.5 | Dashboard API | PASS | |
| V0.6 | Skills >= 7 | PASS | 7 个（清理生效） |
| V0.7 | 模型锁定 kimi/kimi-for-coding | PASS | |
| V0.8 | 模型路由验证 | PASS | provider `kimi` + model `kimi-for-coding` 均存在于 models.json |

## Phase 1: 数据种子 — 5/5 PASS

| 检查 | 说明 | 结果 |
|------|------|------|
| V1.1 | 5 门店实体 | PASS |
| V1.2 | >= 3 管理约束 | PASS (3条) |
| V1.3 | project.yaml | PASS |
| V1.4 | Blueprint 文件 | PASS |
| V1.5 | >= 7 总实体 | PASS (9个) |

## Phase 2: 引擎结构测试 — 55/55 PASS

### D1: 管理层拦截 (10/10 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.01 | 受管控写操作工具数 = 9 | 9 个工具全部在列 |
| S2.02 | 只读工具绕过管理层 | verdict=PASS, checks=0 |
| S2.03 | CRITICAL 约束 → BLOCK | verdict=BLOCK |
| S2.04 | HIGH 约束 → REQUIRE_APPROVAL | verdict=REQUIRE_APPROVAL |
| S2.05 | 不匹配 scope → PASS | verdict=PASS |
| S2.06 | entityType 过滤匹配 | verdict=REQUIRE_APPROVAL |
| S2.07 | dataFields 过滤（无匹配 → PASS） | verdict=PASS |
| S2.08 | 新工具已纳入管控 | missing: none |
| S2.08b | BLOCK 抛出 Error | threw=true, MANAGEMENT BLOCKED |
| S2.08c | REQUIRE_APPROVAL 抛出 Error 含审批 ID | threw=true |

### D2: 熔断器 (6/6 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.09 | CRITICAL → DISCONNECTED | state=DISCONNECTED |
| S2.10 | DISCONNECTED 阻止全部写操作 | verdict=BLOCK |
| S2.11 | HIGH 累积 → WARNING | state=WARNING |
| S2.12 | 冷却恢复 WARNING → NORMAL | state=NORMAL |
| S2.13 | 窗口内有违规不恢复 | before=WARNING, after=WARNING |
| S2.14 | 振荡检测 | oscillation_detected 事件已触发 |

### D3: 信息摘要层 (6/6 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.15 | scan_work topN 结构 | items, total, showing |
| S2.16 | scan_work 摘要非空 | "3 open, 0 in-progress" |
| S2.17 | 按紧急度排序 | deadline ASC, 空值靠后 |
| S2.18 | query_entities brief 紧凑模式 | entityType, entityId, version, updatedAt |
| S2.19 | next_steps recommendation 字段 | "Recommended: start_service → Data Analysis" |
| S2.20 | outcomeDistribution | success, partial, failed |

### D4: 进程组 (4/4 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.21 | groupId 可查询 | 3 个任务 |
| S2.22 | 批量完成 | updated=3 |
| S2.23 | filterState 仅更新匹配 | updated=1 |
| S2.24 | 不匹配任务不受影响 | IN_PROGRESS 保持不变 |

### D5: 实体关系 (5/5 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.25 | relatedEntities 返回 | count=2 |
| S2.26 | 关系含 version + updatedAt | version=1 |
| S2.27 | 关系类型 depends_on + references | 两种类型均存在 |
| S2.27b | update_entity 支持 relations 参数 | version=2 |
| S2.27c | 通过工具设置的关系可检索 | part_of 关系存在 |

### D6: Skill 指标 (3/3 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.28 | 指标记录 | test-skill, success, 150ms |
| S2.29 | 汇总含调用计数 | invocations=3 |
| S2.30 | 休眠检测 | dormant: 7/7 |

### D7: 约束效能分析 (3/3 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.31 | 逐约束统计 | constraints=3 |
| S2.32 | 必需字段完整 | 10 个字段 |
| S2.33 | 违规计数准确 | c-publish-approval violations=3 |

### D8: 工具注册 (2/2 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.34 | 工具总数 = 19 | 15 base + 2 management + 2 collaboration |
| S2.35 | DEFAULT_SCOPE 排除 bps_load_management | count=8 (GATED=9) |

### D9: 信息饱和信号 (6/6 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.36 | 阈值以下无信号 | 4 reads → undefined |
| S2.37 | 第 5 次读触发信号 | consecutiveReads=5 |
| S2.38 | 信号含行动提示 | update_entity, create_task, complete_task |
| S2.39 | 写操作重置计数器 | write + 4 reads → 无信号 |
| S2.40 | 超阈值累积 | 9 reads → consecutiveReads=9 |
| S2.41 | get_collaboration_response 为读工具 | consecutiveReads=5 |

### D10: 协作输入 (10/10 PASS)

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.42 | request_collaboration 创建任务 | taskId=..., status=pending |
| S2.43 | 任务含 inputSchema + priority + context | dosage, area; priority=high |
| S2.44 | 待响应状态含提示 | status=pending |
| S2.45 | 响应后状态完成 | respondedBy=dr-wang |
| S2.46 | 通过工具查询已完成响应 | dosage, area |
| S2.47 | expiresIn=30m 正确过期 | diff=30min |
| S2.48 | 取消任务 | status=cancelled |
| S2.49 | 状态计数完整 | pending=2, completed=1, cancelled=1 |
| S2.50 | 事件发射 | created=true, responded=true |
| S2.51 | 不存在任务返回错误 | error=Task not found |

---

## Phase 3: Dashboard API — 16/16 PASS

| 检查 | 说明 | 结果 |
|------|------|------|
| S3.01 | 管理状态含 constraintEffectiveness[] | PASS |
| S3.02 | circuitBreakerState 为字符串 | PASS |
| S3.03 | 违规数组含 severity | PASS |
| S3.04 | 约束数组含 scope | PASS |
| S3.05 | 审批端点返回数组 | PASS |
| S3.06 | 实体数 >= 7 | PASS (9) |
| S3.07 | 熔断器重置返回有效 JSON | PASS |
| S3.09 | Dashboard 首页 | PASS |
| S3.09 | Dashboard 业务目标页 | PASS |
| S3.09 | Dashboard 管理页 | PASS |
| S3.10 | 协作状态含 counts + pendingCount | PASS |
| S3.11 | 协作任务列表 {count, tasks[]} | PASS |
| S3.12 | status=pending 过滤 | PASS |
| S3.13 | 引擎协作任务在 Dashboard 可见 | PASS |
| S3.14 | 不存在任务返回 404 | PASS |

---

## Phase 4: 业务场景 — 30/35 PASS, 3 WARN

### 模型验证探针 (2/2 PASS)

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.00a | 模型探针响应 | PASS | 3 行 |
| B4.00b | JSONL 实际模型匹配配置 | PASS | kimi-for-coding |

### Turn 1: 业务背景 (4/4 PASS)

| 检查 | 说明 | 结果 |
|------|------|------|
| B4.01 | 产出响应 | PASS |
| B4.02 | 提及计划/策略 | PASS |
| B4.03 | 提及 GEO/门店/平台 | PASS |
| B4.04 | 提及管理规矩 | PASS |

### Turn 2: 授权建模 (4/5 PASS, 1 WARN)

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.05 | 产出响应 | PASS | |
| B4.06 | 新增实体 >= 3 | **WARN** | 仅 1 个（Kimi 在 Turn 3 集中创建） |
| B4.07 | 提及创建内容 | PASS | |
| B4.08 | 新建 Skill | PASS | **5 个新 Skill** |
| B4.09 | 新建 Blueprint | PASS | **1 个** |

### Turn 3: 日常运营 (4/4 PASS)

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.10 | 产出响应 | PASS | |
| B4.11 | 新增运营实体 | PASS | 4 个 |
| B4.12 | write 工具生成内容 | PASS | 3 次调用 |
| B4.13 | 提及具体门店 | PASS | 声临其境/悠然茶室/棋乐无穷 |

### Turn 3b: 协作请求 (6/6 PASS)

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.13b | 产出响应 | PASS | 30 行 |
| B4.13c | 调用 bps_request_collaboration | PASS | 1 次 |
| B4.13d | Dashboard 待处理协作任务 | PASS | 3 个 |
| B4.13e | 协作任务已响应 | PASS | 3 个 |
| B4.13f | 提及协作/确认 | PASS | |

### Turn 4 + Step 5: 管理触发 + 审批 (5/6 PASS, 1 WARN)

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.14 | 产出响应 | PASS | |
| B4.15 | 管理违规增加 | PASS | 新增 3 条 |
| B4.16 | 报告管理拦截 | PASS | |
| B4.17 | 提及审批 ID 或 Dashboard | **WARN** | 关键词未匹配（Kimi 用其他表述） |
| B4.18 | 存在待审批 | PASS | 3 个 |
| B4.19 | 审批已处理 | PASS | 3 个批准 |

### Turn 6: Skill/Agent 创建 (4/4 PASS)

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.20 | 产出响应 | PASS | |
| B4.21 | 新建 Skill | PASS | **5 个** |
| B4.22 | 新建 Agent 工作区 | PASS | **1 个 (idlex-store-assistant)** |
| B4.23 | 响应描述创建 | PASS | |

### Turn 7: 运营小结 (2/2 PASS)

| 检查 | 说明 | 结果 |
|------|------|------|
| B4.24 | 产出响应 | PASS |
| B4.25 | 小结含业务内容 | PASS |

### Turn 8: 管理制度回顾 (2/2 PASS)

| 检查 | 说明 | 结果 |
|------|------|------|
| B4.26 | 产出响应 | PASS |
| B4.27 | 提及管理详情 | PASS |

---

## Phase 5: 终验 — 11/12 PASS, 1 WARN

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| V5.1 | 最终实体数稳定 | PASS | 17 个 |
| V5.2 | 管理约束已加载 | PASS | 2 条 |
| V5.3 | Skills 完整 | PASS | 12 个 (7 安装 + 5 新建) |
| V5.4 | Agent 创建实体 >= 3 | PASS | 8 个 |
| V5.5 | 业务实体类型 >= 2 | PASS | 4 种: content, probe, strategy, action-plan |
| V5.6 | 内容制品 (write 调用) | PASS | 7 次 |
| V5.7 | 管理层被行使 | PASS | 6 条违规 |
| S3.08 | 审批决策生效 | **WARN** | decided=0（检测窗口问题，非功能缺陷） |
| V5.8 | Agent 创建 Skill >= 1 | PASS | **5 个** |
| V5.9 | Agent 工作区已创建 | PASS | **1 个** |
| V5.10 | 协作任务已创建 | PASS | 6 个 |
| V5.11 | 协作任务已完成 | PASS | 5 个 |
| V5.12 | 饱和信号出现次数 | PASS | 0 |

---

## 3 WARN 分析

| 检查 | 原因 | 严重性 |
|------|------|--------|
| B4.06 | Kimi 在 Turn 2 仅创建 1 个实体（集中在 Turn 3 创建 4 个） | 低 — 时序差异，非能力缺失 |
| B4.17 | Kimi 报告管理拦截时使用了不同表述（未匹配 "Approval" 或 "Dashboard" 关键词） | 低 — grep 模式不够宽泛 |
| S3.08 | 审批在 Phase 4 Step 5 已执行，但 Phase 5 查询 API 返回 0（PENDING 过滤逻辑） | 低 — 已知检测窗口问题 |

## 系统状态（测试后）

| 指标 | 数值 |
|------|------|
| 实体 | 17 (9 种子 + 8 Agent 创建) |
| 违规 | 6 (3 种子 + 3 业务触发) |
| 约束 | 2 (Kimi 自建覆盖种子) |
| Skills | 12 (7 安装 + 5 新建) |
| 蓝图 | 2 (1 种子 + 1 新建) |
| Write 调用 | 7 (3 内容 + 3 Agent workspace + 1 日报) |
| Agent 工作区 | 1 (idlex-store-assistant) |
| 协作任务 | 6 (创建), 5 (完成) |
| 饱和信号 | 0 |

## Agent 各轮表现

| 轮次 | 工具调用 | 主要产出 |
|------|----------|----------|
| Probe | 模型名称回复 | B4.00b JSONL 确认 kimi-for-coding |
| Turn 1 | 读上下文 | 策略概览 |
| Turn 2 | 5 Skill + 1 Blueprint + 1 实体 | geo-content-generator, visibility-probe, geo-distribute, geo-analyze + 运营蓝图 |
| Turn 3 | 4 实体 + 3 write | 能见度探测 + 3 份豆包 GEO 内容 |
| Turn 3b | 1 bps_request_collaboration | 店长数据确认（使用率/预约/年龄段） |
| Turn 4 | publishReady → 3 violations | 管理拦截 + 3 个审批单 |
| Step 5 | (程序化) | 3 个审批全部通过 |
| Turn 6 | 1 Agent workspace | idlex-store-assistant (亲切活泼人格) |
| Turn 7 | 1 write (日报) | 运营日报保存到 geo-logs/ |
| Turn 8 | 管理查询 | 违规/约束/熔断器分析 |

## Kimi vs Qwen 能力对比

| 能力维度 | R1 Qwen | R3 Kimi | 优胜 |
|----------|---------|---------|------|
| 实体创建 | 12 | 8 | Qwen |
| Skill 创建 | 0 | **5** | **Kimi** |
| Blueprint 创建 | 1 | 1 | 平 |
| Agent 创建 | 0 | **1** | **Kimi** |
| 内容生成 (write) | 3 | **7** | **Kimi** |
| 管理触发 | 1 violation | **3 violations** | **Kimi** |
| 协作工具调用 | 1 | 1 | 平 |
| HITL 审批闭环 | 1 approved | **3 approved** | **Kimi** |
| "说而不做" | 4 WARN | 0 | **Kimi** |

**结论**: Kimi for Coding 在**执行力**上显著优于 Qwen3.5-Plus — 5 个 Skill + 1 个 Agent + 7 次 write + 3 次管理触发，零"说而不做"。Qwen 在实体创建数量上领先，但缺少实际执行动作。

## 本轮修复验证

| 修复项 | 状态 |
|--------|------|
| install-aida.sh 残留 Skill 清理 | **已验证** — Skills=7（非 18） |
| S3.14 curl -sf 404 检测 | **已验证** — PASS |
| SC_MODEL 环境变量 | **已验证** — kimi/kimi-for-coding |
| V0.8 模型路由验证 | **已验证** — provider+model 存在于 models.json |
| B4.00a/b 模型探针 | **已验证** — JSONL 确认 kimi-for-coding |
| moonshot/kimi-k2.5 废弃清理 | **已验证** — 服务器 openclaw.json 已清理 |

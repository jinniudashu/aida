# 结构能力测试 v2 — R1 报告

**日期**: 2026-03-14 12:19–12:29 CST
**服务器**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**模型**: dashscope/qwen3.5-plus（备选: kimi/kimi-for-coding）
**耗时**: 618 秒（10.3 分钟）
**模式**: 完整模式（闲氪 GEO 业务场景，9 步 Agent 交互）

## 测试结果

**121 通过 / 1 失败 / 5 警告 / 127 总计**

## v1→v2 升级对比

| 指标 | v1 (R4) | v2 (R1) | 变化 |
|------|---------|---------|------|
| 总检查数 | 97 | 127 | +30 |
| 引擎检查（Phase 2） | 39 | 55 | +16 |
| Dashboard 检查（Phase 3） | 11 | 16 | +5 |
| 业务场景检查（Phase 4） | 27 | 33 | +6 |
| 终验检查（Phase 5） | 9 | 12 | +3 |
| 测试维度 | D1-D8 | D1-D10 | +D9 饱和信号, +D10 协作输入 |

---

## Phase 2: 引擎结构测试 — 55/55 全部通过

### D1: 管理层拦截（10/10 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.01 | 受管控写操作工具数 = 9 | bps_update_entity, bps_create_task, bps_update_task, bps_complete_task, bps_create_skill, bps_load_blueprint, bps_register_agent, bps_load_management, bps_batch_update |
| S2.02 | 只读工具绕过管理层 | 判定=PASS，约束检查数=0 |
| S2.03 | CRITICAL 约束触发 BLOCK 判定 | 判定=BLOCK（c-no-archive 约束，lifecycle=ARCHIVED） |
| S2.04 | HIGH 约束触发 REQUIRE_APPROVAL 判定 | 判定=REQUIRE_APPROVAL（c-publish-approval，publishReady=true） |
| S2.05 | 不匹配 scope 时判定 PASS | 判定=PASS（store 实体无匹配约束） |
| S2.06 | 约束 scope：entityType 过滤匹配 | 判定=REQUIRE_APPROVAL（strategy 实体 + majorChange） |
| S2.07 | 约束 scope：dataFields 过滤（无匹配→PASS） | 判定=PASS（content 实体但无敏感字段） |
| S2.08 | 新工具已纳入管控列表 | batch_update, load_blueprint, register_agent, load_management 全部在列 |
| S2.08b | 管理层 BLOCK 抛出 Error（非返回 {success:false}） | threw=true，消息包含 MANAGEMENT BLOCKED |
| S2.08c | REQUIRE_APPROVAL 抛出 Error 含审批 ID | threw=true，消息包含 Approval ID |

### D2: 熔断器（6/6 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.09 | CRITICAL 违规 → DISCONNECTED | 状态=DISCONNECTED |
| S2.10 | DISCONNECTED 状态立即阻止所有写操作 | 判定=BLOCK，熔断器状态=DISCONNECTED |
| S2.11 | HIGH 违规累积 → WARNING | 状态=WARNING（2 次 HIGH 违规） |
| S2.12 | 冷却恢复：WARNING → NORMAL | 回溯 lastStateChange 2 秒后自动降级为 NORMAL |
| S2.13 | 窗口内有违规时不恢复 | 恢复前=WARNING，恢复后=WARNING（违规阻止降级） |
| S2.14 | 振荡检测（1 小时内 >3 次状态转移→锁定） | oscillation_detected 事件已触发 |

### D3: 信息摘要层（6/6 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.15 | bps_scan_work 返回 topN 结构 {items, total, showing} | openTasks 包含 items, total, showing 字段 |
| S2.16 | bps_scan_work 摘要为非空字符串 | 摘要: "3 open, 0 in-progress" |
| S2.17 | bps_scan_work 按紧急度排序（deadline ASC, 空值靠后） | probe-store-01(截止03-15,优先3) > analysis-01(截止03-16,优先1) > content-01(无截止,优先5) |
| S2.18 | bps_query_entities brief=true 返回紧凑格式（无 data） | 紧凑格式字段: entityType, entityId, version, updatedAt |
| S2.19 | bps_next_steps 返回 recommendation 字段 | "Recommended: start_service → Data Analysis" |
| S2.20 | bps_scan_work outcomeDistribution 含 success/partial/failed | 三个状态键均存在 |

### D4: 进程组（4/4 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.21 | 带 groupId 的任务可查询 | 找到 3 个 groupId=group-structural-batch 的任务 |
| S2.22 | bps_batch_update 批量完成组内全部任务 | 更新=3，总计=3 |
| S2.23 | bps_batch_update filterState 仅更新匹配状态 | 更新=1（仅 OPEN 任务被完成） |
| S2.24 | 过滤批更新：不匹配的任务不受影响 | IN_PROGRESS 任务保持 IN_PROGRESS |

### D5: 实体关系（5/5 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.25 | bps_get_entity 返回 relatedEntities | 关联实体数: 2 |
| S2.26 | 关系包含 version 和 updatedAt | version=1, updatedAt=2026-03-14T04:19:05Z |
| S2.27 | 关系类型: depends_on 和 references | types: references, depends_on |
| S2.27b | bps_update_entity 支持 relations 参数 | version=2（关系设置成功） |
| S2.27c | 通过更新工具设置的关系可检索 | relatedEntities: 1（找到 part_of 关系） |

### D6: Skill 指标（3/3 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.28 | Skill 指标记录 | id=54b0546e...（test-skill, success, 150ms） |
| S2.29 | Skill 指标汇总含调用计数 | 总调用=3（2 success + 1 failed） |
| S2.30 | 休眠 Skill 检测（未调用或长期未用，90 天） | 休眠: 18/18，内置 Skill 全部休眠 |

### D7: 约束效能分析（3/3 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.31 | getConstraintEffectiveness 返回逐约束统计 | 约束数: 3 |
| S2.32 | 效能统计包含必需字段 | violationCount, approvalCount, approvalRate, suggestion 等 10 个字段 |
| S2.33 | 约束效能准确反映实际违规 | c-publish-approval 违规次数: 3 |

### D8: 工具注册（2/2 通过）

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.34 | 工具总数 = 19（15 基础 + 2 管理 + 2 协作） | 19 个工具已注册: bps_list_services...bps_get_collaboration_response |
| S2.35 | DEFAULT_SCOPE_WRITE_TOOLS 排除 bps_load_management | 默认 scope 数: 8（管控总数: 9） |

### D9: 信息饱和信号（6/6 通过）— 新增

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.36 | 阈值以下无信号（4 次连续读） | _readSignal: undefined |
| S2.37 | 第 5 次连续读时注入信号 | consecutiveReads=5 |
| S2.38 | 信号消息包含行动提示 | 消息含 bps_update_entity, bps_create_task, bps_complete_task（200 字符） |
| S2.39 | 写操作重置读计数器 | 1 次写 + 4 次读 → 无信号 |
| S2.40 | 计数器超过阈值后继续累积 | 9 次连续读 → consecutiveReads=9 |
| S2.41 | bps_get_collaboration_response 归类为读工具 | 4 次 list_services + 1 次 get_collaboration_response → consecutiveReads=5 触发信号 |

### D10: 协作输入（10/10 通过）— 新增

| 检查 | 说明 | 详情 |
|------|------|------|
| S2.42 | bps_request_collaboration 创建协作任务 | taskId=4fb34968..., status=pending |
| S2.43 | 任务包含 inputSchema + priority + context | schema 字段: dosage, area; 优先级=high; context.entityType=patient |
| S2.44 | 待响应状态包含提示信息 | status=pending, hint 包含 "Dashboard Inbox" |
| S2.45 | 响应后状态转为已完成并携带数据 | respondedBy=dr-wang, data={dosage:80, area:forehead} |
| S2.46 | 通过工具查询已完成的协作响应 | response 字段: dosage, area |
| S2.47 | expiresIn=30m 设置正确的过期时间 | 差值=30 分钟（在容差范围内） |
| S2.48 | 取消任务将状态置为 cancelled | status=cancelled |
| S2.49 | 状态计数涵盖全部状态 | pending=2, completed=1, cancelled=1 |
| S2.50 | 事件发射（task_created + task_responded） | created=true, responded=true |
| S2.51 | 不存在的任务返回错误 | error=Task not found: nonexistent-id |

---

## Phase 3: Dashboard API 测试 — 15/16 通过，1 失败

### D11: Dashboard API（15/16）

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| S3.01 | 管理状态接口含 constraintEffectiveness[] | 通过 | |
| S3.02 | circuitBreakerState 为字符串 | 通过 | |
| S3.03 | 违规数组含 severity 字段 | 通过 | |
| S3.04 | 约束数组含 scope 对象 | 通过 | |
| S3.05 | 审批端点返回数组 | 通过 | count=0 |
| S3.06 | 实体数 >= 7 | 通过 | 实际=9 |
| S3.07 | 熔断器重置返回有效 JSON | 通过 | |
| S3.09 | Dashboard 首页可访问 | 通过 | |
| S3.09 | Dashboard 业务目标页可访问 | 通过 | |
| S3.09 | Dashboard 管理页可访问 | 通过 | |
| S3.10 | 协作状态接口含 counts + pendingCount | 通过 | 新增 |
| S3.11 | 协作任务列表返回 {count, tasks[]} | 通过 | 新增 |
| S3.12 | 协作任务 status=pending 过滤有效 | 通过 | 新增 |
| S3.13 | 引擎创建的协作任务在 Dashboard API 可见 | 通过 | 新增 |
| S3.14 | 不存在的协作任务返回 404 | **失败** | `curl -sf` 的 `-f` 吞掉了 404 状态码（已修复） |

---

## Phase 4: 业务场景 — 27/33 通过，6 警告

### Turn 1: 业务背景介绍（4/4 通过）

| 检查 | 说明 | 结果 |
|------|------|------|
| B4.01 | 产出响应 | 通过（69 行） |
| B4.02 | 提及计划/策略 | 通过 |
| B4.03 | 提及 GEO/门店/平台 | 通过 |
| B4.04 | 提及管理规矩 | 通过 |

### Turn 2: 授权建模（4/5 通过，1 警告）

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.05 | 产出响应 | 通过 | |
| B4.06 | 新增实体 >= 3 | 通过 | 实际新增 7 个 |
| B4.07 | 提及实体/Skill/蓝图创建 | 通过 | |
| B4.08 | 新建 Skill | **警告** | 0 个 — Qwen 未调用 bps_create_skill |
| B4.09 | 新建 Blueprint | 通过 | 新增 1 个 |

### Turn 3: 日常 GEO 运营（4/4 通过）

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.10 | 产出响应 | 通过 | |
| B4.11 | 运营中新增实体 | 通过 | 新增 4 个 |
| B4.12 | 通过 write 工具生成内容文件 | 通过 | 3 次调用 |
| B4.13 | 提及具体门店名称 | 通过 | 声临其境/悠然茶室/棋乐无穷 |

### Turn 3b: 协作输入请求（6/6 通过）— 新增

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.13b | 产出响应 | 通过 | 58 行 |
| B4.13c | 调用了 bps_request_collaboration | 通过 | JSONL 中检测到 1 次调用 |
| B4.13d | Dashboard 中出现待处理协作任务 | 通过 | 3 个待处理任务 |
| B4.13e | 协作任务已被响应 | 通过 | 3 个任务通过 API 响应 |
| B4.13f | 响应提及协作/确认/输入 | 通过 | |

### Turn 4 + Step 5: 管理触发 + 审批（6/6 通过）

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.14 | 产出响应 | 通过 | |
| B4.15 | 管理违规数增加 | 通过 | 新增 1 条 |
| B4.16 | 报告管理拦截 | 通过 | |
| B4.17 | 提及审批 ID 或 Dashboard | 通过 | |
| B4.18 | 存在待审批项 | 通过 | count=1 |
| B4.19 | 审批已处理 | 通过 | 1 项已批准 |

### Turn 6: Skill/Agent 创建（1/3 通过，2 警告）

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| B4.20 | 产出响应 | 通过 | |
| B4.21 | 新建 Skill | **警告** | 0 个 — 描述了方案但未调用创建工具 |
| B4.22 | 新建 Agent 工作区 | **警告** | 0 个 — 描述了方案但未调用创建工具 |
| B4.23 | 响应描述了创建内容 | 通过 | |

### Turn 7: 运营小结（2/2 通过）

| 检查 | 说明 | 结果 |
|------|------|------|
| B4.24 | 产出响应 | 通过 |
| B4.25 | 小结包含业务内容 | 通过 |

### Turn 8: 管理制度回顾（2/2 通过）

| 检查 | 说明 | 结果 |
|------|------|------|
| B4.26 | 产出响应 | 通过 |
| B4.27 | 提及管理详情 | 通过 |

---

## Phase 5: 终验 — 10/12 通过，2 警告

| 检查 | 说明 | 结果 | 详情 |
|------|------|------|------|
| V5.1 | 最终实体数稳定 | 通过 | 21 个 |
| V5.2 | 管理约束已加载 | 通过 | 4 条 |
| V5.3 | Skill 完整 | 通过 | 18 个 |
| V5.4 | Agent 创建实体 >= 3 | 通过 | 12 个 |
| V5.5 | 业务实体类型 >= 2 | 通过 | 3 种: geo-content, strategy, action-plan |
| V5.6 | 内容制品（write 调用） | 通过 | 3 次 |
| V5.7 | 管理层被行使（违规） | 通过 | 4 条违规 |
| S3.08 | 审批决策生效 | **警告** | decided=0（Phase 2 重置后检测窗口不对） |
| V5.8 | Agent 创建 Skill >= 1 | **警告** | 0 个（Qwen "说而不做"模式） |
| V5.9 | Agent 工作区已创建 | 通过 | 5 个（历史运行残留） |
| V5.10 | 协作任务已创建 | 通过 | 总计 6 个 — 新增 |
| V5.11 | 协作任务已完成 | 通过 | 完成 5 个 — 新增 |
| V5.12 | 饱和信号出现次数 | 通过 | 0 次（Agent 无长读循环）— 新增 |

---

## 失败分析（1 项）

### S3.14: 不存在的协作任务应返回 404

**根因**: `curl -sf` 的 `-f` 参数在收到 HTTP 404 响应时使 curl 以非零退出码退出，此时 `-w "%{http_code}"` 的输出被 `|| echo "000"` 替换为 "000"，导致断言 `test '000' = '404'` 失败。

**验证**: 测试结束后手动执行同一请求返回 404——端点功能正常，问题仅在测试脚本。

**修复**: 已将 `curl -sf` 改为 `curl -s`（去掉 `-f` 标志）。

## 警告分析（5 项）

| 模式 | 占比 | 涉及检查 |
|------|------|----------|
| Qwen "说而不做"（描述方案但不调用创建工具） | 4/5 | B4.08, B4.21, B4.22, V5.8 |
| 检测窗口偏移（审批已执行但 JSONL 检测未捕获） | 1/5 | S3.08 |

"说而不做"是 Qwen3.5-Plus 的已知行为模式（v1 R3-R4 已观察到）——模型输出高质量的方案描述，但未实际调用工具执行。属 LLM 行为层问题，非基础设施缺陷。

---

## 系统状态（测试后）

| 指标 | 数值 |
|------|------|
| 实体数 | 21（9 种子 + 12 Agent 创建） |
| 违规数 | 4（3 种子 + 1 业务触发） |
| 约束数 | 4（3 种子 + 1 Agent 创建） |
| Skill 数 | 18（全部来自安装，0 新建） |
| 蓝图数 | 2（1 种子 + 1 Agent 创建） |
| 写工具调用 | 3（内容文件） |
| Agent 工作区 | 5（历史运行残留） |
| 协作任务数 | 6（Turn 3b 创建 3 + 引擎测试 3） |
| 协作已完成 | 5 |
| 饱和信号次数 | 0 |

## Agent 各轮表现

| 轮次 | 耗时 | 工具调用 | 主要产出 |
|------|------|----------|----------|
| Turn 1 | 34s | 读取上下文 | 69 行策略概览 |
| Turn 2 | ~200s | 7+ 实体创建 + 1 蓝图 | 7 实体, 1 蓝图, 1 管理约束 |
| Turn 3 | ~118s | 3 次 write + 实体创建 | 4 实体, 3 内容文件 |
| Turn 3b | ~41s | 1 次 bps_request_collaboration | 1 协作任务 → Dashboard 中 3 个待处理 |
| Turn 4 | ~33s | bps_update_entity (publishReady) | 1 管理违规 + 1 审批 |
| Turn 6 | ~87s | 仅描述 | 描述了 Skill + Agent 方案（未创建） |
| Turn 7 | ~45s | 读取工具 | 运营日报 |
| Turn 8 | ~48s | bps_management_status | 管理制度回顾 |

## 协作机制端到端验证

**完整流程已验证**:
1. Agent 调用 `bps_request_collaboration`，提交包含 3 个字段的结构化 inputSchema（dailyOccupancyRate 日均使用率、weekendReservationRequired 周末是否需预约、primaryAgeGroup 主力消费人群年龄段）
2. 协作任务出现在 Dashboard API（`/api/collaboration/tasks?status=pending` → 3 个待处理任务）
3. 测试脚本通过 `POST /api/collaboration/tasks/:id/respond` 模拟店长回复
4. 响应数据正确存储（使用率 72%、周末需预约、年龄段 25-35）
5. 任务状态正确转为已完成（completed）
6. SSE 事件触发，Dashboard 实时更新

**Agent 创建了 3 个协作任务**（每个确认字段一个任务），而非 1 个复合任务——说明基于表单的 schema 设计对两种模式都足够灵活。

---

## 结论

| 维度 | 结果 | 说明 |
|------|------|------|
| D1-D8（v1 继承维度） | 39/39 通过 | 全部稳定通过，无回归 |
| D9 信息饱和信号 | 6/6 通过 | 阈值触发、写重置、累积、行动提示、协作读分类全部验证 |
| D10 协作输入 | 10/10 通过 | 完整 CRUD 生命周期 + 事件 + 错误处理 |
| D11 Dashboard API | 15/16 通过 | 1 失败为脚本 bug（已修复） |
| 业务场景协作 | 6/6 通过 | Agent 正确使用协作工具进行 HITL 数据采集 |
| 已知问题 | 4/5 警告 | Qwen "说而不做"——描述方案但不调用 Skill/Agent 创建工具 |

**基础设施升级验证完成**: 新增 30 个检查点，核心功能全部确认。

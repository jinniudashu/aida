# AEF Capability E2E Test — R1 报告

## 测试概要

| 项目 | 值 |
|------|-----|
| 轮次 | R1（首轮完整 E2E） |
| 日期 | 2026-03-12 |
| 基线模型 | dashscope/qwen3.5-plus（primary），kimi/kimi-for-coding（fallback） |
| 模式 | full（引擎 + Dashboard + 8 Agent turns + 业务场景） |
| 耗时 | 494s（~8 分钟） |
| 结果 | **124 PASS / 0 FAIL / 4 WARN / 128 TOTAL** |

## R1 目标

基于 structural-capability 测试框架升级为 AEF 十一维全覆盖 E2E 测试，建立首轮基线。

## 测试结构

| 阶段 | 检查数 | 内容 |
|------|--------|------|
| Phase 0: 安装验证 | 7 | 部署完整性 |
| Phase 1: 数据种子 | 5 | 实体/约束/蓝图种子 |
| Phase 2: 引擎测试 (D1-D8 + AEF Σ1-Σ11) | 69 | 39 结构检查 + 30 AEF 维度检查 |
| Phase 3: Dashboard API | 11 | 管理/实体/页面 API |
| Phase 4: 业务场景 (8 Agent turns) | 27 | IdleX GEO 运营全流程 |
| Phase 5: 最终验证 | 9 | 制品/管理/自进化 |
| **总计** | **128** | |

## AEF 十一维健康度

| 维度 | 名称 | 检查数 | PASS | 健康度 | 状态 |
|------|------|--------|------|--------|------|
| Σ1 | PROC 过程生命周期 | 10 | 10 | 1.00 | HEALTHY |
| Σ2 | ENTITY 实体管理 | 5 | 5 | 1.00 | HEALTHY |
| Σ3 | CONSTRAINT 约束评估 | 10 | 10 | 1.00 | HEALTHY |
| Σ4 | CIRCUIT 熔断器 | 6 | 6 | 1.00 | HEALTHY |
| Σ5 | LEARNING 效能学习 | 6 | 6 | 1.00 | HEALTHY |
| Σ6 | CONTEXT 上下文效率 | 6 | 6 | 1.00 | HEALTHY |
| Σ7 | SCHED 调度 | 5 | 5 | 1.00 | HEALTHY |
| Σ8 | TOOL 工具生态 | 2 | 2 | 1.00 | HEALTHY |
| Σ9 | HIER 层级一致性 | 3 | 3 | 1.00 | HEALTHY |
| ΣX | CROSS 跨维度链路 | 6 | 6 | 1.00 | HEALTHY |
| Σ11 | MATCH 能力匹配度 | 10 | 10 | 1.00 | HEALTHY |
| **引擎合计** | | **69** | **69** | **1.00** | **ALL HEALTHY** |

## 30 AEF 新增检查点详情

### Σ1 PROC — 过程生命周期 (6/6 PASS)

| 检查 | 结果 | 说明 |
|------|------|------|
| E1.01 Create task → OPEN | PASS | 创建任务默认状态正确 |
| E1.02 OPEN → IN_PROGRESS | PASS | 状态转移正确 |
| E1.03 outcome=success 持久化 | PASS | 通过 bps_complete_task 工具存入 snapshot |
| E1.04 outcome=partial 持久化 | PASS | partial outcome 正确存储 |
| E1.05 IN_PROGRESS → FAILED | PASS | failTask 状态转移 |
| E1.06 IN_PROGRESS → BLOCKED | PASS | BLOCKED 状态可达 |

### Σ7 SCHED — 调度 (5/5 PASS)

| 检查 | 结果 | 说明 |
|------|------|------|
| E7.01 Past-deadline task | PASS | 含过期 deadline 的任务创建成功 |
| E7.02 overdueTasks ≥ 1 | PASS | scan_work 检测到 12 个过期任务 |
| E7.03 Overdue task in items | PASS | 过期任务 ID 出现在 overdueTasks.items |
| E7.04 Future task NOT overdue | PASS | 未过期任务不在 overdueTasks |
| E7.05 Deadline ASC sort | PASS | 早 deadline 排在前 |

### Σ9 HIER — 层级一致性 (3/3 PASS)

| 检查 | 结果 | 说明 |
|------|------|------|
| E9.01 scope.tools[] defined | PASS | 3 个约束均有明确工具范围 |
| E9.02 scope.tools ⊆ GATED_WRITE_TOOLS | PASS | 约束只引用受管理工具 |
| E9.03 entityType scoping | PASS | 3 个约束使用实体类型过滤 |

### ΣX CROSS — 跨维度链路 (6/6 PASS)

| 检查 | 结果 | 说明 |
|------|------|------|
| EX.01 Σ3→Σ4 CRITICAL→CB DISCONNECTED | PASS | CRITICAL 违规触发熔断器断开 |
| EX.02 Σ4→Σ3 Reset→write PASS | PASS | 重置熔断器后写操作恢复 |
| EX.03 Σ3→Σ5 violations→count | PASS | 3 次违规累积正确记录 |
| EX.04 Σ5 approval→suggestion | PASS | 100% 通过率触发"考虑放宽"建议 |
| EX.05 Σ1→Σ7→Σ6 scan_work summary | PASS | summary 含 overdue/failed/open/in-progress 计数 |
| EX.06 Σ1→Σ5 partial→distribution | PASS | outcomeDistribution.partial=2 |

### Σ11 MATCH — 能力匹配度 (10/10 PASS)

#### A 层：结构前提 (4/4)

| 检查 | 结果 | 说明 |
|------|------|------|
| E11.01 effectiveness API 有建议 | PASS | suggestion 字段存在 |
| E11.02 管理覆盖多种工具 | PASS | entity + blueprint + agent 工具均受管理 |
| E11.03 细粒度 dataFields scope | PASS | 3 个约束含 dataFields |
| E11.04 scan_work 信息充分 | PASS | 9 个字段（含 dormantSkills） |

#### B 层：过度制约抵抗 (3/3)

| 检查 | 结果 | 说明 |
|------|------|------|
| E11.05 entityType 精确匹配 | PASS | 'content' 约束不拦截 'store' → PASS |
| E11.06 dataFields 精确匹配 | PASS | 'publishReady' 约束不拦截 'name' → PASS |
| E11.07 undefined variable → PASS | PASS | 约束变量不在操作数据中时跳过 |

#### C 层：支持不足检测 (3/3)

| 检查 | 结果 | 说明 |
|------|------|------|
| E11.08 批量 API 存在 | PASS | bps_batch_update 已注册 |
| E11.09 BLOCK 含结构化信息 | PASS | constraintId + severity + message |
| E11.10 brief 模式节省上下文 | PASS | 554B < 3065B |

## Agent 业务场景表现 (Phase 4)

| Turn | 内容 | 结果 |
|------|------|------|
| Turn 1 | 业务简报 — 理解 GEO 运营背景 | 4/4 PASS |
| Turn 2 | 授权建模 — 创建蓝图/Skill/实体 | 4/5 PASS, 1 WARN (实体 2 < 3) |
| Turn 3 | 日常运营 — 探测+内容生成 | 4/4 PASS |
| Turn 4 | 管理触发 — 内容发布审批拦截 | 4/4 PASS |
| Step 5 | 程序化审批 | 2 WARN (0 pending approvals) |
| Turn 6 | 自进化 — Skill + Agent 创建 | 4/4 PASS |
| Turn 7 | 日报总结 | 2/2 PASS |
| Turn 8 | 管理审计 | 2/2 PASS |

### Agent 产出指标

| 指标 | 值 |
|------|-----|
| 新增实体 | 8 个（geo-probe×3, geo-analysis×3, geo-strategy×1, action-plan×1） |
| 新增 Skill | 4 个（geo-probe, geo-content-generator, geo-metric-tracker, daily-geo-probe） |
| 新增 Blueprint | 1 个（idlex-geo-operations） |
| 新增 Agent workspace | 1 个（workspace-store-helper） |
| 内容文件 | 3 个（豆包风格 GEO 内容） |
| 管理违规 | 2 次（DISCONNECTED 触发） |
| 管理约束 | 5 个（种子 3 + Agent 新增 2） |

## 4 WARN 分析

| WARN | 原因 | 严重性 |
|------|------|--------|
| B4.06 实体创建 < 3 | Turn 2 Aida 创建 2 个实体（strategy + action-plan），第 3 个在 Turn 3 创建 | 低 — 时序差异 |
| B4.18 待审批 = 0 | DISCONNECTED 状态阻止了 REQUIRE_APPROVAL 路径，直接 BLOCK | 低 — 管理行为正确 |
| B4.19 审批处理 = 0 | 同上，无 pending 可处理 | 低 |
| S3.08 审批 decide = 0 | 同上 | 低 |

**共同根因**：Turn 4 时熔断器已 DISCONNECTED（Turn 2/3 累积违规），所有写操作直接 BLOCK 而非 REQUIRE_APPROVAL。这是管理层正确行为——断路器优先级高于单个约束的 onViolation 设置。

## 调试修复记录

R1 开发过程中修复了 5 个问题：

| Bug | 根因 | 修复 |
|-----|------|------|
| E1.03/E1.04 outcome=undefined | tracker.completeTask 不存储 outcome；需通过 bps_complete_task 工具 | 改用工具 + 检查 processStore snapshot |
| EX.04 crash: no column decided_by | approvals 表列名是 approved_by 不是 decided_by | 修正列名 |
| EX.04 crash: violations INSERT 失败 | violations 表有复杂 schema（policy_id, verdict 等），直接 INSERT 缺字段 | 改用 gate.check() 生成违规，仅 INSERT 审批记录 |
| E11.07 crash: SQLite parameter 2 | ConstraintDef 必须有 policyId + message | 补全字段 |
| EX.06 partial=0 | recentlyCompleted 按 priority DESC 排序，limit:10 可能不含低优先级任务 | 给 partial 任务 priority=999 |

## 与 structural-capability 的对比

| 维度 | structural-capability | aef-capability |
|------|----------------------|----------------|
| 检查数 | 97 (R3 最佳) | **128** |
| 引擎检查 | 39 (D1-D8) | **69** (D1-D8 + Σ1/Σ7/Σ9/ΣX/Σ11) |
| 维度覆盖 | D1-D9 工程特性 | **Σ1-Σ11 AEF 理论框架** |
| 健康度报告 | 无 | **每维度 pass/total/health/status** |
| 业务场景 | 相同（IdleX GEO） | 相同 |
| Agent turns | 8 | 8 |

## 下一步

- R2：引擎变更后回归验证
- 改进方向：Turn 2 前重置熔断器，使 REQUIRE_APPROVAL 路径可达（解决 B4.18/19 WARN）
- 长期：Σ10（ADAPT 适应性）维度检查点设计

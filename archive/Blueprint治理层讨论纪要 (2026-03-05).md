# Blueprint 治理层讨论纪要

> 日期：2026-03-05
> 参与：用户 + Claude (Opus 4.6)
> 触发：OpenClaw 运行时 E2E 测试报告（67.75%）中 Blueprint 层未被使用的架构发现

## 背景

E2E 测试（`archive/AIDA端到端能力验证报告-OpenClaw运行时 (2026-03-05).md`）中，Aida 完全绕过了 Blueprint/Task/Rule 基础设施，仅使用 `bps_update_entity` + `bps_scan_work` + `bps_create_skill` 三个工具就完成了完整的业务运营管理流程。测试报告建议"如果不需要机器可查询的流程拓扑和流程可视化，Blueprint 层可以进一步简化或移除"。

## 用户观点（四点反馈中的第一点）

### 1. Dashboard 三问题

> 从人类角度而言，他们关心三件事：1- 现状是什么，2- 目标状态是什么，3- 下一步做什么（会发生什么）。Dashboard 的本质就是为了回答这三个问题。如果有更好的替代蓝图的实现机制，我持开放态度。

### 2. 治理层的必要性

> 我非常认同在操作运营层面要给 Agent 最大的决策自主权，但从商业项目运营的全局而言，是需要一个"宪法"级别的治理框架存在的。哪怕我们不强求 Agent 做什么，但是我们必须有刚性框架强制要求 Agent 不能做什么。当发生此类事件时，确保有一个机械的程序性引擎能断开 Agent 跟系统的连接。

> 所以即使运营层面不使用蓝图，我认为仍然有保留蓝图功能的必要，作为支持刚性治理框架的基础设施。

## 形成的共识

### 核心区分：运营层 vs 治理层

| | 运营层 | 治理层 |
|---|---|---|
| **关注** | Agent **应该做**什么 | Agent **不能做**什么 |
| **执行者** | Aida（AI 自主决策） | 机械引擎（零 AI 裁量权） |
| **时机** | 事后（做完了记录结果） | **事前**（做之前拦截） |
| **失败后果** | 业务不理想，可修正 | 断开连接，不可协商 |

### Dashboard 三问题的非 Blueprint 回答

- **现状** -> DossierStore 已经完美解决（版本化实体 + 审计轨迹）
- **目标状态** -> Action Plan 实体已经在做这件事（goals + items + progress）
- **下一步** -> Aida 的判断 + 治理层的约束条件 = 完整答案

结论：Blueprint-as-workflow 对这三个问题的贡献很小。Dashboard 三问题的具体实现方案在治理层机制完成后再设计。

### Blueprint 的新定位

保留 Blueprint，但从"流程编排器"变为"治理宪法"：

- 当前 Blueprint 系统试图做"正向编排"（do X then Y then Z）
- 用户要的是"负向约束"（NEVER do X, ALWAYS require Y before Z）
- Agent 越强大，治理层越重要——这不是矛盾，是互补

### 治理层的关键特征

1. **机械的** — 不经过 LLM，用 expr-eval 直接求值
2. **前置的** — 在工具执行前拦截，不是事后追溯
3. **不可绕过的** — Agent 无法"说服"它放行
4. **有熔断的** — 累积违规触发断路器，直接断开 Agent

### 执行机制草案

```
Agent 决策 -> [Action Gate] -> 工具执行
                  |
           Blueprint 约束检查
                  |
         PASS / BLOCK / REQUIRE_APPROVAL
                  | (累积违规)
           Circuit Breaker 状态机
         NORMAL -> WARNING -> RESTRICTED -> DISCONNECTED
```

OpenClaw 已有 Action Gating 机制（工具调用前置审批），Blueprint-as-Governance 本质上是把手动审批自动化为规则驱动的审批。

## 决策

1. **编写治理层设计文档**（Governance Specification），定义约束 schema、Action Gate 协议和 Circuit Breaker 状态机
2. **治理层完成后**再回来设计 Dashboard 三问题的实现方案
3. 同时记录的其他三点反馈及处理：
   - **#2 测试语言自然化**：已用自然业务语言重新测试，验证 Aida 可自主决策工具使用
   - **#3 Cron/Heartbeat**：已配置 OpenClaw 定时器测试系统驱动的 Heartbeat
   - **#4 DossierStore 数组合并**：已实现 smartMerge，数组追加替代覆盖（3 新测试）

## 后续文档

- 治理层设计文档：`docs/Agent 治理层规范 (AGS) v0.1.md`

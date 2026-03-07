# Agent 治理层规范 (Agent Governance Specification - AGS) v0.1

> 状态：草案
> 日期：2026-03-05
> 前置文档：`archive/Blueprint治理层讨论纪要 (2026-03-05).md`

---

## 1. 问题定义

AIDA 赋予 Agent 高度运营自主权（Skills + Entity + 自然语言推理）。E2E 测试证明 Aida 可以独立完成完整业务流程。但 Agent 越强大，越需要回答一个问题：

**如果 Agent 做了不该做的事，谁来阻止它？**

当前架构的答案是"没有人"——所有 12 个 BPS tools 都是直接执行的，没有前置检查。OpenClaw 的 Action Gating 机制提供了工具级开关（允许/禁止），但无法表达业务语义的约束条件。

治理层填补这个空白：在 Agent 和工具之间插入一个**机械的、不可绕过的约束检查层**。

## 2. 核心概念

### 2.1 运营层 vs 治理层

| | 运营层 (Operations) | 治理层 (Governance) |
|---|---|---|
| 职责 | Agent **应该做**什么 | Agent **不能做**什么 |
| 执行者 | Aida（AI 自主决策） | Governance Engine（零 AI 裁量权） |
| 时机 | 事后记录 | **事前拦截** |
| 判断方式 | LLM 推理 | expr-eval 确定性求值 |
| 可协商性 | Agent 可以解释、重试 | 不可协商，机械执行 |
| 失败后果 | 业务不理想，可修正 | BLOCK / 断开连接 |

### 2.2 术语

| 术语 | 定义 |
|------|------|
| **Constraint** | 一条约束规则，定义"什么条件下、什么动作、应被如何处置" |
| **Policy** | 一组 Constraints 的集合，构成某个治理领域的完整约束集 |
| **Action Gate** | 前置拦截器，在工具执行前检查所有适用的 Constraints |
| **Verdict** | 单次约束检查的结果：PASS / BLOCK / REQUIRE_APPROVAL |
| **Violation** | Constraint 检查未通过的事件记录 |
| **Circuit Breaker** | 熔断器，根据 Violation 累积情况决定 Agent 的执行权限级别 |

## 3. Constraint 定义

### 3.1 Schema

```yaml
# governance.yaml — 治理宪法
version: "1"
policies:
  - id: financial-controls
    label: "财务管控"
    constraints:
      - id: budget-cap
        label: "单次支出上限"
        scope:
          tools: ["bps_update_entity"]
          entityTypes: ["expense", "purchase-order"]
        condition: "amount <= 10000"
        on_violation: BLOCK
        severity: CRITICAL
        message: "单次支出 {amount} 超过上限 10,000"

      - id: large-expense-approval
        label: "大额支出需审批"
        scope:
          tools: ["bps_update_entity"]
          entityTypes: ["expense"]
        condition: "amount <= 5000 || status == 'approved'"
        on_violation: REQUIRE_APPROVAL
        severity: HIGH
        approver: owner
        message: "支出 {amount} 超过 5,000，需 Owner 审批"

  - id: data-protection
    label: "数据保护"
    constraints:
      - id: no-customer-deletion
        label: "禁止删除客户数据"
        scope:
          tools: ["bps_update_entity"]
          entityTypes: ["customer"]
        condition: "lifecycle != 'ARCHIVED'"
        on_violation: BLOCK
        severity: CRITICAL
        message: "禁止归档/删除客户数据"

      - id: business-hours-pricing
        label: "非营业时间不可改价"
        scope:
          tools: ["bps_update_entity"]
          entityTypes: ["product", "service-item"]
          dataFields: ["price", "unitPrice"]
        condition: "hour >= 9 && hour <= 18 && weekday >= 1 && weekday <= 5"
        on_violation: BLOCK
        severity: HIGH
        message: "当前为非营业时间，禁止修改定价"

  - id: operational-boundaries
    label: "运营边界"
    constraints:
      - id: entity-create-rate-limit
        label: "实体创建速率限制"
        scope:
          tools: ["bps_update_entity"]
        condition: "entity_creates_last_hour <= 100"
        on_violation: BLOCK
        severity: HIGH
        message: "过去 1 小时内已创建 {entity_creates_last_hour} 个实体，超过限制 100"

circuit_breaker:
  thresholds:
    - severity: CRITICAL
      max_violations: 1
      window: "1h"
      action: DISCONNECT
    - severity: HIGH
      max_violations: 5
      window: "1h"
      action: RESTRICT
  notify: [owner]
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | Y | 约束唯一标识 |
| `label` | string | Y | 人类可读描述 |
| `scope.tools` | string[] | Y | 适用的 BPS tool 名称 |
| `scope.entityTypes` | string[] | N | 适用的实体类型（不填=所有） |
| `scope.dataFields` | string[] | N | 仅当修改这些字段时触发检查 |
| `condition` | string | Y | expr-eval 表达式，求值为 true 表示**通过**，false 表示**违规** |
| `on_violation` | enum | Y | `BLOCK`（拒绝执行）或 `REQUIRE_APPROVAL`（等待人类审批） |
| `severity` | enum | Y | `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` |
| `approver` | string | N | `REQUIRE_APPROVAL` 时的审批角色 |
| `message` | string | Y | 违规时的提示信息，支持 `{variable}` 插值 |

### 3.3 Condition 求值上下文

Constraint 的 `condition` 表达式在以下变量上下文中求值：

```typescript
interface ConstraintEvalContext {
  // 来自工具调用参数
  entityType: string;
  entityId: string;
  tool: string;               // 当前工具名

  // 来自实体当前数据（bps_update_entity 时自动注入）
  [dataField: string]: unknown; // 实体 data 的所有字段，展平到顶层

  // 来自 patch（本次要写入的数据）
  _patch: Record<string, unknown>;

  // 时间上下文
  hour: number;               // 当前小时 (0-23)
  weekday: number;            // 星期几 (0=周日, 1=周一, ..., 6=周六)
  date: string;               // ISO 日期 "2026-03-05"

  // 统计上下文（由 Governance Engine 维护）
  entity_creates_last_hour: number;
  violations_last_hour: number;

  // 实体生命周期
  lifecycle: string;          // ACTIVE / ARCHIVED
  currentVersion: number;
}
```

**安全性**：condition 使用 expr-eval 沙箱求值，与 BPS 规则引擎使用相同的安全机制。不支持函数调用、赋值和副作用操作。

### 3.4 Scope 匹配规则

一个 Constraint 在以下条件**全部满足**时适用：

1. 当前调用的 tool 名称在 `scope.tools` 列表中
2. 如果指定了 `scope.entityTypes`，当前操作的 entityType 必须匹配
3. 如果指定了 `scope.dataFields`，本次 patch 必须包含其中至少一个字段

未指定的 scope 字段视为"不限制"（通配）。

## 4. Action Gate（前置拦截器）

### 4.1 执行位置

Action Gate 位于 Agent 工具调用和实际执行之间：

```
Agent 决策
    |
    v
[Tool Call: bps_update_entity({entityType, entityId, data})]
    |
    v
+-- Action Gate ------------------------------------------+
|  1. Scope Match: 找到所有适用的 Constraints              |
|  2. Context Build: 构建 eval 上下文（当前数据+patch+时间） |
|  3. Evaluate: 逐条 expr-eval 求值                       |
|  4. Verdict: PASS / BLOCK / REQUIRE_APPROVAL            |
|  5. Record: 写入 Violation 记录（无论结果）               |
|  6. Circuit Breaker Check: 检查是否触发熔断              |
+---------------------------------------------------------+
    |
    v (PASS)
[实际执行工具逻辑]
    |
    v (BLOCK)
[返回错误给 Agent，附带 violation 信息]
    |
    v (REQUIRE_APPROVAL)
[暂停执行，创建审批请求，等待人类决策]
```

### 4.2 实现接口

```typescript
interface ActionGateResult {
  verdict: 'PASS' | 'BLOCK' | 'REQUIRE_APPROVAL';
  /** 所有适用约束的检查结果 */
  checks: ConstraintCheck[];
  /** 熔断器当前状态 */
  circuitBreakerState: CircuitBreakerState;
}

interface ConstraintCheck {
  constraintId: string;
  policyId: string;
  passed: boolean;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message?: string;           // 违规时的插值后提示
}

type CircuitBreakerState = 'NORMAL' | 'WARNING' | 'RESTRICTED' | 'DISCONNECTED';
```

### 4.3 判定逻辑

1. 收集所有 scope 匹配的 Constraints
2. 逐条求值。如果任意一条结果为 BLOCK，最终 verdict = BLOCK
3. 如果无 BLOCK 但有 REQUIRE_APPROVAL，最终 verdict = REQUIRE_APPROVAL
4. 否则 PASS
5. 无论结果如何，所有失败的检查都记录为 Violation
6. 检查 Circuit Breaker：如果 Violation 累积触发熔断阈值，覆盖 verdict 为 BLOCK 并标记 DISCONNECT

### 4.4 拦截的工具范围

初始版本仅拦截**写操作**：

| 工具 | 是否拦截 | 理由 |
|------|---------|------|
| `bps_update_entity` | **是** | 实体状态变更是最核心的写操作 |
| `bps_create_task` | **是** | 创建任务记录 |
| `bps_update_task` | **是** | 任务状态变更 |
| `bps_complete_task` | **是** | 任务完成是不可逆操作 |
| `bps_create_skill` | **是** | Skill 创建影响 Agent 能力边界 |
| `bps_list_services` | 否 | 只读 |
| `bps_get_task` | 否 | 只读 |
| `bps_query_tasks` | 否 | 只读 |
| `bps_get_entity` | 否 | 只读 |
| `bps_query_entities` | 否 | 只读 |
| `bps_next_steps` | 否 | 只读 |
| `bps_scan_work` | 否 | 只读 |

## 5. Circuit Breaker（熔断器）

### 5.1 状态机

```
                  violation 累积
NORMAL ─────────────────────────> WARNING
  ^                                 |
  | 冷却期结束                       | 继续违规
  |                                 v
  +─────────────────────────── RESTRICTED
                                    |
                                    | 触发 CRITICAL 阈值
                                    v
                               DISCONNECTED
                                    |
                                    | 仅人类可恢复
                                    v
                                 NORMAL
```

### 5.2 状态说明

| 状态 | Agent 能力 | 触发条件 | 恢复方式 |
|------|-----------|---------|---------|
| **NORMAL** | 全部工具可用 | 默认状态 | - |
| **WARNING** | 全部工具可用，但每次写操作都生成告警 | HIGH 违规累积 | 冷却期自动恢复 |
| **RESTRICTED** | 仅只读工具可用，所有写操作被 BLOCK | HIGH 违规继续累积 | 人类手动恢复 |
| **DISCONNECTED** | Agent session 被终止 | CRITICAL 阈值触发 | 人类手动恢复并重启 |

### 5.3 阈值配置

在 `governance.yaml` 的 `circuit_breaker.thresholds` 中定义：

```yaml
circuit_breaker:
  thresholds:
    - severity: CRITICAL
      max_violations: 1       # 1 次 CRITICAL 违规
      window: "1h"            # 时间窗口
      action: DISCONNECT      # 直接断开
    - severity: HIGH
      max_violations: 5       # 5 次 HIGH 违规
      window: "1h"
      action: RESTRICT        # 限制为只读
    - severity: HIGH
      max_violations: 2
      window: "1h"
      action: WARNING         # 发出警告
  cooldown: "30m"             # WARNING 状态冷却期
  notify: [owner]             # 状态变更通知
```

### 5.4 DISCONNECTED 的实现

当 Circuit Breaker 进入 DISCONNECTED 状态时：

1. 记录完整的违规链到 DossierStore（`entityType="governance-incident"`）
2. 通过 OpenClaw 事件系统发射 `bps.governance.disconnect` 事件
3. 所有后续工具调用返回 BLOCK + disconnect 原因
4. 通知 owner（通过 OpenClaw 通知渠道）
5. 恢复需要人类通过 Dashboard 或 OpenClaw 命令行手动操作

## 6. Violation 记录

### 6.1 存储

Violation 记录存入专用 SQLite 表 `bps_governance_violations`（非 DossierStore）：

```typescript
interface ViolationRecord {
  constraintId: string;
  policyId: string;
  severity: string;
  tool: string;
  entityType?: string;
  entityId?: string;
  verdict: string;            // BLOCK / REQUIRE_APPROVAL
  condition: string;          // 原始表达式
  evalContext: Record<string, unknown>;  // 求值时的上下文快照
  message: string;            // 插值后的提示
  timestamp: string;
  circuitBreakerState: string;
}
```

### 6.2 审计价值

Violation 记录提供完整的审计链：

- **什么时候**：timestamp
- **谁触发的**：Agent session（通过 OpenClaw 事件上下文）
- **做了什么**：tool + entityType + entityId + patch
- **违反了什么**：constraintId + condition
- **系统如何响应**：verdict + circuitBreakerState
- **完整上下文**：evalContext 快照，支持事后复盘

## 7. REQUIRE_APPROVAL 流程

### 7.1 与现有 Approvals 页面的集成

Phase C 的 Dashboard Approvals 页面已经实现了审批队列。治理层的 REQUIRE_APPROVAL 与此自然衔接：

1. Action Gate 判定 REQUIRE_APPROVAL
2. 创建审批请求（写入 DossierStore，`entityType="approval-request"`）
3. Dashboard SSE 推送新审批请求
4. Approvals 页面展示：约束信息 + 工具调用详情 + 审批按钮
5. 人类决策：Approve / Reject
6. Approve → 绕过此次约束检查，执行工具调用（记录审批人和时间）
7. Reject → 返回 BLOCK 给 Agent

### 7.2 审批超时

```yaml
approval:
  timeout: "4h"              # 4 小时未审批自动 Reject
  on_timeout: BLOCK          # 超时处置
```

## 8. 数据模型

### 8.1 新增 SQLite 表

```sql
-- 治理约束定义（从 governance.yaml 加载）
CREATE TABLE IF NOT EXISTS bps_governance_constraints (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  label TEXT NOT NULL,
  scope_json TEXT NOT NULL,    -- JSON: { tools, entityTypes?, dataFields? }
  condition TEXT NOT NULL,     -- expr-eval 表达式
  on_violation TEXT NOT NULL,  -- BLOCK | REQUIRE_APPROVAL
  severity TEXT NOT NULL,      -- CRITICAL | HIGH | MEDIUM | LOW
  approver TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 违规记录
CREATE TABLE IF NOT EXISTS bps_governance_violations (
  id TEXT PRIMARY KEY,
  constraint_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  tool TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  verdict TEXT NOT NULL,
  condition TEXT NOT NULL,
  eval_context TEXT NOT NULL,  -- JSON
  message TEXT NOT NULL,
  circuit_breaker_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (constraint_id) REFERENCES bps_governance_constraints(id)
);

-- 熔断器状态
CREATE TABLE IF NOT EXISTS bps_governance_circuit_breaker (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  state TEXT NOT NULL DEFAULT 'NORMAL',
  last_state_change TEXT NOT NULL,
  violation_count_critical INTEGER NOT NULL DEFAULT 0,
  violation_count_high INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 审批请求
CREATE TABLE IF NOT EXISTS bps_governance_approvals (
  id TEXT PRIMARY KEY,
  constraint_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  tool_input TEXT NOT NULL,    -- JSON: 原始工具调用参数
  entity_type TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED | TIMEOUT
  approved_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (constraint_id) REFERENCES bps_governance_constraints(id)
);

CREATE INDEX idx_violations_time ON bps_governance_violations(created_at);
CREATE INDEX idx_violations_severity ON bps_governance_violations(severity, created_at);
CREATE INDEX idx_approvals_status ON bps_governance_approvals(status);
```

## 9. governance.yaml 加载

### 9.1 文件位置

```
~/.aida/
├── governance.yaml           # 治理宪法（新增）
├── project.yaml
├── blueprints/
├── data/
└── context/
```

### 9.2 加载时机

`loadAidaProject()` 扩展：在加载 project.yaml 和 blueprints 之后，加载 governance.yaml。

```typescript
interface AidaProjectResult {
  // 现有
  engine: BpsEngine;
  project: ProjectManifest;
  blueprintCount: number;
  // 新增
  governanceEngine?: GovernanceEngine;
}
```

### 9.3 热加载

governance.yaml 变更时支持热重载（无需重启 OpenClaw）：
- 新增 BPS tool `bps_reload_governance`（或 Dashboard API `POST /api/governance/reload`）
- 仅 Constraint 定义重载，Violation 记录和 Circuit Breaker 状态保留

## 10. 工具集成

### 10.1 Action Gate 包装

在 `registerBpsPlugin()` 中，对写操作工具进行 Action Gate 包装：

```typescript
function wrapWithGovernance(
  tool: OpenClawAgentTool,
  gate: ActionGate,
): OpenClawAgentTool {
  return {
    ...tool,
    async execute(callId: string, input: unknown) {
      // 1. 前置检查
      const result = gate.check(tool.name, input);

      // 2. 熔断检查
      if (result.circuitBreakerState === 'DISCONNECTED') {
        return {
          success: false,
          governance_blocked: true,
          reason: 'Agent has been disconnected by circuit breaker.',
          violations: result.checks.filter(c => !c.passed),
        };
      }

      if (result.circuitBreakerState === 'RESTRICTED') {
        return {
          success: false,
          governance_blocked: true,
          reason: 'Agent is in RESTRICTED mode. Only read operations are allowed.',
        };
      }

      // 3. 约束检查
      if (result.verdict === 'BLOCK') {
        return {
          success: false,
          governance_blocked: true,
          reason: 'Action blocked by governance constraint.',
          violations: result.checks.filter(c => !c.passed),
        };
      }

      if (result.verdict === 'REQUIRE_APPROVAL') {
        // 创建审批请求，返回待审批状态
        const approvalId = gate.createApprovalRequest(tool.name, input, result);
        return {
          success: false,
          governance_pending_approval: true,
          approvalId,
          reason: 'Action requires human approval.',
          constraints: result.checks.filter(c => !c.passed),
        };
      }

      // 4. PASS — 正常执行
      return tool.execute(callId, input);
    },
  };
}
```

### 10.2 新增 BPS Tools

| # | Tool | 说明 |
|---|------|------|
| 13 | `bps_governance_status` | 查询当前 Circuit Breaker 状态 + 最近违规记录 |

此工具为只读，不受 Action Gate 拦截：

```typescript
// bps_governance_status: Agent 可以查询自身的治理状态
{
  circuitBreakerState: 'NORMAL',
  recentViolations: [...],
  activeConstraints: 42,
  pendingApprovals: 1,
}
```

### 10.3 Dashboard API

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/governance/status` | Circuit Breaker 状态 + 统计 |
| `GET` | `/api/governance/violations` | 违规记录列表（支持 limit 参数） |
| `GET` | `/api/governance/constraints` | 当前活跃的约束列表 |
| `GET` | `/api/governance/approvals` | 治理层待审批列表 |
| `POST` | `/api/governance/approvals/:id/decide` | 审批/拒绝（附带 decision + reason） |
| `POST` | `/api/governance/circuit-breaker/reset` | 重置 Circuit Breaker 为 NORMAL |

## 11. 实现优先级

### Phase E1: 核心 Gate（最小可用）

1. `governance.yaml` schema 定义 + 解析器
2. `GovernanceStore`（约束加载 + 违规记录 + Circuit Breaker 状态）
3. `ActionGate`（scope 匹配 + expr-eval 求值 + verdict 判定）
4. `wrapWithGovernance()` 包装 `bps_update_entity`
5. `bps_governance_status` tool
6. 测试：约束加载、PASS/BLOCK 判定、违规记录、Circuit Breaker 状态机

### Phase E2: Circuit Breaker + Approval

1. Circuit Breaker 状态机完整实现（NORMAL -> WARNING -> RESTRICTED -> DISCONNECTED）
2. REQUIRE_APPROVAL 流程（与 Dashboard Approvals 页面集成）
3. Dashboard Governance Panel（违规列表 + 熔断器状态 + 重置按钮）
4. 审批超时处理
5. 测试：熔断阈值、审批流程、状态恢复

### Phase E3: 运营化

1. `loadAidaProject()` 集成（自动加载 governance.yaml）
2. 热重载支持
3. Aida AGENTS.md 更新（Agent 感知治理层的存在）
4. install-aida.sh 更新（governance.yaml 示例部署）
5. 晨光咖啡场景的治理约束示例

## 12. 设计约束

### 12.1 不做的事

- **不做运行时流程编排**。治理层只判断 PASS/BLOCK/REQUIRE_APPROVAL，不指导 Agent 该做什么。
- **不引入 LLM 判断**。所有 condition 必须是 expr-eval 可求值的确定性表达式。模糊的治理规则不是治理规则。
- **不替代 OpenClaw 的权限系统**。治理层是业务语义的约束，不是技术层面的 ACL。两者互补。
- **不追求覆盖所有工具**。初始版本只拦截写操作。只读操作天然安全。

### 12.2 关键不变量

1. **机械性**：Governance Engine 的代码路径中没有 LLM 调用，没有概率判断，没有"也许"。
2. **前置性**：被 BLOCK 的操作绝不会执行。不是"执行完了再检查"。
3. **不可绕过性**：Agent 无法通过重新措辞或分步操作绕过约束。约束在工具层面拦截。
4. **完全可审计**：每次约束检查（无论 PASS 还是 BLOCK）都有记录可查。
5. **人类最终控制权**：Circuit Breaker DISCONNECTED 状态只有人类可以恢复。

---

## 附录 A：与现有 BPS 概念的关系

| BPS 概念 | 治理层中的角色 | 说明 |
|----------|-------------|------|
| Blueprint YAML | 被 governance.yaml 替代其治理职责 | Blueprint 的"正向编排"价值由 Agent 自主完成；"负向约束"价值由治理层接管 |
| Rule/Event | Constraint 继承了 expr-eval 求值机制 | 但 scope 匹配替代了 event 订阅 |
| Service | scope.tools 映射 | 约束绑定到具体工具而非抽象 service |
| Process | Violation 记录 | 违规是新的"进程"——有起因、上下文和结果 |
| DossierStore | 违规和审批请求的存储后端 | 复用版本化 JSON 文档的审计能力 |

## 附录 B：晨光咖啡治理示例

```yaml
version: "1"
policies:
  - id: store-operations
    label: "门店运营规范"
    constraints:
      - id: opening-hours
        label: "开店流程只能在 6:00-10:00 执行"
        scope:
          tools: ["bps_update_entity"]
          entityTypes: ["store_daily_opening"]
        condition: "hour >= 6 && hour <= 10"
        on_violation: BLOCK
        severity: HIGH
        message: "开店流程仅允许在 6:00-10:00 执行，当前时间 {hour}:{minute}"

      - id: max-stores-per-day
        label: "单日新开门店不超过 3 家"
        scope:
          tools: ["bps_update_entity"]
          entityTypes: ["store"]
        condition: "stores_created_today <= 3"
        on_violation: REQUIRE_APPROVAL
        severity: HIGH
        approver: owner
        message: "今日已新增 {stores_created_today} 家门店，超过单日限制"

  - id: skill-governance
    label: "Skill 治理"
    constraints:
      - id: skill-create-approval
        label: "创建新 Skill 需审批"
        scope:
          tools: ["bps_create_skill"]
        condition: "false"
        on_violation: REQUIRE_APPROVAL
        severity: MEDIUM
        approver: owner
        message: "Agent 请求创建新 Skill: {name}"

circuit_breaker:
  thresholds:
    - severity: CRITICAL
      max_violations: 1
      window: "1h"
      action: DISCONNECT
    - severity: HIGH
      max_violations: 3
      window: "1h"
      action: RESTRICT
  cooldown: "15m"
  notify: [owner]
```

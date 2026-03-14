# 信息饱和信号机制设计 (Information Saturation Signal) v0.1

> 解决 AIDA 中 Agent "说而不做" (Say-Not-Do) 反模式的多层干预机制

## 问题定义

### 现象

六个 LLM 模型在 E2E 测试中均表现出同一反模式：Agent 在信息收集阶段持续调用读操作工具（`bps_query_entities`, `bps_scan_work`, `bps_get_entity`），输出高质量的自然语言分析，但始终不转入写操作（`bps_update_entity`, `bps_create_task`, `bps_complete_task`）。

**量化证据**（v3 vs v2 对比）：
- v2（有 MEMORY.md 先验上下文）：87/100 分
- v3（清除所有 memory）：60/100 分（-27 分）
- 差距完全集中在"工具调用率"维度 — 基础设施层 100% 通过

### 理论归因

基于三框架差距分析（`archive/AIDA差距分析-三框架视角 (2026-03-11).md`）：

| 编号 | 框架 | 诊断 | 解释 |
|------|------|------|------|
| BR-6 | 有限理性 | 搜索-执行间隙 | 缺少"足够好"信号，Agent 无限延长信息收集阶段 |
| BR-1 | 有限理性 | 信息量超载 | 工具返回数据过多，Agent 认知负载过高 |
| BR-2 | 有限理性 | 决策支持缺失 | 工具只返回数据，不返回决策建议 |
| CT-3 | 控制论 | 反馈回路缺失 | Agent 无法感知自己的执行进度偏差 |

**P1-b 信息摘要层已解决**：BR-1（`topN()` + `brief` 模式 + `summary` 字符串）
**未解决**：BR-2（决策支持）、BR-6（满意阈值信号）、CT-3（执行进度反馈）

### 核心洞察

Simon 的有限理性理论揭示：理性 Agent 不追求最优解，而是在信息达到"足够好"（satisficing）时停止搜索并执行。AIDA 当前缺少的不是信息量控制（P1-b 已做），而是告诉 Agent **"你已经知道够多了，现在该行动了"** 的信号。

---

## 设计原则

1. **多层叠加，非互斥**：四个干预层各自独立，效果叠加，任意单层失效不影响其他层
2. **最小侵入**：优先修改工具返回值和 Workspace 指令，不改变 BPS 核心数据模型
3. **模型无关**：机制对所有 LLM 有效，不依赖特定模型的 system prompt 遵从能力
4. **可度量**：每个干预层有明确的成功指标（见 §评估 ）

---

## 机制 A：工具层 — 饱和信号注入

### A1. 查询完成度信号

**改动文件**：`src/integration/tools.ts`

在 `bps_query_entities` 返回值中注入 `_signal` 字段：

```typescript
// bps_query_entities 返回值增强
return {
  count: limited.length,
  totalCount: results.length,
  entities: limited.map(r => /* ... */),
  // 新增：饱和信号
  _signal: {
    completeness: limited.length >= results.length ? 'FULL' : 'PARTIAL',
    hint: limited.length >= results.length
      ? 'All matching entities returned. You have complete visibility — proceed to action.'
      : `Showing ${limited.length} of ${results.length}. Use filters to narrow, or proceed with current data if sufficient.`,
  },
};
```

**关键设计**：
- `completeness: 'FULL'` 是显式的饱和信号 — 告诉 Agent 没有未见数据
- `hint` 用自然语言引导执行（"proceed to action"）
- 当 `PARTIAL` 时不阻止执行，而是建议"当前数据是否足够"

### A2. bps_scan_work 执行提示

**改动文件**：`src/integration/tools.ts`

`bps_scan_work` 已有 `summary` 字段。增强为包含执行指引：

```typescript
// bps_scan_work 返回值增强
const actionableCount = overdueTasks.length + failedTasks.length + openTasks.length;

return {
  summary,
  // 新增：执行指引
  _signal: {
    actionableItems: actionableCount,
    readiness: actionableCount > 0 ? 'ACTION_NEEDED' : 'ALL_CLEAR',
    hint: actionableCount > 0
      ? `${actionableCount} items need action. Start with overdue/failed tasks, then open tasks by priority.`
      : 'No pending work. Check action plans for upcoming items.',
  },
  overdueTasks: /* ... */,
  // ...rest
};
```

### A3. 连续读操作计数器

**改动文件**：`src/integration/tools.ts`

在 BPS 工具集的闭包层面维护一个 per-session 计数器：

```typescript
// 在 createBpsTools() 函数体内（闭包作用域）
let consecutiveReads = 0;
const READ_TOOLS = new Set([
  'bps_list_services', 'bps_get_task', 'bps_query_tasks',
  'bps_get_entity', 'bps_query_entities', 'bps_next_steps',
  'bps_scan_work', 'bps_management_status',
]);
const CONSECUTIVE_READ_THRESHOLD = 5;

// 包装每个工具的 execute 方法
function wrapWithReadCounter(tool: OpenClawAgentTool): OpenClawAgentTool {
  const originalExecute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(callId: string, input: unknown) {
      const result = await originalExecute(callId, input);

      if (READ_TOOLS.has(tool.name)) {
        consecutiveReads++;
        if (consecutiveReads >= CONSECUTIVE_READ_THRESHOLD) {
          // 注入饱和提醒（不改变原始返回结构）
          if (typeof result === 'object' && result !== null) {
            (result as Record<string, unknown>)._readSignal = {
              consecutiveReads,
              message: `You have made ${consecutiveReads} consecutive read calls without any write action. `
                + `If you have enough information, proceed to execute. `
                + `Describe → bps_update_entity. Plan → bps_create_task. Complete → bps_complete_task.`,
            };
          }
        }
      } else {
        // 写操作重置计数器
        consecutiveReads = 0;
      }

      return result;
    },
  };
}
```

**关键设计**：
- 阈值 5 次连续读操作 — 基于 R7 数据，正常的"扫描→定位→执行"模式通常在 3 次读操作内完成
- 计数器在任意写操作后重置
- 提醒文字包含**具体的工具名映射**（describe→update_entity, plan→create_task），降低 Agent 的行动搜索成本
- `_readSignal` 字段名以下划线开头，表示元数据（不会被存入 Dossier）

---

## 机制 B：工具层 — 决策支持增强

### B1. bps_scan_work 返回 suggestedActions

**改动文件**：`src/integration/tools.ts`

基于当前工作全景，生成具体的建议操作列表：

```typescript
// bps_scan_work 新增 suggestedActions
const suggestedActions: Array<{
  tool: string;
  reason: string;
  params: Record<string, unknown>;
}> = [];

// 规则 1：逾期任务 → 建议更新状态或标记失败
for (const t of overdueTasks.slice(0, 3)) {
  suggestedActions.push({
    tool: 'bps_update_task',
    reason: `Task #${t.pid} is overdue (deadline: ${t.deadline})`,
    params: { processId: t.id, state: 'IN_PROGRESS' },
  });
}

// 规则 2：失败任务 → 建议重新创建
for (const t of failedTasks.slice(0, 2)) {
  suggestedActions.push({
    tool: 'bps_create_task',
    reason: `Retry failed task #${t.pid} (${t.serviceId})`,
    params: { serviceId: t.serviceId, entityType: t.entityType, entityId: t.entityId },
  });
}

// 规则 3：Action Plan 有到期项 → 建议执行
for (const plan of activePlans) {
  const items = (plan.data as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined;
  if (items) {
    const dueItems = items.filter(item =>
      item.status !== 'done' && item.dueDate && (item.dueDate as string) <= nowIso
    );
    if (dueItems.length > 0) {
      suggestedActions.push({
        tool: 'bps_create_task',
        reason: `Action plan "${plan.dossier.entityId}" has ${dueItems.length} due item(s)`,
        params: { serviceId: 'action-plan-item', entityId: plan.dossier.entityId },
      });
    }
  }
}

return {
  summary,
  _signal: { /* A2 信号 */ },
  suggestedActions: suggestedActions.slice(0, 5),
  // ...rest
};
```

**关键设计**：
- `suggestedActions` 包含**完整的工具名和参数** — Agent 可以直接复制参数执行
- 最多 5 个建议（避免信息过载）
- 每个建议有 `reason`（解释"为什么"）和 `params`（解释"怎么做"）
- 这直接解决 BR-2（决策支持缺失）— 从"数据展示"升级为"行动建议"

### B2. bps_next_steps 返回 readyToExecute 标记

**改动文件**：`src/integration/tools.ts`

当所有前置条件满足时，明确标记"可以执行"：

```typescript
// bps_next_steps 增强
return {
  completedService: { id: service.id, label: service.label },
  nextSteps: steps.map(s => ({
    // ...existing fields...
    readyToExecute: s.evaluationMode === 'deterministic'
      ? evaluateDeterministic(s.eventExpression, currentValues)
      : undefined, // 非确定性事件需 Agent 自判
  })),
  recommendation,
  // 新增：明确的执行指令
  _signal: {
    readySteps: steps.filter(s =>
      s.evaluationMode === 'deterministic' && evaluateDeterministic(s.eventExpression, currentValues)
    ).length,
    hint: 'Steps marked readyToExecute=true have all conditions met. Call bps_create_task to start them.',
  },
};
```

> **注意**：`evaluateDeterministic()` 使用 expr-eval 安全求值。如果 currentValues 未提供或变量缺失，返回 `undefined`（非 false），不误导 Agent。

---

## 机制 C：指令层 — Workspace 文件增强

### C1. AGENTS.md 新增 "Execution Discipline" 节

**改动文件**：`agents/aida/AGENTS.md`

在 "Red Lines" 之后新增：

```markdown
# Execution Discipline

## Read-Write Balance

After 3 consecutive read-only tool calls, you MUST either:
1. **Execute**: Call a write tool (bps_update_entity, bps_create_task, etc.)
2. **Justify**: Explicitly state what specific information you still lack and which tool call will provide it

If you cannot name what you're missing, you have enough information. Act now.

## Act, Don't Describe

When you know what needs to happen:
- ❌ "We should update the entity status to active" (description)
- ✅ Call `bps_update_entity` with `{ data: { status: "active" } }` (action)

A natural-language description of a tool call is NOT a substitute for the tool call itself.
This is Red Line #1 restated for emphasis: **describing is not doing.**

## Satisficing Rule

"Good enough now" beats "perfect later." If you have:
- Entity type and ID → you can call `bps_update_entity`
- Service ID → you can call `bps_create_task`
- Task ID → you can call `bps_complete_task`

Don't wait for complete information to act. Entities are version-controlled (smartMerge) — partial updates are safe and expected.
```

### C2. HEARTBEAT.md 增强执行门控

**改动文件**：`agents/aida/HEARTBEAT.md`

在 Step 1 和 Step 4 之间增加执行检查点：

```markdown
# Heartbeat Checklist

1. Scan failures: `bps_query_tasks state=FAILED` → diagnose, recover or escalate
2. Check plans: `bps_query_entities entityType=action-plan` → find active plans with due items
3. Capability coverage: for each due item in active plans, check against existing Skills AND Agents. Apply the Skill vs Agent decision (AGENTS.md § Self-Evolution) — flag items as skill gaps or agent gaps accordingly.
4. **Execution gate**: You MUST have called at least one write tool (bps_update_entity / bps_create_task / bps_complete_task) before proceeding to step 5. If steps 1-3 revealed work to do but you haven't acted yet, go back and execute now.
5. Execute remaining due items per `business-execution` skill
6. Report at observation points defined in the plan
7. Pattern reflection: review recent completed tasks — if you've done similar work 3+ times, evaluate whether the pattern warrants a Skill or an independent Agent, then propose via `skill-create` or `agent-create`
```

**关键设计**：Step 4 是显式的执行门控 — 如果 Agent 跳过了写操作，checklist 强制它回溯。这利用了 LLM 对 ordered-checklist 的高遵从度（R3 数据：97/128 检查点通过，checklist 遵从率 96%）。

### C3. TOOLS.md 增强 Common Patterns

**改动文件**：`agents/aida/TOOLS.md`

在 "Common Patterns" 节增加执行范式：

```markdown
## Execution Patterns (Anti-"Say-Not-Do")

- **Entity discovery → action**: `bps_query_entities` (brief=true) → pick target → `bps_update_entity` (in same turn)
- **Work scan → triage**: `bps_scan_work` → read `suggestedActions` → execute top suggestion immediately
- **Heartbeat loop**: scan → act → report. Never scan → report without acting.
- **Read budget**: 3 reads max before 1 write. If `_readSignal` appears in tool results, you've exceeded the budget — act now.
```

---

## 机制 D：引导层 — MEMORY.md 工具调用模式预置

### D1. 成功模式预置

**改动文件**：`agents/aida/MEMORY.md`（运行时生成，由 install-aida.sh 初始化）

在 MEMORY.md 初始化模板中预置工具调用成功模式：

```markdown
## Tool Call Patterns (from successful runs)

### Entity Lifecycle
1. `bps_query_entities brief=true` → get list (1 read)
2. `bps_get_entity` → get details for target (1 read)
3. `bps_update_entity` → update with new data (1 write)
Total: 2 reads + 1 write ✓

### Content Production
1. `bps_scan_work` → find due items (1 read)
2. `bps_create_task` → create work item (1 write)
3. Write content to file (1 external action)
4. `bps_update_entity` → record output reference (1 write)
5. `bps_complete_task` → mark done (1 write)
Total: 1 read + 3 writes ✓

### Management Interaction
1. `bps_update_entity` with status change → may trigger REQUIRE_APPROVAL
2. If approved: entity auto-updated by management system
3. `bps_management_status` → verify approval processed (1 read)
Total: 1 write + 1 read ✓
```

**依据**：v2 vs v3 对比证明 MEMORY.md 先验上下文有 +27 分的效果。预置工具调用模式可以建立"读写比"的心理模型。

### D2. install-aida.sh 集成

**改动文件**：`deploy/install-aida.sh`

在初始化 Agent workspace 时写入 MEMORY.md 模板（如果不存在）：

```bash
MEMORY_FILE="$WORKSPACE_DIR/MEMORY.md"
if [ ! -f "$MEMORY_FILE" ]; then
  cat > "$MEMORY_FILE" << 'MEMORY_EOF'
# Aida Memory

## Tool Call Patterns (from successful runs)
# ... D1 内容 ...
MEMORY_EOF
fi
```

---

## 实现计划

### 阶段 1：工具层信号注入（机制 A + B）

**影响范围**：`src/integration/tools.ts` 单文件
**改动量**：~120 行新增，~20 行修改
**测试**：~10 个新测试

| 改动 | 优先级 | 依赖 |
|------|--------|------|
| A1. `bps_query_entities` `_signal.completeness` | P0 | 无 |
| A2. `bps_scan_work` `_signal.readiness` | P0 | 无 |
| A3. 连续读操作计数器 `_readSignal` | P0 | 无 |
| B1. `bps_scan_work` `suggestedActions` | P1 | 无 |
| B2. `bps_next_steps` `readyToExecute` | P1 | 无 |

### 阶段 2：指令层增强（机制 C）

**影响范围**：4 个 Workspace 文件
**改动量**：~40 行新增
**测试**：下一轮 E2E 测试验证

| 改动 | 优先级 | 依赖 |
|------|--------|------|
| C1. AGENTS.md "Execution Discipline" 节 | P0 | 无 |
| C2. HEARTBEAT.md 执行门控 Step 4 | P0 | 无 |
| C3. TOOLS.md 执行模式 | P1 | 无 |

### 阶段 3：引导层预置（机制 D）

**影响范围**：MEMORY.md 模板 + install-aida.sh
**改动量**：~30 行新增
**测试**：E2E 干净环境测试

| 改动 | 优先级 | 依赖 |
|------|--------|------|
| D1. MEMORY.md 工具调用模式模板 | P0 | 无 |
| D2. install-aida.sh 集成 | P1 | D1 |

---

## 评估指标

### 成功标准

| 指标 | 当前基线（R7 平均） | 目标 | 测量方法 |
|------|---------------------|------|----------|
| 写操作占比 | ~25% | ≥40% | Session JSONL: write_calls / total_bps_calls |
| 首次写操作位置 | Turn 3-4 | Turn 1-2 | Session JSONL: first write tool call turn |
| 连续读操作最大长度 | 8-12 | ≤5 | Session JSONL: max consecutive read streak |
| E2E 加权总分 | 5.6/10（R7 六模型平均） | ≥7.5/10 | aef-capability.sh 标准跑分 |
| "说而不做"检测 | 人工判断 | `_readSignal` 出现次数 ≤2 | Session JSONL: `_readSignal` count |

### AEF 维度映射

| 机制 | 解决的 AEF 维度 | 解决的差距编号 |
|------|----------------|---------------|
| A1-A3 | Σ6 INFO | BR-6 (搜索-执行间隙) |
| B1-B2 | Σ6 INFO + Σ7 SCHED | BR-2 (决策支持缺失) |
| C1-C3 | Σ11 MATCH | BR-3 (满意阈值机制) |
| D1-D2 | Σ11 MATCH | CT-3 (反馈回路缺失) |

### 验证方案

1. **单元测试**：验证 `_signal`, `_readSignal`, `suggestedActions` 返回值正确性
2. **结构能力测试**：`aef-capability.sh` 增加 Σ6/Σ11 检查点（连续读计数、写操作占比）
3. **E2E 对比测试**：同一模型（Qwen3.5-Plus），在有/无机制的环境下各跑 1 轮，对比写操作占比和加权总分
4. **六模型横评**：全部机制落地后跑 R8，对比 R7 基线

---

## 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| `_signal` / `_readSignal` 被 LLM 忽略 | 中 | 多层叠加：即使工具层信号被忽略，AGENTS.md 指令层和 MEMORY.md 引导层仍然生效 |
| 过度激进导致 Agent 在信息不足时执行 | 中 | A3 阈值设为 5（非 3），AGENTS.md 明确"如果能说出缺什么，继续读"的安全出口 |
| `suggestedActions` 建议不准确 | 低 | 建议基于简单规则（逾期→更新、失败→重试），不涉及业务语义判断 |
| MEMORY.md 预置模式固化 Agent 行为 | 低 | 模式是"范式"非"指令"，Agent 可根据实际情况调整；且 MEMORY.md 可被 Agent 自行修改 |
| 工具返回值体积增加 | 低 | `_signal` 约增 80 bytes/call，`suggestedActions` 约增 500 bytes/call（仅 scan_work），占比极小 |

---

## 与已有机制的关系

```
P1-b 信息摘要层 (已完成)
  ├── topN(), brief, summary   → 解决 BR-1 (信息量超载)
  └── recommendation            → 部分解决 BR-2 (单点建议)

信息饱和信号 (本设计)
  ├── 机制 A: 饱和信号注入       → 解决 BR-6 (搜索终止信号)
  ├── 机制 B: 决策支持增强       → 完整解决 BR-2 (多点行动建议)
  ├── 机制 C: 执行纪律指令       → 解决 BR-3 (满意阈值机制)
  └── 机制 D: 工具模式预置       → 解决 CT-3 (执行反馈回路)
```

P1-b 是"信息减量"（让 Agent 看到更少但更精的数据），本设计是"执行催化"（让 Agent 知道何时该停止看、开始做）。两者互补，不重叠。

# AIDA x OpenClaw Hook 与 Multi-Agent 机制增强评估

**评估日期：2026-03-13**
**基于：OpenClaw 框架技术研究报告 v2（官方文档）**

---

## 评估目标

深入研究 OpenClaw 的 **Plugin Hooks** 和 **Multi-Agent/Sub-Agent** 机制，评估其在 AIDA 中的进一步利用空间，提出具体的增强方案。

---

## 一、当前 AIDA 利用 OpenClaw 的状态

### 1.1 已充分利用的机制

| 机制 | AIDA 实现 | 评价 |
|------|----------|------|
| Plugin System | `registerBpsPlugin()` 入口 | 完备 |
| Tool Registration | 14 BPS tools + 5 治理包装 | 完备 |
| Workspace Files | 7 Bootstrap 文件 + 7 Skills | 完备 |
| Event Bridge | 双向桥接（BPS↔OC 4 事件） | 完备 |
| 安全配置 | `tools.exec.security: allowlist` | 已落地 |

### 1.2 未利用的核心机制

| 机制 | 当前状态 | 潜在价值 |
|------|----------|---------|
| **Plugin Hooks** | 0 个 Hook 注册 | 高 |
| **Multi-Agent Binding** | 单 Agent 模式 | 中 |
| **Sub-Agent (sessions_spawn)** | 有意不用 | 低-中 |
| **Steer 机制** | 未使用 | 中 |
| **Orchestrator 模式** | 未使用 | 中 |

---

## 二、Plugin Hooks 深度分析

OpenClaw 提供 **14 种生命周期 Hook**，AIDA 当前使用 **0 个**。以下是逐一评估：

### 2.1 高价值 Hook（建议实现）

#### 2.1.1 `before_tool_call` / `after_tool_call` — 治理层迁移

**当前问题**：
- 治理检查在 JS 工具包装层实现（`wrapWithGovernance`）
- 只能拦截 BPS 工具，无法拦截 OpenClaw 原生工具（`write`/`edit`/`exec`）
- 这正是 IdleX GEO E2E 测试中 P0 问题——Agent 通过文件 I/O 绕过治理

**增强方案**：
```typescript
// 在 plugin.ts 中注册 Hook
api.on('before_tool_call', async (payload) => {
  const { tool, input, sessionId } = payload;

  // 治理检查扩展到所有工具
  if (tool === 'write' || tool === 'edit' || tool === 'apply_patch') {
    // 检查是否涉及业务数据路径
    const inputPath = input.path || '';
    if (inputPath.includes('.aida/') || inputPath.includes('bps.db')) {
      throw new Error(
        `GOVERNANCE BLOCKED: Direct file I/O to AIDA data directory is prohibited. ` +
        `Use bps_update_entity instead.`
      );
    }
  }

  // 原有 BPS 工具治理检查保持不变
  if (tool.startsWith('bps_')) {
    return governanceGate.check(tool, input);
  }
});
```

**收益**：
- 堵住文件 I/O 治理绕过漏洞
- 统一治理入口点（不再需要在每个工具包装）

---

#### 2.1.2 `session_start` — 项目初始化自动化

**当前问题**：
- 项目初始化逻辑分散在 BOOT.md + AGENTS.md
- 需要依赖 `hooks.internal.enabled` 才能触发 BOOT.md
- Session 首次启动时没有可靠的项目状态检测

**增强方案**：
```typescript
api.on('session_start', async (payload) => {
  const { sessionKey, agentId } = payload;

  // 检测是否为主会话
  if (!sessionKey.includes('subagent')) {
    const projectExists = fs.existsSync(path.join(os.homedir(), '.aida', 'project.yaml'));

    if (!projectExists) {
      // 注入初始化提示到首次消息
      return {
        prependContext: '⚠️ Project not initialized. Guide user through project-init skill first.'
      };
    }
  }
});
```

**收益**：
- 新用户首次对话时自动引导初始化
- 不依赖 BOOT.md 的 `hooks.internal.enabled` 配置

---

#### 2.1.3 `agent_end` — 任务完成审计

**当前问题**：
- 任务完成后没有自动审计
- Dashboard 只能看到工具调用结果，看不到 Agent 最终决策

**增强方案**：
```typescript
api.on('agent_end', async (payload) => {
  const { messages, sessionKey, tokenUsage } = payload;

  // 提取关键决策（最后一条非工具调用的 assistant 消息）
  const lastAssistantMsg = messages.filter(m => m.role === 'assistant').pop();

  // 记录到审计日志
  auditLogger.log({
    event: 'agent_end',
    sessionKey,
    summary: lastAssistantMsg?.content?.slice(0, 500),
    tokenUsage,
    timestamp: new Date().toISOString()
  });
});
```

**收益**：
- 完整的 Agent 行为审计链
- Dashboard 可展示"Agent 最后说了什么"

---

#### 2.1.4 `before_compaction` / `after_compaction` — 记忆保全

**当前问题**：
- 依赖 OpenClaw 默认 Compaction 行为
- 虽然 `compaction.memoryFlush.enabled: true` 已配置，但没有自定义逻辑

**增强方案**：
```typescript
api.on('before_compaction', async (payload) => {
  const { sessionKey, tokenCount } = payload;

  // 强制将未保存的关键决策写入 memory
  return {
    prependContext: `
⚠️ Session approaching compaction threshold.
If you have made any important decisions, entity updates, or learned new patterns,
write them to memory/YYYY-MM-DD.md NOW using the write tool.
Format: [HH:MM] Decision/observation
    `.trim()
  };
});
```

**收益**：
- 确保关键信息不因 Compaction 丢失
- 更精细的记忆保全策略

---

### 2.2 中等价值 Hook（可选实现）

| Hook | 场景 | 复杂度 |
|------|------|--------|
| `before_prompt_build` | 动态注入项目上下文（替代在 AGENTS.md 中硬编码路径） | 中 |
| `message_received` | 入站消息预处理（过滤噪音、提取指令） | 低 |
| `message_sending` | 出站消息后处理（格式化、添加签名） | 低 |
| `tool_result_persist` | 工具结果脱敏（隐藏敏感数据） | 中 |
| `gateway_start` / `gateway_stop` | 引擎生命周期钩子（初始化/清理资源） | 中 |

### 2.3 低价值 Hook（不建议实现）

| Hook | 原因 |
|------|------|
| `before_model_resolve` | 模型切换逻辑已在 openclaw.json fallback 配置 |
| `before_agent_start` | 已被 `before_prompt_build` 替代 |

---

## 三、Multi-Agent 机制深度分析

### 3.1 Binding 路由系统

**OpenClaw 能力**：通过 Binding 规则将入站消息路由到不同 Agent。

**当前 AIDA 状态**：单 Agent（main），无 Binding 规则。

**评估结论**：**不建议启用 Multi-Agent Binding**

**原因**：
1. Aida 是"统一助手"定位，用户不需要多个 Agent
2. Skills 已实现"一个 Agent 多种能力"的轻量模式
3. 多 Agent 增加心智负担（用户需要知道该跟谁说话）

**例外场景**（未来可能需要）：
- 业务隔离：不同项目的数据需要完全隔离
- 人格分离：面向外部用户的独立 Agent（如客服机器人）

---

### 3.2 Sub-Agent (`sessions_spawn`) 机制

**OpenClaw 能力**：从运行中的 Agent 衍生后台 Agent 实例，支持嵌套深度和 Orchestrator 模式。

**当前 AIDA 状态**：有意不用，用 Skills 替代。

**评估结论**：**部分启用 Sub-Agent 有价值**

#### 场景 1：并行数据采集

**问题**：当需要同时采集多个门店/竞品数据时，串行执行效率低。

**方案**：使用 `sessions_spawn` 并行启动多个采集 Sub-Agent。

```typescript
// 在 Skill 中指导 Aida 使用 sessions_spawn
// parallel-data-collection Skill
```

```yaml
---
name: parallel-collection
description: Spawn multiple background agents to collect data in parallel
---
## When to Use

Use this skill when you need to collect data from multiple sources **simultaneously**,
and the sources don't depend on each other.

## Pattern

1. Identify the list of targets (e.g., store IDs, competitor URLs)
2. For each target, call `sessions_spawn` with:
   - `task`: "Collect data for {target}"
   - `mode`: "run" (one-shot execution)
   - `label`: "collect-{target-id}"
3. Track the returned `runId`s
4. Results arrive via `subagent.ended` event (already handled by BpsEventBridge)

## Example

```json
{
  "tool": "sessions_spawn",
  "params": {
    "task": "Visit store 001 and record current inventory levels",
    "mode": "run",
    "label": "collect-store-001"
  }
}
```
```

#### 场景 2：长时间后台监控

**问题**：某些监控任务需要持续运行，不能阻塞主会话。

**方案**：使用 `sessions_spawn` + `mode: "session"` 启动持久化 Sub-Agent。

#### 场景 3：不同模型专业化

**问题**：某些任务需要不同模型（如代码生成用 Claude，多语言用 Gemini）。

**方案**：Sub-Agent 可指定 `model` 覆盖。

---

### 3.3 Steer 机制

**OpenClaw 能力**：向运行中的 Sub-Agent 注入新指令，无需终止重启。

**评估结论**：**有价值，但需配合 Sub-Agent 使用**

**场景**：
- 用户在 Sub-Agent 执行中途改变需求
- 管理层临时调整策略

**实现建议**：在 AGENTS.md 中添加 Steer 使用指引。

---

### 3.4 Orchestrator 模式

**OpenClaw 能力**：嵌套 Sub-Agent（深度 1 可继续 spawn 深度 2）。

**评估结论**：**复杂度高，当前不建议启用**

**原因**：
1. 需要配置 `maxSpawnDepth >= 2`
2. 调试困难
3. AIDA 当前的 Skills 模式已足够

---

## 四、增强方案优先级

### P0 — 立即实现（堵漏洞）

| # | 方案 | 收益 | 工作量 |
|---|------|------|--------|
| 1 | `before_tool_call` Hook 注册 | 堵住文件 I/O 治理绕过 | 小（~50 行代码） |

### P1 — 短期实现（提升可靠性）

| # | 方案 | 收益 | 工作量 |
|---|------|------|--------|
| 2 | `session_start` Hook 注册 | 自动项目初始化检测 | 小（~30 行代码） |
| 3 | `agent_end` Hook 注册 | 完整审计链 | 小（~40 行代码） |
| 4 | `before_compaction` Hook 注册 | 记忆保全增强 | 小（~20 行代码） |

### P2 — 中期实现（提升效率）

| # | 方案 | 收益 | 工作量 |
|---|------|------|--------|
| 5 | 并行采集 Skill（含 sessions_spawn） | 数据采集效率提升 | 中（Skill + 指引） |
| 6 | Steer 使用指引（AGENTS.md） | 运行中策略调整 | 小（文档更新） |

### P3 — 长期探索（可选）

| # | 方案 | 收益 | 工作量 |
|---|------|------|--------|
| 7 | Multi-Agent Binding（业务隔离） | 多项目隔离 | 大（架构变更） |
| 8 | Orchestrator 模式 | 复杂任务分解 | 大（调试复杂度高） |

---

## 五、P0 方案详细设计

### 5.1 治理层 Hook 注册

**目标**：将治理检查从 JS 包装层迁移到 OpenClaw Hook 层，覆盖所有工具。

**修改文件**：`src/integration/plugin.ts`

```typescript
import { ActionGate } from '../governance/action-gate.js';
import { GovernanceStore } from '../governance/governance-store.js';

export interface BpsPluginConfig {
  db?: DatabaseSync;
  logger?: OpenClawLogger;
  governanceGate?: ActionGate;
  governanceStore?: GovernanceStore;
}

export function registerBpsPlugin(
  api: OpenClawPluginApi,
  config: BpsPluginConfig = {},
): BpsPluginResult {
  // ... existing code ...

  // 4. Register governance hooks
  if (config.governanceGate) {
    registerGovernanceHooks(api, config.governanceGate, config.governanceStore, logger);
  }

  return { engine, eventBridge };
}

function registerGovernanceHooks(
  api: OpenClawPluginApi,
  gate: ActionGate,
  store: GovernanceStore | undefined,
  logger?: OpenClawLogger,
): void {
  // Hook: before_tool_call — governance check for ALL tools
  api.on('before_tool_call', async (payload) => {
    const { tool, input } = payload as { tool: string; input: Record<string, unknown> };

    // 1. Block direct file I/O to AIDA data directory
    if (['write', 'edit', 'apply_patch'].includes(tool)) {
      const path = input.path as string | undefined;
      if (path && (path.includes('.aida/') || path.includes('bps.db'))) {
        logger?.warn('Blocked direct file I/O to AIDA data', { tool, path });
        throw new Error(
          `GOVERNANCE BLOCKED: Direct file I/O to AIDA data directory is prohibited. ` +
          `Path: ${path}. Use bps_update_entity instead.`
        );
      }
    }

    // 2. Check governance constraints for write operations
    const writeTools = new Set([
      'bps_update_entity', 'bps_create_task', 'bps_update_task',
      'bps_complete_task', 'bps_create_skill'
    ]);

    if (writeTools.has(tool) || tool.startsWith('bps_')) {
      const result = gate.check(tool, input);

      if (result.verdict === 'BLOCK') {
        const violations = result.checks.filter(c => !c.passed);
        const details = violations.map(c => `[${c.severity}] ${c.message}`).join('; ');
        logger?.warn('Governance blocked tool call', { tool, violations });
        throw new Error(
          `GOVERNANCE BLOCKED: ${tool} was blocked by governance policy. ` +
          `Violations: ${details}. The operation was NOT executed.`
        );
      }

      if (result.verdict === 'REQUIRE_APPROVAL') {
        const approvalId = gate.createApprovalRequest(tool, input, result);
        logger?.info('Governance approval required', { tool, approvalId });
        throw new Error(
          `GOVERNANCE APPROVAL REQUIRED: ${tool} requires human approval. ` +
          `Approval ID: ${approvalId}. Check Dashboard to approve/reject.`
        );
      }
    }

    // PASS — allow tool execution
    return { proceed: true };
  });

  // Hook: after_tool_call — audit logging
  api.on('after_tool_call', async (payload) => {
    const { tool, input, result, duration } = payload as {
      tool: string;
      input: Record<string, unknown>;
      result: unknown;
      duration: number;
    };

    logger?.debug('Tool call completed', { tool, duration });
  });
}
```

**同时需要修改**：`src/integration/openclaw-types.ts`

```typescript
export interface OpenClawPluginApi {
  // ... existing ...

  /** 注册生命周期 Hook */
  on(event: string, handler: OpenClawEventHandler): void;

  // ... existing ...
}
```

**同时需要修改**：`src/integration/tools.ts`

```typescript
// 移除 wrapWithGovernance 包装
// 治理检查现在在 Hook 层统一处理
export function createBpsTools(deps: BpsToolDeps): OpenClawAgentTool[] {
  // 不再需要 governance 包装
  return [
    createListServicesTool(deps),
    createCreateTaskTool(deps),
    // ... 其他工具
  ];
}
```

---

## 六、风险评估

### 6.1 Hook 注册风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Hook 抛出异常会阻断 Agent 执行 | 高 | 所有 Hook 处理器必须有 try-catch |
| Hook 返回格式错误 | 中 | 严格遵循 OpenClaw API 契约 |
| 性能影响（每个工具调用都触发 Hook） | 低 | Hook 逻辑保持轻量 |

### 6.2 Sub-Agent 风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Sub-Agent 累积（未正确清理） | 中 | 设置 `cleanup: "delete"` |
| 并发 Sub-Agent 过多 | 中 | 限制并发数（≤5） |
| Sub-Agent 调用主 Agent 工具 | 低 | 工具策略隔离 |

---

## 七、结论

### 核心发现

1. **Hook 机制是治理层的正确归宿**：当前 JS 包装层只能拦截 BPS 工具，无法拦截原生文件 I/O。`before_tool_call` Hook 可以统一拦截所有工具调用。

2. **Multi-Agent 机制对 AIDA 价值有限**：Skills 模式已足够满足"一个 Agent 多种能力"的需求。仅在并行采集、后台监控等特定场景下，Sub-Agent 有价值。

3. **Steer 和 Orchestrator 模式过于复杂**：当前阶段不建议启用。

### 建议行动

1. **立即**：实现 P0 方案（`before_tool_call` Hook），堵住治理绕过漏洞
2. **短期**：实现 P1 方案（`session_start`/`agent_end`/`before_compaction`），提升可靠性
3. **中期**：评估并行采集场景，按需启用 Sub-Agent
4. **长期**：仅在明确的业务隔离需求出现时，考虑 Multi-Agent Binding

### 预期收益

- 治理绕过漏洞 100% 堵住
- 项目初始化体验优化（自动检测 + 引导）
- 完整的 Agent 行为审计链
- 为未来并行任务提供基础设施

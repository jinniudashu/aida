# OpenClaw 框架技术研究报告
**面向 AI 原生商业组织设计的引用参考**

*基于源代码：`openclaw/` | 研究日期：2026-02-23*

---

## 一、项目定位与技术栈

OpenClaw 是一个**个人 AI 助手框架**，运行在用户本地设备上，支持多渠道消息集成（Slack、Discord、WhatsApp、Telegram 等）。其核心设计哲学是：**隐私优先、本地优先、完全可控、高度可扩展**。

| 维度 | 技术选择 |
|------|----------|
| 运行时 | Node.js ≥22（ESM TypeScript） |
| Agent 核心 | `@mariozechner/pi-agent-core` |
| 类型系统 | `@sinclair/typebox`（JSON Schema 运行时验证） |
| 向量存储 | SQLite + `sqlite-vec` 扩展 |
| 通信协议 | WebSocket（Gateway 中央控制平面） |
| 包管理 | pnpm 工作区（Monorepo） |

---

## 二、整体架构

```
┌────────────────────────────────────────────────────────┐
│                    OpenClaw 核心                        │
│                                                        │
│  ┌──────────┐   WebSocket   ┌─────────────────────┐   │
│  │  Channels │ ←──────────→ │  Gateway（控制平面）  │   │
│  │  渠道适配 │               │  RPC + 事件广播      │   │
│  └──────────┘               └──────────┬──────────┘   │
│  (Slack/Discord/              ┌─────────┴──────────┐   │
│   Telegram/等)                │   Agent 运行时      │   │
│                              │  Pi Embedded Runner  │   │
│  ┌──────────┐                └──────────┬──────────┘   │
│  │  Skills  │                   ┌───────┴──────────┐   │
│  │  技能库  │──────→ 工具注册 →  │  Tool 调用生命   │   │
│  └──────────┘                   │  周期管理         │   │
│                                 └──────────────────┘   │
│  ┌──────────────────────────────────────────────────┐  │
│  │             Memory 系统（两层）                    │  │
│  │  短期：JSONL 会话文件   长期：SQLite + 向量嵌入   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 三、Agent 记忆机制（重点）

### 3.1 双层记忆架构

OpenClaw 实现了清晰的两层记忆分层：

```
┌─────────────────────────────────────┐
│           短期记忆（情节记忆）         │
│  ~/.openclaw/sessions/{sessionKey}  │
│  格式：JSONL，每行一个消息事件        │
│  生命周期：会话维度，支持压缩         │
└─────────────────────────────────────┘
              ↕ 自动同步
┌─────────────────────────────────────┐
│           长期记忆（语义记忆）         │
│  ~/.openclaw/agents/{id}/.memory/   │
│  格式：SQLite + 向量索引             │
│  生命周期：Agent 维度，持久化         │
└─────────────────────────────────────┘
```

**关键接口定义**（`src/memory/types.ts`）：

```typescript
export interface MemorySearchManager {
  search(query: string, opts?: {
    maxResults?: number;
    minScore?: number;
    sessionKey?: string;   // 可限定会话范围搜索
  }): Promise<MemorySearchResult[]>;

  readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }>;

  sync?(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void>;
}

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory" | "sessions";  // 标识记忆来源层
  citation?: string;
};
```

### 3.2 向量嵌入系统

支持多个嵌入提供者，实现无厂商锁定：

| 提供者 | 模型 | 维度 | 特点 |
|--------|------|------|------|
| OpenAI | `text-embedding-3-large` | 1536 | 高精度 |
| Google Gemini | `text-embedding-004` | - | 多模态 |
| Voyage AI | `voyage-3` | 1024 | 高效率 |
| 本地 LLaMA | 可配置 | 可配置 | 完全隐私 |

**核心管理器**（`src/memory/manager.ts`）：

```typescript
export class MemoryIndexManager extends MemoryManagerEmbeddingOps
  implements MemorySearchManager {

  protected db: DatabaseSync;                    // SQLite 数据库
  protected provider: EmbeddingProvider | null;  // 嵌入提供者
  protected sources: Set<MemorySource>;          // 记忆来源
  protected watcher: FSWatcher | null;           // 文件变更监听

  protected batch: {
    enabled: boolean;
    concurrency: number;           // 并发处理数
    pollIntervalMs: number;        // 轮询间隔
  };

  protected vector: {
    enabled: boolean;
    dims?: number;                 // 向量维度
  };

  protected fts: {
    enabled: boolean;              // 全文搜索开关
  };
}
```

### 3.3 混合搜索策略（关键设计）

OpenClaw 采用 **BM25 全文搜索 + 向量语义搜索** 的混合排名策略：

```typescript
// src/memory/hybrid.ts
export function mergeHybridResults(params: {
  ftsResults: Map<string, number>;    // BM25 精确匹配评分
  vectorResults: Map<string, number>; // 语义相似度评分
  vectorWeight?: number;              // 默认 0.7（向量权重更高）
}): Map<string, number>;
```

**查询扩展**（`src/memory/query-expansion.ts`）：关键词提取 + 相关查询生成，提升召回率。

**记忆检索工作流**：
```
用户查询 → 向量化 → 混合搜索（向量70% + BM25 30%）
         → 结果排名 → 片段提取 → 注入系统提示
```

### 3.4 上下文窗口管理

**硬性限制**（`src/agents/context-window-guard.ts`）：

```typescript
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;   // 低于此值拒绝运行
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000; // 低于此值发出警告

// 优先级解析链：
// models.providers 配置 > 模型内置 > agents.defaults > 系统默认
```

**会话压缩机制**（`src/agents/pi-settings.ts`）：

```typescript
export const DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR = 20_000;

// 压缩参数：
// reserveTokens：保留给模型响应的最小 token 数
// keepRecentTokens：压缩时保留最近 N 个消息的 token 数
// 触发条件：已用 token + reserveTokens > contextWindow
```

**上下文修剪策略**（`src/agents/pi-extensions/context-pruning.ts`）：

```typescript
export type ContextPruningConfig = {
  strategy: "recent" | "relevance" | "mixed";
  keepSystemPrompt: boolean;     // 系统提示始终保留
  keepToolResults: boolean;      // 工具结果保留策略
};
// 注意：修剪仅影响当前请求上下文，不修改持久化历史
```

---

## 四、Agent-Agent 通信机制（重点）

### 4.1 Subagent 并行执行模型

OpenClaw 实现了**父-子 Agent 树形并行执行**架构：

```
主 Agent (main)
├── Subagent-0 ({agentId}/subagent-0)
├── Subagent-1 ({agentId}/subagent-1)  ← 并行运行
└── Subagent-2 ({agentId}/subagent-2)
    └── Subagent-2-0 (嵌套衍生)
```

**会话键命名规范**（`src/routing/session-key.ts`）：

```typescript
// 主会话：main
// Subagent：{agentId}/subagent-{index}
// 定时任务：cron/{cronId}

export function isSubagentSessionKey(key: string): boolean {
  return key.includes("/subagent-");
}
```

**Subagent 控制工具**（`src/agents/tools/subagents-tool.ts`）：

```typescript
const SubagentsToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),   // 列出当前 Subagent
    Type.Literal("kill"),   // 终止 Subagent
    Type.Literal("steer"),  // 向 Subagent 注入新指令
  ]),
  target: Type.Optional(Type.String()),   // 目标会话键
  message: Type.Optional(Type.String()),  // steer 时的指令内容
  recentMinutes: Type.Optional(Type.Number()),
});
```

### 4.2 会话间消息传递协议

**核心通信接口**（`src/agents/tools/sessions-send-helpers.ts`）：

```typescript
// 列出所有会话
export async function sessions_list(params: {
  agentId?: string
}): Promise<SessionSummary[]>;

// 读取会话历史
export async function sessions_history(params: {
  sessionKey: string;
  from?: number;
  lines?: number;
}): Promise<{ messages: Message[] }>;

// 发送消息到另一会话（核心 IPC 机制）
export async function sessions_send(params: {
  to: string;             // 目标会话键
  message: string;        // 消息内容
  replyBack: boolean;     // true=同步等待回复，false=异步发送
  idempotencyKey: string; // 幂等键，防止重复处理
  announce?: boolean;     // 是否广播生命周期事件
}): Promise<SendResult>;
```

**设计要点**：
- `replyBack: true` 实现**同步 RPC 语义**：父 Agent 阻塞等待子 Agent 结果
- `replyBack: false` 实现**异步消息语义**：发即忘，适合任务分发
- `idempotencyKey` 保证消息幂等性，网络重试安全

### 4.3 Agent 生命周期事件系统

**生命周期状态机**（`src/agents/subagent-lifecycle-events.ts`）：

```typescript
// 终止原因枚举
export const SUBAGENT_ENDED_REASON_COMPLETE = "subagent-complete";
export const SUBAGENT_ENDED_REASON_ERROR    = "subagent-error";
export const SUBAGENT_ENDED_REASON_KILLED   = "subagent-killed";
export const SUBAGENT_ENDED_REASON_SESSION_RESET  = "session-reset";
export const SUBAGENT_ENDED_REASON_SESSION_DELETE = "session-delete";

// 结果类型
export type SubagentLifecycleEndedOutcome =
  | "ok"      // 正常完成
  | "error"   // 执行错误
  | "timeout" // 执行超时
  | "killed"  // 被父 Agent 主动终止
  | "reset"   // 会话被重置
  | "deleted";// 会话被删除
```

**Subagent 生成完整流程**：
```
父 Agent 调用 sessions_spawn
    ↓
创建新会话（键：{agentId}/subagent-{index}）
    ↓
[可选] 复制工作空间 / 应用模型覆盖
    ↓
消息排队到新会话 → 并行执行
    ↓
生命周期事件广播：started → running → ended{outcome}
    ↓
父 Agent 接收结果（同步或通过事件监听）
```

### 4.4 Gateway WebSocket 通信协议

所有 Agent 间通信通过 **Gateway 控制平面**路由，协议为 JSON over WebSocket：

**帧格式**（`src/gateway/protocol/schema/frames.ts`）：

```typescript
// 请求帧（方法调用）
type RequestFrame = {
  type: "req";
  id: string;          // 请求 ID
  method: string;      // 方法名（如 "agent.call"）
  params?: unknown;
};

// 响应帧（方法结果）
type ResponseFrame = {
  type: "res";
  id: string;          // 匹配请求 ID
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
};

// 事件帧（单向广播）
type EventFrame = {
  type: "event";
  event: string;       // 事件名（如 "agent.running"）
  payload?: unknown;
  seq?: number;        // 序列号，保证顺序
  stateVersion?: StateVersion;
};
```

**连接握手协议**：

```typescript
// 服务端 Hello 响应（含全量系统快照）
type HelloOk = {
  type: "hello-ok";
  protocol: number;       // 协议版本
  server: {
    version: string;
    connId: string;
  };
  features: {
    methods: string[];    // 服务端支持的方法列表
    events: string[];     // 服务端发布的事件列表
  };
  snapshot: Snapshot;    // 完整系统状态（Agent、会话等）
};
```

### 4.5 Agent 调用参数（完整规范）

**`AgentParamsSchema`**（`src/gateway/protocol/schema/agent.ts`）：

```typescript
{
  message: string;              // 消息内容（必填）
  agentId?: string;             // 目标 Agent ID
  to?: string;                  // 目标会话键
  sessionKey?: string;          // 明确指定会话
  thinking?: string;            // 思考深度：off/low/medium/high/xhigh
  deliver?: boolean;            // 是否投递到输出渠道
  attachments?: unknown[];      // 附件列表（图像等）
  channel?: string;             // 来源渠道标识
  timeout?: number;             // 超时时间（ms）
  lane?: string;                // 执行通道（并行优先级）
  extraSystemPrompt?: string;   // 动态注入系统提示
  inputProvenance?: {           // 消息溯源信息
    kind: string;
    sourceSessionKey?: string;
    sourceChannel?: string;
    sourceTool?: string;        // 如果来自工具调用
  };
}
```

---

## 五、工具调用机制

### 5.1 工具定义规范

```typescript
// src/agents/tools/common.ts
export type AnyAgentTool = AgentTool<any, unknown> & {
  ownerOnly?: boolean;  // 权限控制：仅所有者可调用
};

// 工具错误体系
export class ToolInputError extends Error {
  readonly status = 400;
}
export class ToolAuthorizationError extends ToolInputError {
  override readonly status = 403;
}
```

### 5.2 内置工具集（对组织设计直接有价值）

| 工具名 | 功能 | 组织应用场景 |
|--------|------|------------|
| `bash_exec` | 执行系统命令 | 自动化运维、脚本执行 |
| `sessions_send` | Agent 间消息传递 | 跨部门 Agent 协作 |
| `sessions_spawn` | 衍生子 Agent | 任务分解与并行化 |
| `sessions_list` | 列出活跃会话 | 组织状态监控 |
| `memory_search` | 搜索长期记忆 | 知识检索 |
| `cron` | 定时任务管理 | 定期报告、监控任务 |
| `browser` | 浏览器自动化 | Web 信息采集 |
| `canvas` | 可视化工作区 | 协作文档处理 |

### 5.3 动作门控（Action Gating）

**细粒度权限控制机制**：

```typescript
export type ActionGate<T extends Record<string, boolean | undefined>> = (
  key: keyof T,
  defaultValue?: boolean,
) => boolean;

// 使用：在工具执行前检查特定动作是否允许
const gate = createActionGate(toolConfig.actions);
if (!gate("file_write", false)) {
  throw new ToolAuthorizationError("写入权限未开放");
}
```

---

## 六、技能（Skills）与扩展（Extensions）系统

### 6.1 技能系统

**技能是 Agent 能力的打包单元**，类似于可安装的"职能模块"：

```typescript
export type OpenClawSkillMetadata = {
  id: string;
  name: string;
  description: string;
  commands?: SkillCommandSpec[];  // 暴露的命令接口
  tools?: SkillToolSpec[];        // 暴露的工具
  env?: Record<string, string>;  // 环境配置
  permissions?: string[];        // 所需权限声明
  hooks?: SkillHooks;            // 生命周期钩子
};

// 技能来源分类
type SkillSource = "bundled" | "managed" | "workspace";
```

**为 Agent 生成技能文档**：

```typescript
// 系统自动将已启用技能的文档注入 Agent 系统提示
export function buildWorkspaceSkillsPrompt(entries: SkillEntry[]): string;
```

### 6.2 扩展系统架构

```
extensions/
├── discord/        # Discord 渠道
├── matrix/         # Matrix 协议
├── msteams/        # Microsoft Teams
├── mattermost/     # Mattermost
├── irc/            # IRC 协议
├── memory-core/    # 记忆后端核心
├── memory-lancedb/ # LanceDB 向量后端
├── llm-task/       # LLM 任务扩展
└── lobster/        # UI 扩展
```

**插件注册接口**（`src/extensionAPI.ts`）：

```typescript
export interface OpenClawPluginApi {
  runtime: { config, logger, homeDir };
  registerChannel(options: { plugin: ChannelPlugin }): void;
  registerTool(tool: AgentTool): void;
  registerSkill(skill: OpenClawSkillMetadata): void;
  registerHook(hook: HookDefinition): void;
  onEvent(event: string, handler: EventHandler): void;
}
```

---

## 七、安全机制

| 机制 | 实现 | 说明 |
|------|------|------|
| 所有者权限 | `ownerOnly: true` | 工具级别的调用者身份验证 |
| DM 策略 | `dmPolicy` 配置 | `pairing`（配对码）/ `open` / `disabled` |
| 执行审批 | `ExecApprovalManager` | 高危命令需人工审批 |
| 动作门控 | `ActionGate` | 工具内部细粒度权限控制 |
| 幂等性 | `idempotencyKey` | 消息传递去重保证 |

---

## 八、对 AI 原生商业组织设计的启示

### 8.1 组织架构映射

OpenClaw 的技术架构可直接对应商业组织结构：

| OpenClaw 概念 | 商业组织对应 | 实现机制 |
|--------------|------------|---------|
| Agent | 职能角色/员工 | Pi Agent 运行时 |
| Subagent | 任务执行团队 | `sessions_spawn` |
| Skill | 岗位能力模块 | Skills 系统 |
| Session | 项目/任务上下文 | JSONL 会话文件 |
| Memory | 组织知识库 | 向量化长期记忆 |
| Channel | 沟通渠道 | 渠道插件 |
| Gateway | 组织总线/路由 | WebSocket 控制平面 |
| `extraSystemPrompt` | 动态角色赋权 | 运行时注入 |

### 8.2 记忆机制在组织中的应用

**双层记忆对应组织知识管理**：

```
短期记忆（会话/项目文件）
  → 项目上下文、会议记录、当前任务状态
  → 有限生命周期，项目结束后可归档

长期记忆（向量化知识库）
  → 组织知识、历史决策、最佳实践
  → 跨项目检索，持续积累
  → 混合搜索确保相关知识被准确调用
```

**关键洞察**：`source: "memory" | "sessions"` 的区分意味着系统能明确追踪知识的**权威来源**，这对组织合规性审计极为重要。

### 8.3 Agent-Agent 通信在组织中的应用

**同步 vs 异步通信模式**：

```
同步（replyBack: true）：
  需要结果才能继续的决策链
  例：CFO Agent 等待财务 Agent 核算结果

异步（replyBack: false）：
  并行推进的独立任务
  例：CEO Agent 同时委派市场、技术、财务多个子任务
```

**`steer` 机制**：父 Agent 可以向运行中的子 Agent 注入新指令，类似于组织中的**实时策略调整**，无需终止并重新启动任务。

**`inputProvenance`**（消息溯源）：每条 Agent 间消息携带来源信息（`sourceSessionKey`、`sourceTool` 等），提供完整的**决策追溯链**，满足组织合规需求。

### 8.4 关键设计原则（可直接引用）

1. **上下文窗口是有限资源**：硬性最小值 16K tokens 表明组织必须设计**上下文管理策略**，不能无限累积信息。

2. **压缩而非丢弃**：会话压缩保留最近消息 + 压缩历史，类比组织的**定期复盘和归档**机制。

3. **混合检索优于单一策略**：BM25（精确匹配）+ 向量（语义相似）的混合，表明**结构化知识与非结构化知识需要不同检索策略**共存。

4. **幂等性保证**：`idempotencyKey` 机制确保即使在系统故障重试时，任务不会被重复执行，这是**组织流程可靠性**的基础。

5. **生命周期事件可观测性**：Subagent 的每个状态变迁都有明确事件，这是**组织运营可观测性**的技术基础。

---

## 九、性能参数参考

| 参数 | 值 |
|------|-----|
| 上下文窗口范围 | 32K–200K tokens（取决于模型） |
| 上下文硬性最低 | 16,000 tokens |
| 默认压缩保留 | 20,000 tokens |
| 向量维度（OpenAI） | 1,536 维 |
| 向量维度（Voyage） | 1,024 维 |
| 混合搜索权重分配 | 向量 70% + BM25 30% |
| 批处理并发数 | 3（可配置） |

---

## 十、结论

OpenClaw 提供了一套**成熟的工程级 Agent 框架**，其核心贡献是：

1. **记忆系统**：清晰的双层架构（短期会话 + 长期向量化），混合检索策略，支持多嵌入提供者。框架明确区分记忆"来源"（`memory` vs `sessions`），是组织知识管理的良好参考范式。

2. **通信系统**：基于会话键的消息路由，支持同步/异步两种模式，幂等性保证，完整的生命周期事件体系。`steer` 机制（向运行中 Agent 注入指令）是组织中**动态任务管理**的关键能力。

3. **可扩展性**：插件 SDK 覆盖渠道、工具、技能三个维度，符合商业组织**模块化能力积累**的需求。

**核心参考价值**：该框架证明了以 **WebSocket + RPC + 事件流** 为核心的 Agent 通信模型，以及 **SQLite + 向量索引** 的本地知识库方案，在工程实践中是可行且高效的。AI 原生组织可以直接基于类似架构进行设计，无需从零发明通信协议和记忆模型。

---

*本报告基于 `openclaw/` 源代码直接分析，所有接口定义均来自实际代码，可作为工程实现的直接参考。*

# OpenClaw 框架技术研究报告 v2

**面向 AIDA 平台的系统级技术参考**

*基于官方文档 https://docs.openclaw.ai/ 系统学习 | 更新日期：2026-03-06*
*v1 基于源码分析（2026-02-23），v2 基于官方文档全面重写*

---

## 一、项目定位与架构总览

OpenClaw 是一个**本地优先的 AI Agent 基础设施框架**，以 Gateway 守护进程为核心，支持 30+ 消息渠道集成（WhatsApp/Telegram/Discord/Slack/Signal/iMessage/Teams/Matrix/IRC 等）、多 Agent 隔离路由、本地优先记忆系统、Docker 沙箱执行、以及完整的插件生态。

### 1.1 Hub-and-Spoke 架构

```
                        ┌─────────────────────────┐
                        │   Gateway 守护进程        │
                        │   (唯一中央控制平面)       │
                        │                         │
                        │  WebSocket API           │
                        │  typed JSON frames       │
                        │  req/res + event push    │
                        └────┬────────────┬────────┘
                             │            │
              ┌──────────────┤            ├──────────────┐
              │              │            │              │
        ┌─────┴──────┐ ┌────┴─────┐ ┌────┴─────┐ ┌─────┴──────┐
        │ 渠道适配层  │ │ 控制客户端│ │ Node 设备 │ │  插件系统  │
        │ WhatsApp   │ │ CLI/Web  │ │ iOS/macOS │ │ Channels  │
        │ Telegram   │ │ macOS    │ │ Android   │ │ Tools     │
        │ Discord    │ │ TUI      │ │ Headless  │ │ Skills    │
        │ Slack ...  │ │ WebChat  │ │           │ │ Hooks     │
        └────────────┘ └──────────┘ └──────────┘ └───────────┘
```

**核心原则**：
- 单一长驻 Gateway 拥有所有消息通道——一个进程管理所有渠道连接
- 所有客户端（CLI/Web/macOS/移动设备）通过 WebSocket 连接 Gateway
- Gateway 默认绑定 `127.0.0.1:18789`（loopback），可通过 Tailscale/SSH 隧道远程访问
- 支持 launchd（macOS）和 systemd（Linux）自动守护

### 1.2 技术栈

| 维度 | 技术选择 |
|------|----------|
| 运行时 | Node.js 22+（ESM TypeScript） |
| Agent 核心 | pi-agent-core（嵌入式 Agent 运行时） |
| 类型系统 | TypeBox（JSON Schema 运行时校验 + 协议代码生成） |
| 向量存储 | SQLite + sqlite-vec 扩展（可选 QMD/LanceDB 后端） |
| 通信协议 | WebSocket（typed JSON frames） |
| 配置格式 | JSON5（`~/.openclaw/openclaw.json`，支持注释和尾逗号） |
| 包管理 | pnpm 工作区（Monorepo） |
| 沙箱 | Docker（可选，per-session/per-agent/shared 隔离） |

---

## 二、Agent 与 Workspace

### 2.1 Agent 定义 — "One Fully Scoped Brain"

Agent 是 OpenClaw 的核心运行单元，具有三维隔离：

| 隔离维度 | 路径 | 说明 |
|---------|------|------|
| **Workspace**（文件系统） | `~/.openclaw/workspace` 或 `workspace-<agentId>` | Agent 工作目录，包含人格文件、Skills、Memory |
| **State Directory**（配置与凭据） | `~/.openclaw/agents/<agentId>/agent/` | auth-profiles.json、模型注册表、per-agent 配置 |
| **Session Store**（会话历史） | `~/.openclaw/agents/<agentId>/sessions/` | JSONL 转录、会话映射、token 计数 |

**关键特性**：凭据 per-agent 隔离——每个 Agent 读取自己的 `auth-profiles.json`，凭据不会自动共享。

### 2.2 Workspace 文件体系（Bootstrap Files）

7 个 Workspace 文件在**每次 Agent Turn 的上下文窗口中自动注入**：

| 文件 | 职责 | 注入行为 |
|------|------|---------|
| `AGENTS.md` | 操作指令——Session 启动行为、Memory 使用、协作规则 | 始终注入（子 Agent 也注入） |
| `SOUL.md` | 人格——价值观、边界、语调 | 主 Agent 注入（子 Agent 不注入） |
| `USER.md` | 用户画像——称呼、偏好、时区 | 主 Agent 注入 |
| `IDENTITY.md` | 外部身份——名字、emoji、头像 | 主 Agent 注入 |
| `TOOLS.md` | 工具使用备注（仅指导性） | 始终注入 |
| `HEARTBEAT.md` | 心跳检查清单 | 主 Agent 注入 |
| `MEMORY.md` | 长期策展记忆（仅主会话加载，群聊不加载） | 主会话注入 |

**此外**：
- `BOOT.md`：可选，Gateway 重启时执行的启动检查清单（需 `hooks.internal.enabled`）
- `BOOTSTRAP.md`：新 Workspace 专用，首次引导完成后可删除
- `memory/YYYY-MM-DD.md`：**不自动注入**，仅通过 `memory_search`/`memory_get` 工具按需消费

**尺寸控制**：
- 单文件上限：`bootstrapMaxChars`（默认 20,000 字符）
- 总注入上限：`bootstrapTotalMaxChars`（默认 150,000 字符）
- 截断警告策略：`bootstrapPromptTruncationWarning`（`off`/`once`/`always`）

**子 Agent 上下文精简**：子 Agent Session 仅注入 `AGENTS.md` + `TOOLS.md`，排除 SOUL/IDENTITY/USER/HEARTBEAT/MEMORY 以降低 token 消耗。

### 2.3 System Prompt 组装顺序

OpenClaw 为每次 Agent Run 构建自定义 System Prompt，固定段落顺序：

```
1. Tooling（工具声明）
2. Safety（安全指引——仅 advisory，硬执法靠 tool policy/sandbox）
3. Skills（<available_skills> XML 列表——名称+描述+路径，不预加载内容）
4. Self-Update（自更新指引）
5. Workspace（工作目录说明）
6. Documentation（本地/公共文档入口）
7. Workspace Files（7 个 Bootstrap 文件注入）
8. Sandbox info（沙箱状态）
9. Date/Time（时区，无动态时钟——保证 prompt cache 稳定性）
10. Reply Tags（回复标签）
11. Heartbeats（心跳说明）
12. Runtime（运行时参数）
13. Reasoning（思考深度设置）
```

**Prompt 模式**：
- `full`（默认）：所有段落
- `minimal`：精简版——保留 Tooling/Safety/Workspace/Sandbox/DateTime/Runtime/Context
- `none`：仅基础身份

### 2.4 默认模板要点

**AGENTS.md 默认模板**核心规则：
- Session 启动时主动读取 SOUL.md + USER.md + 日记忆 + MEMORY.md（"Don't ask permission. Just do it."）
- MEMORY.md 仅在主会话加载（防止群聊泄露敏感上下文）
- Red Lines：禁止数据外泄、禁止未经同意的破坏性命令
- 群聊协议：选择性参与，不回复每条消息（"If you wouldn't send it in a real group chat with friends, don't send it."）
- 允许主动行为：整理文件、检查 git 状态、更新文档、周期性综合日记忆至 MEMORY.md

**SOUL.md 默认模板**核心原则：
- "Be genuinely helpful, not performatively helpful."
- 发展自己的性格和观点，而非默认公司礼貌
- 隐私绝对保护、外部行动需许可
- "This file is yours to evolve. As you learn who you are, update it."

---

## 三、Session 管理

### 3.1 Session 架构

每个 Agent 维护**一个主直聊会话**（`agent:<agentId>:<mainKey>`），群聊和频道独立 Session Key。

**DM Scope 控制**（`session.dmScope`）：

| 模式 | Session Key 格式 | 适用场景 |
|------|-----------------|---------|
| `main`（默认） | `agent:<id>:<mainKey>` | 单用户——跨设备、跨渠道连续性 |
| `per-peer` | `agent:<id>:dm:<peerId>` | 按发送者隔离 |
| `per-channel-peer` | `agent:<id>:<channel>:dm:<peerId>` | 多用户收件箱（推荐） |
| `per-account-channel-peer` | `agent:<id>:<channel>:<accountId>:dm:<peerId>` | 多账号收件箱 |

**安全提醒**：若多人可与 Agent 私聊，必须设置 `per-channel-peer` 以防上下文泄露。

### 3.2 Session 生命周期

- **日重置**（默认）：每天凌晨 4:00 本地时间，上一次更新早于重置时间的会话过期
- **空闲重置**（可选）：`idleMinutes` 滑动窗口
- **类型覆盖**：`resetByType` 可为 `direct`/`group`/`thread` 设置不同策略
- **渠道覆盖**：`resetByChannel` 可为特定渠道设置策略
- **手动重置**：`/new` 或 `/reset` 命令立即开启新 Session

### 3.3 Compaction（上下文压缩）

当 Session 接近模型上下文窗口时自动触发：

- **工作方式**：保留最近消息，将旧消息压缩为摘要条目，持久化到 JSONL 文件
- **模式**：`default` 或 `safeguard`（分块摘要，保留标识符）
- **标识符策略**：`strict`（默认，保留 ID/URL 等不透明标识符）、`off`、`custom`
- **手动触发**：`/compact [可选指导]`
- **与 Pruning 的区别**：Compaction 修改 JSONL 文件（持久化），Pruning 仅修剪 in-memory 上下文（每次请求临时）

### 3.4 Pre-Compaction Memory Flush

Compaction 前 OpenClaw 执行一次**静默记忆冲刷 Turn**：

```jsonc
{
  "compaction": {
    "memoryFlush": {
      "enabled": true,
      "softThresholdTokens": 6000,
      "systemPrompt": "Session nearing compaction. Store durable memories now.",
      "prompt": "Write any lasting notes to memory/YYYY-MM-DD.md; reply NO_REPLY if nothing to store."
    }
  }
}
```

- 触发条件：`contextWindow - reserveTokensFloor - softThresholdTokens`
- 静默执行（NO_REPLY 不产生用户可见输出）
- 每次 Compaction 周期仅冲刷一次
- 只读 Workspace 跳过

### 3.5 Session Pruning（上下文修剪）

在 LLM 调用前修剪旧 Tool Results：

```jsonc
{
  "contextPruning": {
    "mode": "cache-ttl",
    "ttl": "1h",
    "softTrim": { "maxChars": 4000, "headChars": 1500, "tailChars": 1500 },
    "hardClear": { "enabled": true, "placeholder": "[Old tool result content cleared]" }
  }
}
```

- 不修改 JSONL 历史——仅影响当前请求上下文
- 先 softTrim（截取头尾），再 hardClear（完全替换为占位符）

---

## 四、Memory 系统

### 4.1 双层记忆架构

```
~/.openclaw/workspace/
├── MEMORY.md                 ← 长期策展记忆（仅主会话注入）
└── memory/
    ├── YYYY-MM-DD.md         ← 日追加日志（自动加载 today + yesterday）
    └── projects.md           ← 非日期文件（永不衰减）
```

**关键设计**：Memory 是**纯 Markdown 文件**——文件是权威来源，而非模型 RAM。

### 4.2 Memory 工具

| 工具 | 功能 |
|------|------|
| `memory_search` | 语义搜索——~400 token 分块、80 token 重叠、返回片段+路径+行号+分数 |
| `memory_get` | 定向读取——指定文件 + 可选行范围；文件不存在时返回 `{text:"", path}` |

### 4.3 向量嵌入与混合搜索

**嵌入提供者自动选择顺序**：local → OpenAI → Gemini → Voyage → Mistral

**混合搜索策略**（BM25 + Vector）：

```
查询 → 候选池（vector top-K × multiplier + BM25 top-K × multiplier）
     → BM25 归一化：textScore = 1 / (1 + max(0, bm25Rank))
     → 加权合并：finalScore = vectorWeight × vectorScore + textWeight × textScore
     → 时间衰减（可选）→ 排序 → MMR 去重（可选）→ Top-K
```

**时间衰减**（Temporal Decay）——可选，默认关闭：
- 公式：`decayedScore = score × e^(-λ × ageInDays)`
- 默认半衰期 30 天：today=100%、7d=84%、30d=50%、90d=12.5%
- **永不衰减文件**：`MEMORY.md`、`memory/` 下的非日期文件

**MMR 重排序**（Maximal Marginal Relevance）——可选，默认关闭：
- 目标：平衡相关性与多样性，避免冗余片段
- Lambda：1.0=纯相关性，0.0=最大多样性，默认 0.7

### 4.4 QMD 后端（实验性替代方案）

QMD 提供 local-first 搜索，组合 BM25 + Vector + Reranking：
- 自包含 XDG home：`~/.openclaw/agents/<agentId>/qmd/`
- 支持 Session Transcript 索引（`memory.qmd.sessions.enabled = true`）
- 如果 QMD 失败，自动回退到内置 SQLite 后端

### 4.5 存储与索引

- per-agent SQLite：`~/.openclaw/memory/<agentId>.sqlite`
- 文件变更监听（`MEMORY.md` + `memory/` 目录，1.5s 防抖）→ 标记索引 dirty
- 同步触发：Session Start / memory_search 调用 / 定时间隔
- 嵌入提供者/模型/分块参数变更时自动重建索引

---

## 五、Multi-Agent 架构

### 5.1 路由绑定系统

多 Agent 通过 **Binding 规则** 将入站消息路由到不同 Agent：

```jsonc
{
  "agents": {
    "list": [
      { "id": "home", "default": true, "workspace": "~/.openclaw/workspace-home" },
      { "id": "work", "workspace": "~/.openclaw/workspace-work" }
    ]
  },
  "bindings": [
    { "agentId": "home", "match": { "channel": "whatsapp", "accountId": "personal" } },
    { "agentId": "work", "match": { "channel": "whatsapp", "accountId": "biz" } },
    { "agentId": "work", "match": { "channel": "whatsapp", "accountId": "personal", "peer": "+15551234567" } }
  ]
}
```

**匹配优先级**（first match wins）：
1. 精确 peer 匹配
2. 父 peer 继承（线程上下文）
3. Guild ID + Role（Discord）
4. Guild ID（Discord）
5. Team ID（Slack）
6. Account ID（精确）
7. Channel 通配
8. 默认 Agent

**多字段 AND 语义**：一个 binding 指定 `peer` + `guildId` = 两个条件必须同时满足。

### 5.2 Agent 间通信

Agent 间通信**默认关闭**，必须显式启用：

```jsonc
{
  "tools": {
    "agentToAgent": { "enabled": true, "allow": ["home", "work"] }
  }
}
```

### 5.3 Sub-Agent 系统（详细）

Sub-Agent 是从运行中的 Agent Turn 衍生的后台 Agent 实例。

**核心特性**：
- Session 隔离：`agent:<agentId>:subagent:<uuid>`
- 异步执行：`sessions_spawn` 立即返回 `{runId, childSessionKey}`
- 完成后自动播报：向父 Agent 发送结果摘要（含状态、运行时长、token 用量、估算成本）

**`sessions_spawn` 参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `task` | 是 | 任务描述 |
| `label` | 否 | 自定义标签 |
| `agentId` | 否 | 目标 Agent（受 allowlist 限制） |
| `model` | 否 | 模型覆盖 |
| `thinking` | 否 | 思考深度覆盖 |
| `mode` | 否 | `run`（一次性）/ `session`（持久化，需 `thread:true`） |
| `runTimeoutSeconds` | 否 | 超时（默认 900s，`0`=无限制） |
| `cleanup` | 否 | `delete`（立即清理）/ `keep`（延迟清理） |
| `sandbox` | 否 | `inherit` / `require` |

**嵌套 Sub-Agent（Orchestrator 模式）**：

| 深度 | Session Key | 角色 | 可衍生 |
|------|------------|------|--------|
| 0 | `agent:<id>:main` | 主 Agent | 始终 |
| 1 | `agent:<id>:subagent:<uuid>` | 编排器/叶子 | 仅当 `maxSpawnDepth >= 2` |
| 2 | `...:subagent:<uuid>:subagent:<uuid>` | 工作者 | 否 |

**默认工具策略**：Sub-Agent 获得所有工具**除了** `sessions_list`/`sessions_history`/`sessions_send`/`sessions_spawn`（除非是 Orchestrator 深度 1 且 `maxSpawnDepth >= 2`）。

**`/subagents` 管理命令**：`list`/`kill`/`log`/`info`/`send`/`steer`/`spawn`

**Steer 机制**：向运行中的 Sub-Agent 注入新指令，无需终止重启——类似组织中的**实时策略调整**。

---

## 六、Agent 执行循环（Agent Loop）

### 6.1 完整执行流程

```
Phase 1: 请求接收
  → agent RPC 校验参数、解析 Session、持久化元数据
  → 立即返回 { runId, acceptedAt }

Phase 2: 命令编排
  → 解析模型 + thinking/verbose 默认值
  → 加载 Skills 快照
  → 调用 runEmbeddedPiAgent

Phase 3: 嵌入式 Pi Agent 执行
  → per-session + 全局队列串行化（防止竞态）
  → 解析模型 + auth profile → 构建 Pi Session
  → 订阅 Pi 事件 → 流式推送 assistant/tool deltas
  → 执行超时约束 + abort 能力

Phase 4: 事件桥接
  → Pi 事件 → OpenClaw stream 事件
  → tool events → stream:"tool"
  → assistant deltas → stream:"assistant"
  → lifecycle events → stream:"lifecycle" { phase: start|end|error }

Phase 5: 完成
  → agent.wait 阻塞至 lifecycle end/error
  → 返回 { status, startedAt, endedAt, error? }
```

### 6.2 Hook 与扩展点

**Plugin Hooks（Agent/Gateway 生命周期）**：

| Hook | 时机 | 能力 |
|------|------|------|
| `before_model_resolve` | Session 加载前 | 覆盖 model/provider |
| `before_prompt_build` | Session 加载后 | 注入上下文、覆盖 system prompt |
| `before_agent_start` | 兼容遗留 | 建议用上两个替代 |
| `agent_end` | 完成后 | 检查最终消息列表 |
| `before_compaction` / `after_compaction` | Compaction 周期 | 观察/注解 |
| `before_tool_call` / `after_tool_call` | 工具执行前后 | 拦截参数/结果 |
| `tool_result_persist` | 转录写入前 | 同步变换 tool result |
| `message_received` / `message_sending` / `message_sent` | 入站/出站 | 消息处理 |
| `session_start` / `session_end` | Session 边界 | 生命周期 |
| `gateway_start` / `gateway_stop` | Gateway 生命周期 | 系统级 |

**Prompt 组装中的 Hook 介入**：

```
1. 应用 prependContext 到用户 prompt
2. 如提供 systemPrompt 覆盖则使用
3. 组装 prependSystemContext + 当前 system prompt + appendSystemContext
```

**关键安全策略**：Operator 可通过 `plugins.entries.<id>.hooks.allowPromptInjection: false` 禁用特定插件的 prompt mutation hooks。

### 6.3 队列与并发

- 每个 Session Key 一个执行队列（session lane）——防止 tool/session 竞态
- 可选全局队列（global lane）——保证历史一致性
- 消息渠道选择队列模式：`collect`/`steer`/`followup`/`queue`/`interrupt`

### 6.4 NO_REPLY 与静默回复

`NO_REPLY` token 被过滤，不产生用户可见输出——用于心跳、记忆冲刷等静默操作。

---

## 七、工具系统

### 7.1 工具 Profiles

| Profile | 包含工具组 |
|---------|-----------|
| `minimal` | 仅 `session_status` |
| `coding` | fs + runtime + sessions + memory + image |
| `messaging` | messaging + session/memory |
| `full` | 无限制 |

### 7.2 工具组

| 组名 | 工具 |
|------|------|
| `group:runtime` | exec, process |
| `group:fs` | read, write, edit, apply_patch |
| `group:sessions` | Session 管理工具 |
| `group:memory` | memory_search, memory_get |
| `group:web` | web_search, web_fetch |
| `group:ui` | browser, canvas |
| `group:automation` | cron, gateway |
| `group:messaging` | message |
| `group:nodes` | nodes |

### 7.3 Allow/Deny 策略

```jsonc
{
  "tools": {
    "allow": ["group:fs", "sessions_list"],   // 白名单
    "deny": ["browser", "canvas"],            // 黑名单（deny wins）
    "byProvider": {                           // 按模型/提供者覆盖
      "google-antigravity": { "profile": "minimal" }
    }
  }
}
```

### 7.4 Elevated 模式

`tools.elevated` 允许在宿主机直接执行（绕过沙箱）：
- per-agent 只能进一步限制（不能放宽）
- Session 命令：`/elevated on|off|ask|full`
- `allowFrom` 按渠道+用户 ID 控制

### 7.5 Loop Detection

可选工具循环检测器：
- `genericRepeat`：通用重复检测
- `knownPollNoProgress`：已知轮询无进展模式
- `pingPong`：乒乓模式
- 阈值：warning(10) → critical(20) → globalCircuitBreaker(30)

---

## 八、Skills 系统

### 8.1 SKILL.md 格式

```yaml
---
name: skill-identifier
description: What the skill does
user-invocable: true          # 是否暴露为 slash 命令
disable-model-invocation: false  # 是否从 model prompt 排除
command-dispatch: tool        # 直接工具分发（绕过模型）
command-tool: tool_name
command-arg-mode: raw
---
## Instructions
使用 `{baseDir}` 引用 Skill 文件夹路径。
```

### 8.2 加载优先级

```
workspace/skills/ (最高) → ~/.openclaw/skills → 内置 skills (最低)
```

同名冲突时高优先级覆盖低优先级。Plugin 可通过 `openclaw.plugin.json` 发布 Skills。

### 8.3 加载时过滤

`metadata.openclaw` 字段控制 Skill 是否加载：
- `requires.bins`：PATH 中必须存在的二进制
- `requires.env`：必须存在的环境变量
- `requires.config`：必须为 truthy 的配置路径
- `os`：平台过滤（`darwin`/`linux`/`win32`）
- `always: true`：跳过所有过滤

### 8.4 ClawHub 注册中心

公共 Skills 注册中心：https://clawhub.com
- `clawhub install <skill-slug>`
- `clawhub update --all`

### 8.5 Token 成本

Skills 以 XML 列表注入 System Prompt：
- 基础开销（≥1 skill）：195 字符
- 每个 Skill：~97 字符 + 字段长度 ≈ ~24 tokens

---

## 九、自动化系统

### 9.1 Heartbeat（心跳）

周期性 Agent Turn（默认 30 分钟），用于巡检和主动报告：

```jsonc
{
  "heartbeat": {
    "every": "30m",
    "target": "last",            // "none" / "last" / 具体渠道
    "prompt": "Read HEARTBEAT.md...",
    "lightContext": false,        // true=仅加载 HEARTBEAT.md
    "model": "openai/gpt-5.2-mini",
    "directPolicy": "allow",     // "allow" / "block"
    "ackMaxChars": 300,
    "activeHours": { "start": "09:00", "end": "22:00", "timezone": "America/New_York" }
  }
}
```

**响应约定**：
- 无事可做 → 回复 `HEARTBEAT_OK`（被过滤，不发送）
- 有告警 → 正常输出（不含 HEARTBEAT_OK）

**HEARTBEAT.md**：空文件或仅注释 → 跳过心跳（节省 API 调用）。

### 9.2 Cron（定时任务）

Gateway 内置调度器，持久化到 `~/.openclaw/cron/`，重启后恢复：

**两种执行模式**：
- **主会话模式**：在下次心跳中执行系统事件
- **隔离模式**：独立 `cron:<jobId>` Session，每次运行全新 sessionId

**三种调度方式**：
- `at`：一次性（ISO 8601）
- `every`：固定间隔（ms）
- `cron`：5/6 字段 cron 表达式 + 可选时区

**投递选项**：
- `announce`：通过渠道适配器直投（Slack/Discord/WhatsApp/Telegram 等）
- `webhook`：POST 到配置 URL
- `none`：仅内部执行

### 9.3 Hooks（Webhook 入站）

外部系统通过 HTTP POST 触发 Agent 行为：

```jsonc
{
  "hooks": {
    "enabled": true,
    "token": "shared-secret",
    "path": "/hooks",
    "mappings": [{
      "match": { "path": "gmail" },
      "action": "agent",
      "agentId": "hooks",
      "sessionKey": "hook:gmail:{{messages[0].id}}",
      "messageTemplate": "From: {{messages[0].from}}\nSubject: {{messages[0].subject}}"
    }]
  }
}
```

**端点**：`POST /hooks/wake`、`POST /hooks/agent`、`POST /hooks/<name>`

### 9.4 三频对照（与 AIDA 三频模型对应）

| OpenClaw | AIDA Freq | 说明 |
|----------|-----------|------|
| 事件驱动（消息入站/Hook） | Freq 1 Event-driven | 实时响应 |
| Heartbeat（周期心跳） | Freq 2 Heartbeat | 主动巡检 |
| Cron（定时任务） | Freq 3 Cron | 计划执行 |

---

## 十、安全机制

### 10.1 信任模型

OpenClaw 采用**个人助手安全模型**——单一可信操作者边界 per Gateway：
> "one trusted operator boundary per gateway (single-user/personal assistant model)"

如需对抗性用户隔离 → 使用不同 Gateway / OS 用户 / 主机。

**核心安全链**："who can talk to your bot" → "where the bot is allowed to act" → "what the bot can touch."

### 10.2 DM 访问控制

| 策略 | 行为 |
|------|------|
| `pairing`（默认） | 陌生人收到配对码，1 小时过期，CLI 审批 |
| `allowlist` | 仅白名单用户（无配对选项） |
| `open` | 允许任何人（需 `allowFrom: ["*"]`） |
| `disabled` | 忽略所有入站 DM |

### 10.3 Exec Approvals（命令审批）

```jsonc
{
  "tools": {
    "exec": {
      "security": "allowlist",  // "deny" / "allowlist" / "full"
      "ask": "on-miss"          // "off" / "on-miss" / "always"
    }
  }
}
```

**审批流程**：
1. Gateway 广播 `exec.approval.requested`
2. Control UI / macOS App / Chat 命令 解决审批
3. 选项：Allow Once / Always Allow（加入白名单）/ Deny

**Safe Bins**：`jq`/`cut`/`uniq`/`head`/`tail`/`tr`/`wc` 默认免审批（仅 stdin 模式）。

### 10.4 Docker 沙箱

```jsonc
{
  "sandbox": {
    "mode": "non-main",     // "off" / "non-main" / "all"
    "scope": "session",     // "session" / "agent" / "shared"
    "workspaceAccess": "none",  // "none" / "ro" / "rw"
    "docker": {
      "network": "none",
      "readOnlyRoot": true,
      "capDrop": ["ALL"],
      "pidsLimit": 256,
      "memory": "1g"
    }
  }
}
```

**Workspace Access**：
- `none`（默认）：隔离 Workspace，工具运行于 `~/.openclaw/sandboxes`
- `ro`：只读挂载 Agent Workspace 到 `/agent`
- `rw`：读写挂载到 `/workspace`

### 10.5 安全审计

```bash
openclaw security audit           # 基础审计
openclaw security audit --deep    # 深度审计
openclaw security audit --fix     # 自动修复
```

---

## 十一、Plugin 系统

### 11.1 插件能力

插件运行于 Gateway 进程内（in-process），可注册：

| 能力 | 注册方法 |
|------|---------|
| Gateway RPC 方法 | `api.registerGatewayMethod()` |
| HTTP 路由 | `api.registerHttpRoute()` |
| Agent 工具 | `api.registerTool()` |
| CLI 命令 | `api.registerCli()` |
| 后台服务 | `api.registerService()` |
| 消息渠道 | `api.registerChannel()` |
| 自动回复命令 | `api.registerCommand()` |
| 生命周期 Hook | `api.on()` |
| Provider Auth | `api.registerProvider()` |
| Skills | 通过 manifest `skills` 目录 |

### 11.2 插件加载顺序

```
1. plugins.load.paths（配置路径）
2. <workspace>/.openclaw/extensions/*.ts
3. ~/.openclaw/extensions/*.ts
4. <openclaw>/extensions/*（内置）
```

### 11.3 Manifest（`openclaw.plugin.json`）

```jsonc
{
  "id": "my-plugin",
  "configSchema": { "type": "object", "properties": { ... } },
  "uiHints": { "apiKey": { "label": "API Key", "sensitive": true } }
}
```

### 11.4 插件 Slots

独占类别，同一时间只有一个插件活跃：
- `memory`：`memory-core`（默认）或 `memory-lancedb`

### 11.5 bps-engine 作为插件

bps-engine 通过 `openclaw plugins install --link` 注册为 OpenClaw 插件：
- 导出 `register(api)` 函数
- 注册 13 个 BPS tools（`bps_*`）
- 使用 `loadAidaProject()` 装载 `~/.aida/` 项目
- 共享 SQLite 数据库（与 bps-dashboard 同一个 bps.db）

---

## 十二、Gateway 协议

### 12.1 Wire Protocol

传输层：WebSocket text frames with JSON payloads。初始帧必须为 `connect` 请求。

**三种帧类型**：

| 类型 | 格式 | 说明 |
|------|------|------|
| Request | `{type:"req", id, method, params}` | 方法调用 |
| Response | `{type:"res", id, ok, payload\|error}` | 方法响应 |
| Event | `{type:"event", event, payload, seq?, stateVersion?}` | 单向推送 |

**关键约束**：
- Side-effecting 方法需要 `idempotencyKey`（服务端短时去重缓存）
- 事件无重播能力——客户端断连后必须刷新状态
- 连接握手包含完整系统快照（`hello-ok.snapshot`）

### 12.2 设备认证

所有 WebSocket 客户端必须提供设备身份：
- 新设备需配对审批才能获得 Device Token
- 客户端必须签署 `connect.challenge` nonce
- 签名绑定平台和设备家族元数据
- 本地连接（loopback / 本机 tailnet 地址）可自动审批

### 12.3 角色与权限

| 角色 | 说明 | Scope |
|------|------|-------|
| `operator` | 控制面客户端（CLI/UI/自动化） | `operator.read/write/admin/approvals/pairing` |
| `node` | 能力宿主（camera/screen/canvas/system.run） | 能力声明（caps/commands/permissions） |

---

## 十三、模型管理

### 13.1 模型格式

`"provider/model"` 字符串或 `{ primary, fallbacks }` 对象。

### 13.2 Auth Profile 系统

凭据存储于 `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`：
- API Key profiles、OAuth profiles（含 refresh token）
- Session 内 pin 选定 profile（保持 provider cache warm）
- 可通过 `/model …@<profileId>` 锁定 Session 级别

### 13.3 故障转移

两阶段失败处理：
1. **Profile 轮转**：同一 provider 内多 profile 轮换（OAuth 优先，按最旧使用时间排序）
2. **模型回退**：所有 profile 失败 → 切换到 `model.fallbacks` 中的下一个模型

**冷却机制**：
- 瞬态故障（auth/rate-limit/timeout）：指数退避 1m → 5m → 25m → 1h
- 账单故障：5h 起，翻倍，上限 24h

### 13.4 自定义 Provider

```jsonc
{
  "models": {
    "providers": {
      "custom-proxy": {
        "baseUrl": "http://localhost:4000/v1",
        "apiKey": "KEY",
        "api": "openai-completions",  // 或 anthropic-messages / google-generative-ai
        "models": [{ "id": "llama-3.1-8b", "contextWindow": 128000 }]
      }
    }
  }
}
```

支持 30+ 提供者：Anthropic/OpenAI/Google/Mistral/Ollama/OpenRouter/vLLM/MiniMax/Qwen/Together 等。

---

## 十四、AIDA 集成要点

### 14.1 BPS 概念与 OpenClaw 映射

| BPS 概念 | OpenClaw 对应 | 说明 |
|---------|-------------|------|
| BPS Process | Agent Session / Sub-Agent Run | Session 是 Process 的运行时容器 |
| BPS Service | Skill | Service 定义 → Skill 实现 |
| BPS Entity (Dossier) | Memory File / Workspace File | 实体状态持久化 |
| BPS SysCall | sessions_spawn / sessions_send / steer | Agent 操作原语 |
| BPS Rule（非确定性） | LLM 评估 | 自然语言规则路由给模型 |
| BPS Role (Agent) | Agent 实例 | 计算节点 |
| Governance Gate | Exec Approval + Tool Policy + Sandbox | 治理拦截 |
| 三频模型 | Heartbeat + Cron + Event | 完美对应 |

### 14.2 Workspace 文件语义（AIDA 约定）

| 文件 | AIDA 用途 |
|------|----------|
| `SOUL.md` | WHO/WHY——Aida 人格、价值观、核心原则 |
| `AGENTS.md` | HOW/WHAT——操作规程、首次启动、工具使用 |
| `IDENTITY.md` | 对外展示——名字、emoji |
| `HEARTBEAT.md` | Freq 2 心跳检查清单 |
| `BOOT.md` | Gateway 重启时的启动检查清单 |
| `skills/` | 7 个 Aida Skills（project-init 等） |
| `memory/` | 日运营记录 |

### 14.3 关键实践建议

1. **Sub-Agent 上下文精简**：子 Agent 仅注入 AGENTS.md + TOOLS.md，SOUL.md 等不注入——这意味着 Skill 文件应当自包含所有必要指令
2. **MEMORY.md 仅主会话**：敏感业务数据放 MEMORY.md 是安全的，群聊不会加载
3. **Heartbeat 空文件优化**：空 HEARTBEAT.md 跳过 API 调用——无需心跳时清空文件即可
4. **Plugin 注册工具**：bps-engine 通过 `api.registerTool()` 注册所有 BPS tools
5. **Session 重置策略**：DM 默认共享主会话，多用户场景必须设 `per-channel-peer`
6. **模型回退链**：生产环境应配置 `model.fallbacks` 以提高可用性
7. **安全基线**：生产部署应设 `sandbox.mode: "non-main"` + `exec.security: "allowlist"`

---

## 附录：与 v1 报告的主要差异

| 维度 | v1（源码分析） | v2（官方文档） |
|------|-------------|-------------|
| 架构模型 | 粗略描绘 | Gateway hub-and-spoke 完整描述 |
| Workspace 文件 | 未覆盖 | 7 个 Bootstrap 文件 + 注入规则 + 尺寸控制 |
| System Prompt | 未覆盖 | 13 段组装顺序 + 3 种 Prompt 模式 |
| Session 管理 | 仅 Session Key | DM Scope / 生命周期 / Compaction / Pruning / Maintenance |
| Memory | 基础双层 | QMD 后端 / 时间衰减 / MMR / 嵌入缓存 / Session Memory |
| Multi-Agent | 仅 subagent | Binding 路由系统 / 隔离三维度 / Agent-to-Agent 通信 |
| Sub-Agent | 基础 | 嵌套深度 / Orchestrator 模式 / 工具策略 / Thread Binding |
| Agent Loop | 未覆盖 | 5 Phase 执行流 + Hook 体系 + 队列并发 |
| 安全模型 | 粗略 | 信任模型 / DM 策略 / Exec Approvals / Sandbox / 安全审计 |
| Plugin API | 基础接口 | 完整能力注册 / Manifest / Slots / Channel 开发 / Provider Auth |
| 自动化 | 仅 cron 工具 | Heartbeat 配置 / Cron 调度 / Hooks webhook / 投递选项 |
| 模型管理 | 未覆盖 | Auth Profile / 故障转移 / 冷却 / 自定义 Provider |
| 协议 | WebSocket 帧 | 设备认证 / 配对 / 角色权限 / 协议版本 |

---

*本报告基于 https://docs.openclaw.ai/ 官方文档系统学习，覆盖 20+ 核心文档页面。所有配置示例和行为描述均来自官方文档，可作为 AIDA 平台开发的直接参考。*

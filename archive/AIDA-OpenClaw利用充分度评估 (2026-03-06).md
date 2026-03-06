# AIDA x OpenClaw 利用充分度评估

**评估日期：2026-03-06**
**基于：OpenClaw 框架技术研究报告 v2（官方文档）**

---

## 评估方法

将 OpenClaw v2 研究报告中的 **14 大能力域** 逐一对照 AIDA 当前实现，分为三档：

| 档次 | 含义 |
|------|------|
| 充分利用 | 核心能力已对接，设计合理 |
| 部分利用 | 有对接但存在明显遗漏，或设计了但未落地 |
| 未利用 | 完全未使用（含有意不用和无意遗漏） |

---

## 一、逐域评估总表

| # | OpenClaw 能力域 | 利用度 | AIDA 现状 | 差距性质 |
|---|---------------|--------|----------|---------|
| 1 | Plugin System | 充分 | `registerBpsPlugin()` + 13 tools + event bridge | 完备 |
| 2 | Tool Registration | 充分 | 13 BPS tools，5 个治理包装 | 完备 |
| 3 | Workspace Files | 充分 | 5 文件 + 7 Skills，内容精简 | 完备 |
| 4 | Event Bridge | 充分 | 双向：BPS->OC 4 事件 + OC->BPS `subagent.ended` | 完备 |
| 5 | Session 管理 | 部分 | 依赖默认值，未显式配置 DM Scope / Reset / Compaction | 可优化 |
| 6 | Memory 系统 | 部分 | 文件层面使用，`memory_search` 语义搜索完全未用 | 应补齐 |
| 7 | 自动化（Heartbeat/Cron） | 部分 | HEARTBEAT.md 已写，Cron Freq 3 设计了但 `cron` tool 未调用 | 应补齐 |
| 8 | Plugin Hooks | 未利用 | 未使用任何生命周期 Hook；BOOT.md 未生效 | 可优化 |
| 9 | 安全机制 | 部分 | 自建 Governance 替代，但 OpenClaw 原生安全层未配置 | 应补齐 |
| 10 | 模型管理 | 部分 | 仅设主模型，无 fallback 链 | 应补齐 |
| 11 | Multi-Agent | 未利用 | 有意不用（Skills 替代） | 合理决策 |
| 12 | Sub-Agent | 未利用 | 有意不用 | 合理决策 |
| 13 | Channel 集成 | 部分 | 仅 Feishu | 业务导向，暂可 |
| 14 | Gateway 协议 | 充分 | 透明层，AIDA 不需关注 | N/A |

**综合利用度：约 55-60%**（14 域中 4 个充分、6 个部分、4 个未用）

---

## 二、高价值差距分析（建议补齐）

### Gap 1：Cron 调度未接通（Freq 3 断裂）

**现状**：`action-plan` Skill 设计了 `periodicItems` 含 cron 表达式，HEARTBEAT.md 有检查清单，但 OpenClaw 的 `cron` tool 从未被实际调用。Aida 的 Freq 3（计划执行）在架构上是空转的。

**影响**：Action Plan 中的周期任务（如"每天 9:00 执行 GEO 探测"）需要人工提醒 Aida，而非自动触发。

**建议**：在 `action-plan` Skill 中明确指导 Aida 调用 `cron` tool 注册周期任务。同时在 `AGENTS.md` 的 Boot 节增加"恢复已注册 cron 任务"检查。

### Gap 2：`memory_search` 语义搜索未使用

**现状**：Aida 通过 `memory_get`（文件读取）手动访问记忆，从未使用 `memory_search`（向量语义搜索）。随着 `memory/` 目录累积数日运营日志，手动检索效率将急剧下降。

**影响**：Aida 无法跨日期语义检索历史信息（如"上周关于竞品分析的记录"），只能靠 MEMORY.md 中的手工摘要。

**建议**：在 `AGENTS.md` 的 Memory 节加入 `memory_search` 使用指引——对于模糊回忆或跨日期查询，优先用语义搜索而非遍历文件。

### Gap 3：模型 Fallback 链未配置

**现状**：`openclaw.json` 仅设 `agents.defaults.model: "google/gemini-3.1-pro-preview"`，无 `fallbacks`。

**影响**：Gemini API 故障时 Aida 完全不可用。OpenClaw 已内建两阶段故障转移（Profile 轮转 -> Model 回退），但需要配置 fallback 列表才能生效。

**建议**：配置 fallback 链，例如：
```jsonc
"model": {
  "primary": "google/gemini-3.1-pro-preview",
  "fallbacks": ["anthropic/claude-sonnet-4-6", "openai/gpt-4.1"]
}
```

### Gap 4：BOOT.md 未生效

**现状**：`BOOT.md` 存在（内含 3 步启动检查清单），但 `openclaw.json` 未设 `hooks.internal.enabled: true`。Gateway 重启时 BOOT.md 不会被执行。

**影响**：Gateway 重启后 Aida 不会自动检查 `~/.aida/project.yaml` 完整性、确认 cron 任务、或扫描失败任务——这些检查只在用户手动对话时才发生。

**建议**：在 `install-aida.sh` 的 openclaw.json 合并中加入 `"hooks": { "internal": { "enabled": true } }`。

### Gap 5：Session Compaction 和 Memory Flush 未配置

**现状**：依赖 OpenClaw 默认 Compaction 行为，未显式配置 `compaction.memoryFlush`。

**影响**：当 Aida 与用户长对话接近上下文窗口时，Compaction 前不会自动将重要信息保存到 `memory/` 文件——可能丢失未写入的运营决策。

**建议**：配置 `compaction.memoryFlush.enabled: true`，确保 Compaction 前触发静默记忆冲刷 Turn。

### Gap 6：安全基线缺失

**现状**：AIDA 自建了 Governance 治理层（ActionGate + CircuitBreaker），但 OpenClaw 原生安全层完全未配置：
- `tools.exec.security` 未设（默认行为不明确）
- `sandbox.mode` 未设
- `dmPolicy` 仅 Feishu 有配（其他渠道无）

**影响**：Governance 层仅拦截 5 个 BPS 写操作工具。Aida 仍可通过 OpenClaw 原生工具（`exec`、`write`、`edit`）绕过治理层直接操作文件系统——这正是 IdleX GEO E2E 测试中发现的 P0 问题（Aida 通过文件 I/O 绕过 `bps_update_entity` 治理）。

**建议**：
- 设 `tools.exec.security: "allowlist"` + `tools.exec.ask: "on-miss"`
- 考虑 `tools.deny: ["write", "edit", "apply_patch"]` 或至少限制写入路径
- 生产环境设 `sandbox.mode: "non-main"`

---

## 三、中等价值优化

| 项目 | 说明 | 难度 |
|------|------|------|
| Plugin Hooks（before_tool_call） | 可将 Governance 治理检查从 JS 包装层迁移到 OpenClaw Hook 层，实现与 OpenClaw 原生 exec approval 的统一 | 中 |
| Tool Loop Detection | 配置 `tools.loopDetection`，防止 Agent 对失败操作无限重试 | 低 |
| Context Pruning | 配置 `contextPruning` 对长 tool result（如 `bps_scan_work` 返回的大 JSON）自动修剪 | 低 |
| Session `dmScope: "per-channel-peer"` | 如果未来多用户访问 Aida，必须设置此项防止上下文泄露 | 低 |

---

## 四、合理的"不使用"

| 项目 | 不使用原因 | 评价 |
|------|----------|------|
| Multi-Agent 路由 | Skills 取代子 Agent（ADR-11），架构更简 | 正确 |
| Sub-Agent API | 同上 | 正确 |
| Agent-to-Agent 通信 | 单 Agent 模型，无需 | 正确 |
| 设备配对 | 单用户场景 | 合理 |
| ClawHub 注册中心 | Aida Skills 为项目私有 | 合理 |
| QMD 后端 | 默认 SQLite 够用 | 合理 |

---

## 五、建议优先级

| 优先级 | 项目 | 预期收益 | 工作量 |
|--------|------|---------|--------|
| P0 | Gap 6：安全基线（exec allowlist + 文件写入限制） | 堵住治理绕过漏洞 | 小（配置变更） |
| P0 | Gap 3：模型 Fallback 链 | 生产可用性保障 | 小（配置变更） |
| P1 | Gap 4：BOOT.md 生效（hooks.internal.enabled） | Gateway 重启自愈 | 小（配置变更） |
| P1 | Gap 1：Cron 调度接通 | Freq 3 落地，周期任务自动化 | 中（Skill 修改 + 配置） |
| P1 | Gap 5：Compaction Memory Flush | 长对话记忆保全 | 小（配置变更） |
| P2 | Gap 2：memory_search 语义搜索 | 跨日期智能回忆 | 小（AGENTS.md 指引） |
| P2 | Tool Loop Detection | 防止无限重试 | 小（配置变更） |
| P2 | Context Pruning | 减少 token 浪费 | 小（配置变更） |

---

## 六、结论

AIDA 对 OpenClaw 的利用呈现"核心路径深、外围配置浅"的特征：

- **做得好的**：Plugin 集成、Tool 注册、Event Bridge、Workspace 文件体系、Skills 系统——这些构成了 AIDA 的骨干，设计质量高。
- **最大短板**：配置层面几乎全部依赖默认值——Session 策略、安全基线、模型管理、自动化调度、Compaction 策略均未显式配置。这在开发阶段可以接受，但在生产部署中是隐患。
- **最紧迫的问题**：Gap 6（安全基线）直接关联 IdleX GEO E2E 测试中发现的 P0 漏洞——Agent 通过原生文件 I/O 工具绕过 Governance 层。

建议以 P0 配置变更（安全基线 + 模型 Fallback）为起点，逐步补齐 P1/P2 项目。这些大多是 `install-aida.sh` 中 `openclaw.json` 的配置合并，代码改动量极小。

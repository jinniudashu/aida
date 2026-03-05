# AIDA 端到端能力验证报告 -- OpenClaw 运行时

> 验证日期：2026-03-05
> 验证环境：root@47.236.109.62 (Alibaba Cloud ECS)
> OpenClaw 版本：2026.3.2
> Aida 模型：google/gemini-3.1-pro-preview (1024k context)
> 验证方式：通过 `openclaw agent --agent main --message` 与 Aida 交互

## 验证目标

验证 AIDA 系统（Aida Agent + bps-engine + bps-dashboard）在 OpenClaw 运行时中的端到端能力：
1. NL 描述 -> Aida 理解 -> 业务建模
2. Aida 执行业务程序 -> 实体状态变更
3. 事件/Heartbeat/Cron 三频驱动
4. Dashboard 可视化反馈

## 环境准备

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1. DB 清理 | 删除 bps.db + WAL + SHM | 全新 4096 字节空 DB |
| 2. 蓝图清理 | 清空 ~/.aida/blueprints/ | 0 blueprints |
| 3. 会话清理 | sessions.json 置空 | 0 sessions |
| 4. 模型配置 | primary model -> google/gemini-3.1-pro-preview | 已验证 configured + auth |
| 5. 服务重启 | OC gateway + Dashboard 全部重启 | 新 PID, 0 services |
| 6. Dashboard 对齐 | BPS_BLUEPRINTS_DIR 指向 ~/.aida/blueprints/ | 不再加载 demo 蓝图 |

## 测试执行记录

### Step 1: NL 业务描述 (20.6s)

**输入**: "你好 Aida，我经营一家小型咖啡连锁品牌叫晨光咖啡...先从最基础的日常开店流程开始"

**Aida 行为**:
- 读取 project.yaml，识别晨光咖啡品牌信息
- 遵循 SBMP Step 1（Core Value & Service Identification）
- 提出 3 个结构化问题（完美准备状态、状态流转、关键角色）
- 中文回复，语气专业自然

**验证**: PASS -- Aida 正确加载 workspace 文件，识别 blueprint-modeling Skill，按 SBMP 方法论引导建模

### Step 2: 蓝图生成 (40.1s)

**输入**: 回答 Aida 的 3 个问题 + "请直接帮我生成蓝图YAML，不用再详细确认了"

**Aida 行为**:
- 使用 `write` 工具保存 YAML 到 `~/.aida/blueprints/morningbrew-store-opening.yaml`
- 生成 3415 字节的结构化蓝图：5 services, 2 roles, 1 entity type
- 蓝图包含 4 个原子服务（环境准备、物料检查、设备调试、收银开启）
- 每个服务定义了具体的 form 字段（boolean 检查项）

**验证**: PARTIAL -- 文件成功写入，内容结构合理，但 **YAML 格式与 bps-engine 的 yaml-loader 不兼容**（详见"发现的问题"）

### Step 3: 执行尝试 (85.2s, 失败)

**输入**: "请用这个蓝图来实际执行一次北京朝阳店今天的开店流程"

**Aida 行为**:
- 尝试调用 `bps_list_services` -> 返回 "file is not a database" 错误
- 正确诊断问题："bps.db SQLite database isn't initialized properly"
- 尝试读取 business-execution Skill 了解执行协议
- 输出为 thinking chain（未产生用户可见回复）

**验证**: FAIL（预期内）-- DB 连接因清理操作而断裂，需要重启 OC gateway

### Step 4: 实体创建 (20.9s)

*（重启 OC gateway 后）*

**输入**: 指示 Aida 用 bps_update_entity 创建 5 个实体

**Aida 行为**:
- 调用 `bps_update_entity` 5 次
- 创建 3 个 store 实体 + 1 个 store_daily_opening 实体 + 1 个 action-plan 实体
- 所有实体正确写入 DossierStore

**Dashboard 验证**:
```
store/BJ-CY-001           v1  status=营业中
store/SH-PD-001           v1  status=营业中
store/SZ-NS-001           v1  status=营业中
store_daily_opening/BJ-CY-001-2026-03-05  v1  status=Closed
action-plan/daily-ops-standardization     v1  status=active
```

**验证**: PASS -- 5 个实体全部创建成功，Dashboard API 确认可见

### Step 5: 开店流程执行 (38.8s)

**输入**: "模拟执行北京朝阳店今天的开店流程，逐步记录每个环节"

**Aida 行为**:
- 调用 `bps_update_entity` 5 次，每次带 commit message
- 状态流转：Closed -> Preparing -> (环境完成) -> (物料完成) -> (设备完成) -> Ready
- 实体从 v1 更新到 v6

**Dashboard 验证**: `store_daily_opening/BJ-CY-001-2026-03-05  v6  status=Ready`

**验证**: PASS -- 6 个版本的完整审计轨迹，状态正确流转到 Ready

### Step 6: Heartbeat 检查 (31.5s)

**输入**: "执行 Heartbeat 检查，扫描工作全景，更新行动计划"

**Aida 行为**:
- 调用 `bps_scan_work` -- 返回 0 failed / 0 open / 0 in_progress
- 检查 action-plan 实体状态
- 更新 action-plan 添加进展日志

**Dashboard 验证**:
- Business Goals API 显示 daily-ops-standardization 计划
- action-plan v2 包含 `progressLogs: ["2026-03-05: BJ-CY-001 日常开店流程已完成"]`

**验证**: PASS -- Heartbeat 协议完整执行

### Step 7: 动态 Skill 创建 (27.2s)

**输入**: "请用 bps_create_skill 创建一个 store-opening Skill，固化开店流程"

**Aida 行为**:
- 调用 `bps_create_skill` 创建 store-opening Skill
- SKILL.md 包含 6 步标准操作规程（SOP）
- 正确引用 `bps_update_entity` 和实体类型

**磁盘验证**: `~/.openclaw/workspace/skills/store-opening/SKILL.md` 存在，内容完整

**验证**: PASS -- 动态 Skill 创建成功，Self-Evolution 能力确认

### Step 8: Skill 复用执行 (41.6s)

**输入**: "用刚创建的 store-opening Skill 为上海浦东店执行今天的开店流程"

**Aida 行为**:
- 读取 store-opening SKILL.md
- 创建 SH-PD-001-2026-03-05 实体
- 按 6 步 SOP 执行，状态 Closed -> Preparing -> Ready
- 更新 action-plan 进展

**Dashboard 验证**:
```
store_daily_opening/SH-PD-001-2026-03-05  v6  status=Ready
action-plan/daily-ops-standardization     v3  status=active
```

**验证**: PASS -- Skill 复用成功，第二家门店流程标准化执行

## 最终系统状态

### 实体 (8 个)
| 类型 | ID | 版本 | 状态 |
|------|-----|------|------|
| store | BJ-CY-001 | v1 | 营业中 |
| store | SH-PD-001 | v1 | 营业中 |
| store | SZ-NS-001 | v1 | 营业中 |
| store_daily_opening | BJ-CY-001-2026-03-05 | v6 | Ready |
| store_daily_opening | SH-PD-001-2026-03-05 | v6 | Ready |
| action-plan | daily-ops-standardization | v3 | active |
| knowledge | system:task-tracking-sop | v1 | - |
| knowledge | system:project-config | v1 | - |

### Skills (8 个 = 7 原始 + 1 动态创建)
action-plan, agent-create, blueprint-modeling, business-execution,
dashboard-guide, project-init, skill-create, **store-opening** (动态)

### 会话统计
- 1 个活跃会话，model: gemini-3.1-pro-preview
- 总 token 消耗: ~44k / 1049k (4%)
- 7 次 agent turn，总耗时 ~316 秒

## 发现的问题

### P0: Blueprint YAML 格式不兼容

**现象**: Aida 通过 blueprint-modeling Skill 生成的 YAML 使用概念化格式（entities/roles/form 结构），但 bps-engine 的 yaml-loader 期望技术格式（services 数组 + events + instructions + rules）。

**影响**:
- `Blueprints: 0` -- 引擎无法解析 Aida 生成的 YAML
- `bps_create_task` 无法工作（需要 serviceId，但 BlueprintStore 为空）
- `bps_next_steps` 无法工作（需要 rules 表）
- Dashboard 的 Processes / Agent Log 页面为空

**根因**: blueprint-modeling Skill 的 SBMP 方法论面向业务概念建模，与引擎的技术 schema 之间缺少翻译层。

**建议**:
1. 在 Skill 中增加 Step 5 的具体输出 schema 示例
2. 或创建一个 blueprint-compile Skill 将概念 YAML 编译为引擎格式
3. 或彻底放弃 Blueprint 层（见"架构发现"）

### P1: DossierStore 浅合并导致数据丢失

**现象**: action-plan 的 progressLogs 数组在第二次更新时被覆盖而非追加。v2 有 BJ-CY-001 的记录，v3 只剩 SH-PD-001 的记录。

**根因**: `bps_update_entity` 执行浅合并（shallow merge），数组类型字段被整体替换而非 concat。

**建议**: Aida 需要先读取（bps_get_entity）再更新，或引擎提供数组追加语义。

### P2: 无蓝图热加载

**现象**: Aida 写入新 YAML 到 ~/.aida/blueprints/ 后，引擎不会自动重新加载。需要重启 OC gateway。

**建议**: 提供 bps_reload_blueprints tool 或 filesystem watcher。

### P3: DB 共享协调问题

**现象**: OC plugin 和 Dashboard 各自创建 engine 实例连接同一 DB。清理 DB 后 OC plugin 连接失效（"file is not a database"），需要 kill 进程重启。

**建议**: 统一 DB 生命周期管理，或让 Dashboard 作为纯读取端通过 API 获取数据。

## 架构发现

### Blueprint 层的价值重估（回应 Q1）

本次 E2E 测试中，**Aida 完全绕过了 Blueprint/Task/Rule 基础设施**，仅使用：
- `bps_update_entity` -- 实体状态管理（版本化审计）
- `bps_scan_work` -- 工作全景扫描
- `bps_create_skill` -- 动态 Skill 创建

这三个工具 + DossierStore 实体 + Skills 就完成了完整的业务运营管理流程。

**Blueprint 层未被使用的原因**:
1. Aida 生成的 YAML 格式不兼容引擎（P0 bug）
2. 即使格式正确，仍需重启才能加载（P2）
3. 加载后 task 系统才能工作，但 Aida 已经用 entity 完成了同样的工作

**结论**: 对于当前场景（Agent 驱动的运营管理），**Entity + Skill 路径已经足够**。Blueprint/Task/Rule 层增加了复杂性但未提供不可替代的价值。Blueprint 的唯一独特价值是：
- 机器可查询的流程拓扑（`bps_next_steps`）
- Dashboard 流程可视化（Process 拓扑图、状态动画）

如果这两个能力不是核心需求，Blueprint 层可以进一步简化或移除。

## 能力评分

| 能力 | 权重 | 评分 | 说明 |
|------|------|------|------|
| NL -> 业务理解 | 15% | 95 | SBMP 引导建模优秀 |
| 蓝图生成 | 15% | 40 | 生成了但格式不兼容引擎 |
| 实体管理 | 20% | 95 | 版本化 CRUD 完美工作 |
| 任务执行 | 15% | 20 | 依赖蓝图，无法创建任务 |
| Heartbeat 流程 | 10% | 90 | scan_work + plan update |
| 动态 Skill | 10% | 95 | 创建 + 复用成功 |
| Dashboard 可视化 | 10% | 60 | 实体可见，任务/流程为空 |
| LLM 配置 | 5% | 100 | Gemini 3.1 Pro 正常工作 |

**加权总分: 67.75 / 100**

**与上次测试（93.25 分）的差异**: 上次测试通过 HTTP API 直接调用 Dashboard，绕过了 OpenClaw/Aida 层。本次测试真实暴露了 Blueprint 格式不兼容、无热加载等问题。

## 结论

AIDA 的 **Entity + Skill + Heartbeat** 路径已经具备实用的业务运营管理能力。Aida 能够通过自然语言理解业务需求、创建实体、管理状态、执行 Heartbeat 检查、动态创建 Skill。

但 **Blueprint -> Task -> Rule** 路径存在断裂：
1. Aida 生成的 YAML 无法被引擎加载
2. Task 系统依赖加载的 Blueprint，因此完全失效
3. Dashboard 的 Process/Agent Log 页面无数据

**建议下一步**:
1. **P0**: 修复 Blueprint YAML 格式（或决定是否放弃 Blueprint 层）
2. **P1**: 修复 DossierStore 数组追加语义
3. **P2**: 添加蓝图热加载
4. **验证 Cron**: 本次未测试 Cron 调度（需要等待真实时间触发）

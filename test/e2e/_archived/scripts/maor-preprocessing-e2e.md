# MAOr 预处理 E2E 测评方案

> 版本: v0.1 (draft)
> 目标: 评估"原始物料 → 预处理 → AIDA 建模"端到端管线的质量，为预处理知识沉淀提供闭环反馈

## 1. 测评目标

本测评与现有 IdleX GEO E2E 的关键区别：

| 维度 | IdleX GEO E2E | MAOr 预处理 E2E |
|------|--------------|-----------------|
| 考察对象 | AIDA Agent 的运营执行能力 | 预处理输出 → AIDA 建模的转化质量 |
| 输入 | 人工编写的 context/ 文档 | 预处理器从原始物料生成的 context/ |
| 成功标准 | Agent 工具调用正确率 | AIDA 产出的 BPS 制品是否覆盖源物料中的业务要素 |
| 反馈目标 | 优化 Workspace/工具/模型 | 优化预处理规格和流程 |

## 2. 测评架构

```
Phase 0        Phase 1              Phase 2              Phase 3
原始物料 ──→ 预处理输出 ──→ AIDA 建模 ──→ 制品评估
(63 files)   (4 md files)   (entities/     (coverage +
              in context/    blueprints/     fidelity +
                             management)     usability)
                                  │
                                  ▼
                          Phase 4: 差距分析
                          → 反馈到 Phase 1 优化预处理
```

三角色分离（沿用 benchmark 架构）：
- **Runner**: bash 脚本，自动化 seed + AIDA 交互 + 指标采集
- **SUT**: Aida Agent（远端服务器），消费 context/ 执行建模
- **Evaluator**: Claude（本地会话），对比源物料与 AIDA 产出

## 3. 测评维度与评分标准

6 个维度，加权总分 10 分制：

| # | 维度 | 权重 | 考察内容 |
|---|------|------|----------|
| D1 | 业务要素覆盖率 | 0.25 | AIDA 产出的 Entity 是否覆盖源物料中识别出的业务对象 |
| D2 | 业务逻辑保真度 | 0.25 | 定价规则/会员规则/治疗参数等量化信息是否准确传达 |
| D3 | 流程建模完整度 | 0.15 | 7 步患者旅程是否被建模为 Service/Blueprint |
| D4 | 合规约束捕获率 | 0.15 | 知情同意/治疗间隔/剂量上限等约束是否转化为 Management |
| D5 | 可操作性 | 0.10 | 建模产出是否可被后续运营直接使用（非空壳） |
| D6 | 无幻觉 | 0.10 | AIDA 是否引入了源物料中不存在的信息 |

### 评分规则

每个维度 1-10 分：
- **9-10**: 完整准确，无遗漏
- **7-8**: 主要内容覆盖，少量细节缺失
- **5-6**: 框架正确但内容显著不完整
- **3-4**: 仅覆盖部分，关键要素缺失
- **1-2**: 基本未覆盖或大量错误

关键原则：**以源物料为 ground truth**，AIDA 产出与源物料对比而非与预处理输出对比。预处理输出只是中间管道——如果预处理丢失了信息导致 AIDA 建模缺失，算预处理的问题。

## 4. Ground Truth 检查清单

从源物料中提取的 **可验证业务要素**，作为评分依据。

### D1: 业务要素覆盖率（Entity 清单）

AIDA 应创建的 Entity 类型及最低数量：

| ID | Entity 类型 | 最低数量 | 来源 | 验证方法 |
|----|-------------|----------|------|----------|
| E1 | treatment-item（治疗项目） | 15 | 收费标准 PPT 约50种，至少覆盖主力项目 | HARD: entity count |
| E2 | service-package（服务套餐） | 3 | 3万年卡 + 2万年卡 + 单品年度疗程 | HARD: entity count |
| E3 | membership-tier（会员等级） | 5 | VIP/银/金/白金/钻石 | HARD: entity count |
| E4 | consent-template（知情同意模板） | 5 | 8类中至少覆盖主力项目 | SOFT: entity count |
| E5 | post-care-protocol（术后护理方案） | 8 | 19种去重后约12种，覆盖主力 | SOFT: entity count |
| E6 | follow-up-schedule（随访计划） | 1 | 8种治疗的随访时间表 | SOFT: entity exists |
| E7 | role（组织角色） | 3 | 医生/护士/客服 | SOFT: entity count |
| E8 | product-catalog（产品目录） | 5 | 10类耗材中至少覆盖注射类 | SOFT: entity count |

检查点合计：8 项（3 HARD + 5 SOFT）

### D2: 业务逻辑保真度（关键数据点）

AIDA 产出中应包含的 **精确量化信息**：

| ID | 数据点 | 正确值 | 验证方法 |
|----|--------|--------|----------|
| F1 | 3万年卡价格 | 30,000元/年 | HARD: entity field |
| F2 | 3万年卡模式 | 六选三 | HARD: entity field |
| F3 | 肉毒素100U单价 | 6,500元 | HARD: entity field |
| F4 | 会员折扣不叠加 | 明确规则 | SOFT: entity/management |
| F5 | 钻石卡三星充值 | 140万元 | SOFT: entity field |
| F6 | 钻石卡三星折扣 | 68% | SOFT: entity field |
| F7 | 超声炮全模式价格 | 20,800元 | SOFT: entity field |
| F8 | 年卡附带权益(8折) | 其它项目8折 | SOFT: entity field |

检查点合计：8 项（3 HARD + 5 SOFT）

### D3: 流程建模完整度（Service/Blueprint）

| ID | 流程环节 | 期望建模形式 | 验证方法 |
|----|----------|-------------|----------|
| P1 | 7步患者旅程整体 | Blueprint (flow DSL) | HARD: blueprint exists |
| P2 | 预约 → 接待 → 面诊 顺序 | flow: appointment -> reception -> consultation | SOFT: flow correct |
| P3 | 面诊 → 收费 → 治疗 顺序 | flow: consultation -> billing -> treatment | SOFT: flow correct |
| P4 | 治疗 → 随访 → 新预约 循环 | flow: treatment -> follow_up -> appointment | SOFT: flow correct |
| P5 | 面诊包含健康筛查 | service 描述中提及 | SOFT: service detail |
| P6 | 收费区分多种计费类型 | service 描述中提及 | SOFT: service detail |
| P7 | 随访周期因项目不同 | service 描述或 entity 中体现 | SOFT: any artifact |

检查点合计：7 项（1 HARD + 6 SOFT）

### D4: 合规约束捕获率（Management）

| ID | 约束 | 类型 | 验证方法 |
|----|------|------|----------|
| G1 | 治疗前须签知情同意书 | REQUIRE_APPROVAL | HARD: constraint exists |
| G2 | 肉毒素2月内≤200U | BLOCK | SOFT: constraint exists |
| G3 | 光子治疗间隔≥3周 | BLOCK | SOFT: constraint exists |
| G4 | 疗程折扣不与会员折扣叠加 | BLOCK | SOFT: constraint or rule |
| G5 | 禁忌症患者不可治疗 | BLOCK | SOFT: constraint exists |
| G6 | 三星钻石限20名 | BLOCK | SOFT: constraint exists |
| G7 | 麻药面积≤2000cm² | BLOCK | SOFT: constraint exists |

检查点合计：7 项（1 HARD + 6 SOFT）

### D5: 可操作性（抽样验证）

| ID | 场景 | 期望行为 | 验证方法 |
|----|------|----------|----------|
| U1 | 查询"光子嫩肤价格" | 返回 1,500/次 或 买4送1 | SOFT: query test |
| U2 | 查询"3万年卡包含什么" | 返回六选三内容 | SOFT: query test |
| U3 | 查询"肉毒素术后注意什么" | 返回不按摩/不饮酒/起效时间等 | SOFT: query test |
| U4 | 查询"新患者到店流程" | 返回7步或其子集 | SOFT: query test |

检查点合计：4 项（0 HARD + 4 SOFT）

### D6: 无幻觉（负面检查）

| ID | 检查 | 验证方法 |
|----|------|----------|
| H1 | 不出现源物料中不存在的治疗项目 | SOFT: manual review |
| H2 | 不出现源物料中不存在的价格 | SOFT: manual review |
| H3 | 不出现源物料中不存在的流程步骤 | SOFT: manual review |

检查点合计：3 项（0 HARD + 3 SOFT）

**总计：37 个检查点**（8 HARD + 29 SOFT）

## 5. 对话脚本

### v0.1 脚本（6 Turns, Round 1 使用）

Round 1 使用 6 turns。Turn 4 合并了知情同意+术后护理+管理约束，导致创建不完整。

### v0.2 脚本（7 Turns, Round 2+ 使用）

将 Turn 4 拆分为 4a（知情同意+管理）和 4b（术后护理），增加明确数量期望。

#### Turn 1: 项目初始化 + 业务理解

```
你是广州颜青医疗美容诊所的运营管理助理。
请阅读 context/ 目录下的全部业务文档，然后：
1. 总结这家诊所的业务概况（服务类型、收入模式、组织角色）
2. 列出你识别到的核心业务实体类型
3. 开始创建业务实体：先从治疗项目（至少15个主力项目）和服务套餐（全部5个）开始
```

**期望产出**：
- 业务理解输出（文本）
- Entity 创建：treatment-item × 15+, service-package × 5

#### Turn 2: 补充实体 + 会员体系

```
继续创建：
1. 会员等级体系（5个等级：VIP/银/金/白金/钻石，每个含3星级的充值额和折扣率）
2. 产品目录（至少10个，覆盖注射类、护肤品和耗材）
3. 组织角色（4个：医生/护士/客服/设备工程师）
```

**期望产出**：
- Entity 创建：membership × 5, product-inventory × 10+, staff-role × 4

#### Turn 3: 流程建模

```
基于文档中的"7步患者旅程"（预约→接待→面诊→收费→治疗→随访→新预约），创建一个 Blueprint。
使用 bps_load_blueprint 工具，YAML 格式包含 services 和 flow（使用箭头 DSL，如 svc-a -> svc-b -> svc-c）。
```

**期望产出**：
- Blueprint 创建（via bps_load_blueprint）
- Flow DSL 覆盖 7 步

#### Turn 4a: 知情同意 + 管理约束

```
现在建立合规体系：
1. 创建全部 8 个知情同意书模板实体（IC-01 至 IC-08，见 compliance.md 同意书覆盖范围表），每个包含编号、项目类型、适应症、禁忌、风险
2. 建立管理约束（management.yaml），至少包含：知情同意必签、肉毒素剂量上限（2月200U）、光子间隔（≥3周）、折扣不叠加、禁忌症阻断、三星钻石限额、麻药面积上限
```

**期望产出**：
- Entity 创建：consent-form × 8（IC-01~IC-08 全部）
- 管理约束写入 management.yaml（≥7 条）

#### Turn 4b: 术后护理方案

```
创建术后护理方案实体。compliance.md 中列出了 17 个方案（见"术后护理方案索引"表），请至少创建前 14 个 P0 优先级的方案：
光子嫩肤、调Q激光、CO2点阵、黄金微针、超声炮、水光注射、玻尿酸、肉毒素、果酸换肤、体表手术通用、双眼皮、眼袋、植发、脂肪填充。
每个方案包含：项目类型、时间线、禁忌行为、正常反应、异常信号。
```

**期望产出**：
- Entity 创建：post-care-protocol × 14（P0 全覆盖）

#### Turn 5: 随访与运营

```
创建随访计划实体，包含 8 种治疗的完整随访时间表（水光/黄金微针/肉毒-除皱/肉毒-咬肌/果酸/玻尿酸/光子/双眼皮）。
然后设置一个日常运营提醒（Cron），用于检查当天需要随访的患者。
```

**期望产出**：
- Entity 创建：follow-up-schedule × 1
- Cron 注册

#### Turn 6: 验证查询

```
基于你已建好的业务模型，回答以下问题：
1. 光子嫩肤多少钱一次？
2. 3万年卡包含哪些项目？
3. 肉毒素注射后要注意什么？
4. 一个新患者到店的完整流程是什么？
```

**期望产出**：
- 4 个查询的准确回答（基于已创建的 Entity，非直接读文件）

## 6. 自动化脚本结构

```bash
#!/usr/bin/env bash
# maor-preprocessing-e2e.sh
# MAOr 预处理 E2E 测评脚本

# ─── Phase 0: 环境准备 ───
# 清理 AIDA 状态（~/.aida/ 重建）
# 部署 processed/ → ~/.aida/context/
# 验证 AIDA 引擎 + Dashboard 可用

# ─── Phase 1: Seed ───
# 无业务种子数据（与 IdleX 不同，全靠 Aida 从 context/ 建模）
# 仅部署 management.yaml 空模板

# ─── Phase 2-7: 6 Turn 对话 ───
# 每 Turn:
#   1. 发送消息给 Aida
#   2. 记录响应 + 工具调用日志
#   3. 采集 Dashboard API 指标快照

# ─── Phase 8: 指标采集 ───
# metrics.json:
#   entities: 按 entityType 分组计数
#   blueprints: 数量 + 名称
#   management: constraints/violations/approvals 计数
#   skills: 数量
#   crons: 数量

# ─── Phase 9: Ground Truth 检查 ───
# 37 个检查点（8 HARD + 29 SOFT）
# HARD: 自动化断言
# SOFT: 输出待人工/Evaluator 评审的对比报告

# ─── Phase 10: 覆盖率报告 ───
# 输出:
#   coverage-report.md — 源物料要素 vs AIDA 产出的对照表
#   gap-analysis.md — 缺失要素 + 归因（预处理遗漏 / AIDA 理解错误 / 工具调用缺失）
```

## 7. 产出物

每轮测评产出：

```
test/e2e/maor-results/{run-id}/
├── metrics.json              # 量化指标
├── behavior.json             # 每 Turn 时长/工具调用
├── raw/
│   ├── turn-{1..6}.log       # 每轮对话日志
│   └── report.txt            # 最终报告
├── coverage-report.md        # 源物料覆盖率对照
├── gap-analysis.md           # 差距分析 + 归因
└── EVALUATION.md             # 6 维度评分 + 总分
```

## 8. 差距归因框架

每个缺失要素归因到四个环节之一：

| 归因 | 含义 | 优化方向 |
|------|------|----------|
| **PREPROCESS** | 预处理输出中缺失或模糊 | 改进预处理文档 |
| **COMPREHENSION** | 预处理输出中存在但 AIDA 未理解 | 改进 context/ 文档的表述方式 |
| **EXECUTION** | AIDA 理解了但未执行工具调用 | 改进 Workspace/Skill/Prompt |
| **ARCHITECTURE** | AIDA 引擎/工具缺少所需能力 | 修复引擎代码（新 tool、格式支持等） |

归因分布是本测评的**核心产出** —— 它决定了优化资源投向哪个环节。

**ARCHITECTURE 归因示例**：Blueprint 编译器不支持 `flow.rules` 对象格式、管理约束无法热加载（缺少 `bps_load_management` tool）。这类问题需要引擎代码修复而非预处理或提示词优化。

## 9. 迭代计划

```
Round 1: 当前预处理输出 (4 files) → 基线测评 → 差距分析
         ↓
Round 2: 根据 Round 1 gap-analysis 优化预处理 → 重测 → 对比
         ↓
Round 3: 如果 PREPROCESS 归因收敛，开始提炼预处理 Skill
         ↓
Round N: 预处理 Skill 移植到 AIDA，自动化整个管线
```

**收敛判据**（全部条件同时满足）：

| # | 条件 | 说明 |
|---|------|------|
| C1 | PREPROCESS 归因占比 < 20% | 预处理不再是主要瓶颈 |
| C2 | ARCHITECTURE 归因 = 0 | 引擎层无阻断性缺陷 |
| C3 | 8 个 HARD 检查点 100% 通过 | 核心业务要素全部存在 |
| C4 | D1+D2 加权分 ≥ 7.5/10 | 覆盖率+保真度达到可用水平 |
| C5 | D4 运行时 > 0（至少 1 条 management 约束被加载） | 合规体系不为空壳 |

## 10. 与现有测评的关系

本方案复用 benchmark 框架的：
- 三角色分离（Runner/SUT/Evaluator）
- HARD/SOFT 检查点模式
- metrics.json 指标采集
- 6 维度加权评分

新增的：
- Ground Truth 检查清单（从源物料提取，而非预设）
- 差距归因框架（PREPROCESS / COMPREHENSION / EXECUTION / ARCHITECTURE 四类）
- 覆盖率报告（源物料要素 vs AIDA 产出的逐项对照）
- 迭代反馈环（归因分布驱动优化方向）

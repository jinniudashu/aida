# MAOr 预处理 E2E Round 1 — 差距分析

> Run ID: `r1-kimi-k2.5` | 日期: 2026-03-10

## 归因分布

| 归因 | 数量 | 占比 | 含义 |
|------|------|------|------|
| **PREPROCESS** | 4 | 28.6% | 预处理输出中缺失或表述不利于 AIDA 建模 |
| **COMPREHENSION** | 1 | 7.1% | 预处理输出中存在但 AIDA 未正确理解 |
| **EXECUTION** | 6 | 42.9% | AIDA 理解了但未执行完整工具调用 |
| **ARCHITECTURE** | 3 | 21.4% | 引擎/平台架构限制 |
| **合计** | **14** | **100%** | |

> 注：ARCHITECTURE 归因不在原始三分类中，本轮新增——用于区分非预处理/非 AIDA 的系统性限制。

---

## 逐项差距清单

### GAP-01: 术后护理协议覆盖不足（5/12）

| 属性 | 值 |
|------|-----|
| 检查点 | E5 (post-care-protocol ≥ 8) |
| 实际 | 5 个（光子、黄金微针、水光、肉毒素、果酸） |
| 缺失 | CO2点阵、调Q激光、超声炮、玻尿酸、双眼皮/眼袋、植发、体表手术 |
| **归因** | **EXECUTION** |
| 理由 | compliance.md 包含完整 16 类术后护理，Aida Turn 4 中仅创建了 5 个后就结束了 |
| 优化 | Turn 4 prompt 应明确指定数量期望（"至少 10 个术后护理方案"），或拆分为两轮 |

### GAP-02: 知情同意书缺 3 个（5/8）

| 属性 | 值 |
|------|-----|
| 检查点 | E4 (consent-template ≥ 5) |
| 实际 | 5 个（IC-03, IC-04, IC-05, IC-07, IC-08） |
| 缺失 | IC-01(调Q激光), IC-02(双眼皮), IC-06(美容外科切痣/疤痕) |
| **归因** | **EXECUTION** |
| 理由 | compliance.md 列出全部 8 个 IC 编号和内容，Aida 创建了主力注射类但跳过了光电/手术类 |
| 优化 | 同 GAP-01，Turn 4 prompt 应明确"8 类知情同意书全部创建" |

### GAP-03: 产品目录偏注射类（8/~40 SKU）

| 属性 | 值 |
|------|-----|
| 检查点 | E8 (product-catalog ≥ 5) |
| 实际 | 8 个（全部为注射类：玻尿酸/胶原蛋白/嗨体/溶解酶） |
| 缺失 | 修丽可CE精华、医用护肤品、麻药耗材、光电耗材、美皮护（疤痕贴） |
| **归因** | **PREPROCESS** |
| 理由 | service-catalog.md 的产品章节以注射类为主（表格详细），非注射类产品散落在 compliance.md（美皮护、修丽可CE）中，没有统一的产品清单 |
| 优化 | 预处理增加 `产品完整清单` 章节，汇总全部 ~40 SKU（含零售、耗材、辅材） |

### GAP-04: Governance 运行时不生效

| 属性 | 值 |
|------|-----|
| 检查点 | G1-G7 (全部 PARTIAL) |
| 实际 | governance.yaml 磁盘存在（7 constraints），引擎 constraintCount=0 |
| **归因** | **ARCHITECTURE** |
| 理由 | Aida 通过 `write` 工具写入 governance.yaml；引擎仅在 `loadAidaProject()` 时加载。会话中途创建的文件不会被热加载 |
| 优化 | [引擎] 新增 `bps_reload_governance` tool 或在 governance.yaml 变更后自动重载 |

### GAP-05: Blueprint 编译部分失败

| 属性 | 值 |
|------|-----|
| 检查点 | P1 (blueprint exists) |
| 实际 | Blueprint 文件正确，但运行时 services 的 blueprintId=none |
| **归因** | **ARCHITECTURE** |
| 理由 | Aida 使用 `flow.rules` (when/then 格式) 而非 flow DSL (`A -> B`)，编译器对 rules 格式支持不完整 |
| 优化 | [引擎] 增强编译器对 flow.rules 格式的支持；[Workspace] TOOLS.md 增加 flow DSL 示例 |

### GAP-06: 两个 Blueprint 文件

| 属性 | 值 |
|------|-----|
| 检查点 | — (观察项) |
| 实际 | maor-patient-journey.yaml + maor患者就诊流程.yaml |
| **归因** | **EXECUTION** |
| 理由 | Aida 在 Turn 3 尝试了两次 blueprint 创建（可能第一次格式不对后重试用了不同文件名） |
| 优化 | 非关键，但 TOOLS.md 应强调 blueprint ID 的唯一性 |

### GAP-07: 随访计划单一实体承载 8 种治疗

| 属性 | 值 |
|------|-----|
| 检查点 | E6 (follow-up-schedule ≥ 1) |
| 实际 | 1 个综合实体（含 8 种治疗的随访时间表） |
| **归因** | — (非差距，设计选择) |
| 理由 | 测试计划要求 ≥1，Aida 选择用 1 个综合实体而非 8 个分散实体。数据结构合理（schedules 数组） |
| 优化 | 无需优化 |

### GAP-08: 治疗效果矩阵未建模

| 属性 | 值 |
|------|-----|
| 检查点 | — (超出测试计划，但属源物料内容) |
| 实际 | 未创建 |
| **归因** | **PREPROCESS** |
| 理由 | service-catalog.md 包含"治疗效果推荐矩阵"（21 方案×7 问题），但预处理仅以文本表格展示，未建议 Aida 将其建模为可查询实体 |
| 优化 | business-overview.md 的建模提示中增加 `treatment-effectiveness-matrix` 实体类型 |

### GAP-09: 患者模板未创建

| 属性 | 值 |
|------|-----|
| 检查点 | — (超出测试计划，但属源物料内容) |
| 实际 | 未创建 patient 实体或模板 |
| **归因** | **PREPROCESS** |
| 理由 | business-overview.md 建模提示中包含 `patient` Entity 类型，但对话脚本未明确要求创建患者模板，且预处理文档中患者数据以示例形式存在（不宜直接创建真实患者）。应建议创建 patient-intake-form 模板 |
| 优化 | 建模提示中将 `patient` 改为 `patient-intake-template`（表单模板，非真实患者数据） |

### GAP-10: 收费计算规则未形式化

| 属性 | 值 |
|------|-----|
| 检查点 | — (超出测试计划) |
| 实际 | 折扣不叠加规则仅在 governance 约束中，其它计费逻辑（疗程价、年卡扣费）未形式化 |
| **归因** | **PREPROCESS** |
| 理由 | service-catalog.md 的收费规则以描述性文本呈现，未建议建模为可计算的 billing-rule 实体 |
| 优化 | 增加 `billing-rules` 实体类型建议（疗程折扣表、年卡扣费规则、活动价规则） |

### GAP-11: Cron 任务仅 1 个

| 属性 | 值 |
|------|-----|
| 检查点 | Turn 5 期望 cron ≥ 1 |
| 实际 | 1 个（每日随访检查 9:00 AM） |
| **归因** | **EXECUTION** |
| 理由 | Turn 5 仅要求 1 个 cron，Aida 也仅创建 1 个。但诊所实际可受益于更多 cron（库存检查、设备维护提醒、月度报表） |
| 优化 | 非优先级，测试脚本可在后续轮次增加 cron 要求 |

### GAP-12: 无 Skill 创建

| 属性 | 值 |
|------|-----|
| 检查点 | — (超出测试计划) |
| 实际 | 0 Skills |
| **归因** | **EXECUTION** |
| 理由 | 对话脚本未要求创建 Skill，Aida 也未主动创建。合理——6 turns 重点在建模而非运营 |
| 优化 | 后续轮次可增加 Skill 创建测试（如"创建一个术后随访 Skill"） |

### GAP-13: Blueprint 格式不匹配

| 属性 | 值 |
|------|-----|
| 检查点 | P1 (blueprint) |
| 实际 | flow.rules 格式而非 flow DSL |
| **归因** | **COMPREHENSION** |
| 理由 | Aida 理解了流程内容，但选择了 when/then 规则格式而非预期的 flow DSL (`A -> B`) 格式，可能因 TOOLS.md 中 flow DSL 示例不够突出 |
| 优化 | TOOLS.md 增加 `bps_load_blueprint` 的明确 flow DSL 示例 |

### GAP-14: Governance 使用 write 而非 bps_load_blueprint

| 属性 | 值 |
|------|-----|
| 检查点 | D4 全部 |
| 实际 | Aida 用 `write` 工具直接写入 governance.yaml，而非通过 BPS 工具 |
| **归因** | **ARCHITECTURE** |
| 理由 | 目前没有 `bps_load_governance` 工具，Aida 唯一选择是文件写入 |
| 优化 | [引擎] 新增 `bps_load_governance` tool，实现运行时约束加载 |

---

## 归因分布分析

### 按归因分类

```
EXECUTION      ██████████████ 42.9% (6 items)
PREPROCESS     ████████      28.6% (4 items)
ARCHITECTURE   ██████        21.4% (3 items)
COMPREHENSION  ██            7.1%  (1 item)
```

### 解读

1. **EXECUTION 最大（42.9%）**：Aida 理解了业务内容但未完整执行。主要表现为 Turn 4 中术后护理和知情同意的创建不完整（5/12 和 5/8）。这主要是对话脚本的问题——每个 Turn 的工具调用量有上限，一次要求太多内容 Aida 无法全部完成。
   - **优化方向**：拆分 Turn（术后护理单独一轮），或在 prompt 中明确数量期望。

2. **PREPROCESS 第二（28.6%）**：预处理文档中缺少某些建模引导——产品清单不完整、治疗效果矩阵未建议建模、收费规则未形式化。
   - **优化方向**：补充 business-overview.md 的建模提示（增加实体类型建议），service-catalog.md 增加完整产品清单章节。

3. **ARCHITECTURE（21.4%）**：引擎不支持 governance 热加载、Blueprint 编译器对 rules 格式支持不足、缺少 `bps_load_governance` 工具。
   - **优化方向**：引擎侧改进（非预处理范围）。

4. **COMPREHENSION 最小（7.1%）**：仅 1 项——Blueprint 格式选择错误。预处理文档本身的信息传递基本无损。
   - **优化方向**：TOOLS.md 增加 flow DSL 示例即可。

### 收敛路径

当前 PREPROCESS 占比 28.6%（目标 < 20%）。需要消除至少 2 个 PREPROCESS 归因项：
- GAP-03（产品目录）→ 补充完整产品清单 → 可消除
- GAP-08（治疗效果矩阵）→ 增加建模提示 → 可消除
- GAP-09（患者模板）→ 调整建模建议 → 可消除
- GAP-10（收费规则）→ 增加 billing-rules 建议 → 可消除

若 Round 2 消除 GAP-03 和 GAP-08，PREPROCESS 降至 2/12 = 16.7% < 20% → **收敛**。

---

## Round 2 优化建议

### 预处理优化（PREPROCESS 归因消除）

1. **service-catalog.md 补充完整产品清单**
   - 新增"完整产品 SKU 清单"章节
   - 从 产品耗材库存表.xlsx 提取全部 ~40 SKU
   - 分类：注射类 / 光电耗材 / 零售护肤品 / 辅材

2. **business-overview.md 扩展建模提示**
   - 新增实体类型：`treatment-effectiveness-matrix`、`patient-intake-template`、`billing-rule`
   - 每个新增类型附带 1-2 行建模说明

3. **compliance.md 术后护理增加索引**
   - 在章节开头添加"完整清单"锚点表
   - 标注每种协议的优先级（主力项目 / 次要项目）

### 对话脚本优化（EXECUTION 归因缓解）

4. **Turn 4 拆分为两轮**
   - Turn 4a：知情同意模板（8 个，明确列表）
   - Turn 4b：术后护理方案（12 个，按优先级排序）

5. **Turn 量化期望**
   - 每个 Turn 的 prompt 增加"请创建至少 N 个"的明确数量指引

### 引擎优化（ARCHITECTURE 归因，独立于预处理迭代）

6. **新增 `bps_load_governance` tool** — 运行时加载/重载 governance.yaml
7. **Blueprint 编译器增强** — 支持 flow.rules 格式
8. **TOOLS.md 更新** — flow DSL 和 governance 写入的推荐路径

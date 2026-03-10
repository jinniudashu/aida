# MAOr 预处理 E2E Round 1 评估报告

> Run ID: `r1-kimi-k2.5` | 日期: 2026-03-10 | 模型: moonshot/kimi-k2.5 | 预处理版本: v0.1

## 综合评分

| # | 维度 | 权重 | 得分 | 加权分 |
|---|------|------|------|--------|
| D1 | 业务要素覆盖率 | 0.25 | 8.0 | 2.00 |
| D2 | 业务逻辑保真度 | 0.25 | 8.5 | 2.13 |
| D3 | 流程建模完整度 | 0.15 | 8.0 | 1.20 |
| D4 | 合规约束捕获率 | 0.15 | 7.0 | 1.05 |
| D5 | 可操作性 | 0.10 | 9.0 | 0.90 |
| D6 | 无幻觉 | 0.10 | 9.0 | 0.90 |
| **总分** | | **1.00** | | **8.18** |

### 收敛判据检查

- D1 + D2 加权分 = 2.00 + 2.13 = 4.13 (满分 5.0) → **等效 8.25/10 ≥ 7.5 ✓**
- PREPROCESS 归因占比 = 4/14 = 28.6% → **> 20% ✗**（见 gap-analysis.md）

**结论：D1+D2 达标，但 PREPROCESS 归因尚未收敛，需进一步优化预处理输出。**

---

## D1: 业务要素覆盖率 — 8.0/10

### 检查清单

| ID | 检查项 | 类型 | 阈值 | 实际 | 结果 |
|----|--------|------|------|------|------|
| E1 | treatment-item | HARD | ≥15 | 19 | **PASS** ✓ |
| E2 | service-package | HARD | ≥3 | 5 | **PASS** ✓ |
| E3 | membership-tier | HARD | ≥5 | 5 | **PASS** ✓ |
| E4 | consent-template | SOFT | ≥5 | 5 | **PASS** ✓ |
| E5 | post-care-protocol | SOFT | ≥8 | 5 | **FAIL** ✗ |
| E6 | follow-up-schedule | SOFT | ≥1 | 1 | **PASS** ✓ |
| E7 | role | SOFT | ≥3 | 4 | **PASS** ✓ |
| E8 | product-catalog | SOFT | ≥5 | 8 | **PASS** ✓ |

**HARD: 3/3 PASS | SOFT: 4/5 PASS (1 FAIL)**

### 详细分析

**treatment-item (19/15, PASS)**
覆盖全面，涵盖 7 大类：
- 光电类：光子嫩肤 IPL、调Q激光、CO2点阵激光
- 仪器类：黄金微针射频、超声炮 HIFU
- 化学类：果酸换肤
- 注射类：保妥适肉毒素、嗨体水光、乔雅登玻尿酸
- 手术类：切开/埋线双眼皮、双眼皮修复、下睑袋、植发、上睑下垂、内眦赘皮、腋臭、脂肪填充、射频溶脂

**post-care-protocol (5/8, FAIL)**
仅创建 5 个：光子嫩肤、黄金微针、水光注射、肉毒素、果酸换肤。
缺失 7 个：CO2点阵、调Q激光、超声炮、玻尿酸、双眼皮/眼袋、植发、体表手术通用。
预处理文档 compliance.md 包含完整的 16 类术后护理，Aida 只创建了 Turn 4 中的部分。

**consent-form (5/8, 达到阈值)**
创建 5 个：IC-03(IPL)、IC-04(水光)、IC-05(玻尿酸)、IC-07(肉毒素)、IC-08(超声)。
缺失 3 个：IC-01(调Q激光)、IC-02(双眼皮)、IC-06(美容外科)。

---

## D2: 业务逻辑保真度 — 8.5/10

### 检查清单

| ID | 数据点 | 正确值 | 实际值 | 结果 |
|----|--------|--------|--------|------|
| F1 | 3万年卡价格 | 30,000元 | price: 30000 | **PASS** ✓ |
| F2 | 3万年卡模式 | 六选三 | type: "六选三组合", maxSelections: 3 | **PASS** ✓ |
| F3 | 肉毒素100U单价 | 6,500元 | unitPrice: 6500 | **PASS** ✓ |
| F4 | 会员折扣不叠加 | 明确规则 | governance: no-double-discount (BLOCK) | **PASS** ✓ |
| F5 | 钻石三星充值 | 140万元 | rechargeMin: 1400000 | **PASS** ✓ |
| F6 | 钻石三星折扣 | 68% | discount: 0.68 | **PASS** ✓ |
| F7 | 超声炮全模式 | 20,800元 | upgradePrice.fullMode: 20800 | **PASS** ✓ |
| F8 | 年卡附带权益 | 其它项目8折 | otherProjectsDiscount: "8折" | **PASS** ✓ |

**HARD: 3/3 PASS | SOFT: 5/5 PASS**

### 详细分析

**8/8 全部通过**——所有关键量化数据完全正确。

特别值得注意的亮点：
- **会员体系建模精细**：5 个 membership 实体各含 3 星级，每星级完整记录 rechargeMin + discount。钻石三星的 limitedQuota: 20 也正确记录。
- **套餐结构复杂性正确处理**：3万年卡的"六选三"模式完整保留了 6 个选项（超声炮全模式/加强、黄金微针全面部、肉毒素或玻尿酸二选一、水光、附赠项目），还包含加价规则。
- **超声炮分层定价**：unitPrice(12800) 是基础价，fullMode(20800) 是全模式价，层级准确。
- **年卡附带权益**：otherProjectsDiscount="8折" + skincareDiscount="8折" + freeRegistration + freeVisia 等权益完整记录。

---

## D3: 流程建模完整度 — 8.0/10

### 检查清单

| ID | 检查项 | 类型 | 结果 | 说明 |
|----|--------|------|------|------|
| P1 | Blueprint 存在 | HARD | **PASS** ✓ | maor-patient-journey.yaml, 7 services |
| P2 | 预约→接待→面诊 | SOFT | **PASS** ✓ | flow.rules 正确链接 |
| P3 | 面诊→收费→治疗 | SOFT | **PASS** ✓ | flow.rules 正确链接 |
| P4 | 治疗→随访→新预约 | SOFT | **PASS** ✓ | flow.rules 正确链接 + 循环回预约 |
| P5 | 面诊含健康筛查 | SOFT | **PASS** ✓ | agentPrompt: "7维度皮肤评估" |
| P6 | 收费区分计费类型 | SOFT | **PASS** ✓ | agentPrompt: "确定计费类型，核对会员折扣，应用不折上折规则" |
| P7 | 随访周期因项目不同 | SOFT | **PASS** ✓ | follow-up-schedule 实体含 8 种治疗的具体时间点 |

**HARD: 1/1 PASS | SOFT: 6/6 PASS**

### 详细分析

**7/7 全部通过**——7 步患者旅程完整建模。

Blueprint 结构正确，7 个 service 涵盖完整患者旅程：
```
svc-appointment → svc-reception → svc-consultation → svc-billing → svc-treatment → svc-follow-up → svc-next-appointment
```

每个 service 的 agentPrompt 均包含具体操作指引（非空壳），如收费环节明确提到"不折上折规则"。

**扣分原因 (-2)**：
1. Blueprint 使用 `flow.rules` (when/then) 格式而非 flow DSL (`A -> B`)，导致编译器未完整识别——运行时 services 的 blueprintId=none
2. 产生了两个 blueprint 文件（`maor-patient-journey.yaml` + `maor患者就诊流程.yaml`），说明存在重试/格式探索
3. Blueprint health 报告为 "partial"

---

## D4: 合规约束捕获率 — 7.0/10

### 检查清单

| ID | 约束 | 类型 | 文件中 | 运行时 | 结果 |
|----|------|------|--------|--------|------|
| G1 | 知情同意书签署 | REQUIRE_APPROVAL | ✓ | ✗ | **PARTIAL** ⚠ |
| G2 | 肉毒素2月≤200U | BLOCK | ✓ | ✗ | **PARTIAL** ⚠ |
| G3 | 光子间隔≥3周 | BLOCK | ✓ | ✗ | **PARTIAL** ⚠ |
| G4 | 折扣不叠加 | BLOCK | ✓ | ✗ | **PARTIAL** ⚠ |
| G5 | 禁忌症阻断 | BLOCK | ✓ | ✗ | **PARTIAL** ⚠ |
| G6 | 三星钻石限20名 | BLOCK | ✓ | ✗ | **PARTIAL** ⚠ |
| G7 | 麻药面积≤2000cm² | BLOCK | ✓ | ✗ | **PARTIAL** ⚠ |

**HARD: 1/1 PARTIAL | SOFT: 6/6 PARTIAL**

### 详细分析

**governance.yaml 内容：完美 (10/10)** —— 7 个约束全部命中，还额外创建了 2 个审批策略（高风险治疗审批、会员升级审批）。约束的 action/severity/condition/message 均结构化正确。

**运行时生效：零 (0/10)** —— constraintCount=0。governance.yaml 是 Aida 通过 `write` 工具直接写入文件系统的，但引擎仅在 `loadAidaProject()` 时加载 governance.yaml。Aida 在会话中途创建文件，引擎不会热加载。

**综合评分 7.0**：约束识别和定义质量满分，但因运行时不生效打折。这是一个已知的架构限制（非预处理问题，也非 Aida 理解问题）。

---

## D5: 可操作性 — 9.0/10

### 检查清单

| ID | 查询 | 期望回答 | 实际回答 | 结果 |
|----|------|----------|----------|------|
| U1 | 光子嫩肤价格 | 1,500/次 或 买4送1 | ✓ 正确回答 1500/次 + 疗程优惠 | **PASS** ✓ |
| U2 | 3万年卡包含什么 | 六选三内容 | ✓ 正确列出 6 个选项 | **PASS** ✓ |
| U3 | 肉毒素术后注意 | 不按摩/不饮酒/起效时间 | ✓ 从实体数据准确回答 | **PASS** ✓ |
| U4 | 新患者到店流程 | 7步或其子集 | ✓ 完整 7 步流程 | **PASS** ✓ |

**4/4 PASS**

Turn 6 的 4 个验证查询全部正确回答，且信息来源于已创建的 Entity（非直接读取 context/ 文件）。这证明建模产出具备实际可操作性。

**扣分原因 (-1)**：部分实体结构（如 post-care-protocol）仅覆盖主力项目，如果查询冷门项目（如"植发术后注意什么"），可能无法回答。

---

## D6: 无幻觉 — 9.0/10

### 检查清单

| ID | 检查 | 结果 | 说明 |
|----|------|------|------|
| H1 | 无虚构治疗项目 | **PASS** ✓ | 19 个 treatment-item 全部可追溯到源物料 |
| H2 | 无虚构价格 | **PASS** ✓ | 抽检 6 个价格点全部准确 |
| H3 | 无虚构流程步骤 | **PASS** ✓ | 7 步流程与源物料完全一致 |

**3/3 PASS**

逐项验证：
- **治疗项目**：19 项全部存在于 service-catalog.md 列出的 ~50 项中，无虚构
- **价格**：肉毒素6500✓, 光子1500✓, 超声炮基础12800/全模式20800✓, 3万年卡30000✓, 2万年卡20000✓
- **会员折扣**：VIP 98%→钻石三星 68%，与源物料完全一致
- **流程**：7步旅程与 clinical-workflow.md 完全对应

**扣分原因 (-1)**：未发现明确幻觉，但部分实体数据的具体字段值无法完全逆向验证（如产品规格"1支/盒"等），保守打分。

---

## 检查点汇总

| 类型 | 总计 | PASS | FAIL | PARTIAL |
|------|------|------|------|---------|
| HARD | 8 | 7 | 0 | 1 |
| SOFT | 29 | 23 | 1 | 5 |
| **合计** | **37** | **30** | **1** | **6** |

HARD 通过率：87.5% (7/8)
SOFT 通过率：79.3% (23/29)
总通过率（含 PARTIAL 算半分）：89.2%

---

## 关键发现

### 亮点

1. **量化数据零误差**：8/8 关键数据点完全正确（D2 满分），说明预处理文档的数字信息传递无损
2. **Entity 结构化质量高**：membership 实体含完整 3 星级×5 等级，每级有 rechargeMin/discount/upgradeRule
3. **治疗项目覆盖超预期**：19 项 treatment-item（阈值 15），涵盖全部 7 大类
4. **流程建模完整**：7 步旅程 + agentPrompt 均含业务细节（非空壳），flow 顺序正确
5. **治理约束全面**：7/7 约束 + 2 额外审批策略，语义正确

### 问题

1. **术后护理覆盖不足**（D1-E5）：仅 5/12 种 post-care-protocol，缺失手术类（双眼皮/植发/体表）和部分光电类（CO2/调Q/超声炮）
2. **Governance 运行时不生效**（D4）：governance.yaml 写入磁盘但引擎未热加载，constraintCount=0
3. **Blueprint 编译部分失败**（D3）：flow.rules 格式 vs flow DSL，导致 blueprintId=none
4. **知情同意书缺 3 个**（D1-E4）：IC-01/02/06 未创建
5. **产品目录仅注射类**（D1-E8）：8 个均为注射类产品，缺少光电耗材和零售护肤品

---

## 与收敛判据的距离

| 判据 | 目标 | 当前 | 差距 |
|------|------|------|------|
| D1+D2 加权分 | ≥ 7.5/10 | 8.25/10 | **已达标** ✓ |
| PREPROCESS 归因占比 | < 20% | 28.6% | 需降低 8.6 个百分点 |

详见 `gap-analysis.md` 了解每个缺失要素的归因和优化建议。

# MAOr 预处理 E2E Round 1 — 覆盖率报告

> Run ID: `r1-kimi-k2.5` | 日期: 2026-03-10

## 源物料 → 预处理 → AIDA 产出 三级覆盖追踪

图例：✅ 完整覆盖 | ⚠️ 部分覆盖 | ❌ 未覆盖

---

## 1. 治疗项目（treatment-item）

| 源物料项目 | 预处理文档 | AIDA Entity | 价格正确 |
|-----------|-----------|-------------|----------|
| 光子嫩肤 IPL | ✅ service-catalog | ✅ 已创建 | ✅ 1500元 |
| 调Q激光 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| CO2点阵激光 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 黄金微针射频 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 超声炮 HIFU | ✅ service-catalog | ✅ 已创建 | ✅ 12800/20800 |
| 果酸换肤 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 保妥适肉毒素 100U | ✅ service-catalog | ✅ 已创建 | ✅ 6500元 |
| 嗨体水光注射 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 乔雅登极致玻尿酸 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 切开双眼皮 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 埋线双眼皮 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 双眼皮修复 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 下睑袋手术 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 植发手术 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 上睑下垂矫正 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 内眦赘皮矫正 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 腋臭手术 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 自体脂肪填充 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 射频溶脂 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 纳晶导入 | ✅ service-catalog | ❌ 未创建 | — |
| 瑞蓝唯缇水光 | ✅ service-catalog | ❌ 未创建 | — |
| 切痣 | ✅ service-catalog | ❌ 未创建 | — |
| 疤痕修复 | ✅ service-catalog | ❌ 未创建 | — |
| 祛斑综合 | ✅ service-catalog | ❌ 未创建 | — |

**覆盖率：19/~50 (38%)，主力项目 19/24 (79%)**

---

## 2. 服务套餐（service-package）

| 源物料项目 | 预处理文档 | AIDA Entity | 数据正确 |
|-----------|-----------|-------------|----------|
| 3万年卡（面部年度管理） | ✅ service-catalog | ✅ 已创建 | ✅ 价格/六选三/附带权益 |
| 2万年卡（面部色素疗程） | ✅ service-catalog | ✅ 已创建 | ✅ 价格/5项×5次/单次4500 |
| 肉毒素100U年度疗程 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 乔雅登极致年度疗程 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |
| 嗨体水光年度疗程 | ✅ service-catalog | ✅ 已创建 | ⚠️ 未验证 |

**覆盖率：5/5 (100%)**

---

## 3. 会员等级（membership）

| 源物料项目 | 预处理文档 | AIDA Entity | 数据正确 |
|-----------|-----------|-------------|----------|
| VIP (1级) | ✅ service-catalog | ✅ 3星完整 | ✅ 10000/98%→18800/94% |
| 银卡 (2级) | ✅ service-catalog | ✅ 3星完整 | ✅ 20000/92%→40000/88% |
| 金卡 (3级) | ✅ service-catalog | ✅ 3星完整 | ✅ 60000/86%→100000/82% |
| 白金卡 (4级) | ✅ service-catalog | ✅ 3星完整 | ✅ 150000/80%→300000/76% |
| 钻石卡 (5级) | ✅ service-catalog | ✅ 3星完整 | ✅ 500000/74%→1400000/68% |

**覆盖率：5/5 (100%)，含全部 15 档（5级×3星）**

---

## 4. 知情同意书（consent-form）

| 源物料项目 | 预处理文档 | AIDA Entity | 关键内容 |
|-----------|-----------|-------------|----------|
| IC-01 调Q激光 | ✅ compliance | ❌ 未创建 | — |
| IC-02 双眼皮手术 | ✅ compliance | ❌ 未创建 | — |
| IC-03 IPL强脉冲光 | ✅ compliance | ✅ 已创建 | ✅ 含适应症/禁忌/风险 |
| IC-04 水光注射 | ✅ compliance | ✅ 已创建 | ✅ 含适应症/禁忌/风险 |
| IC-05 玻尿酸填充 | ✅ compliance | ✅ 已创建 | ✅ 含适应症/禁忌/风险 |
| IC-06 美容外科 | ✅ compliance | ❌ 未创建 | — |
| IC-07 肉毒素注射 | ✅ compliance | ✅ 已创建 | ✅ 含适应症/禁忌/风险 |
| IC-08 超声理疗 | ✅ compliance | ✅ 已创建 | ✅ 含适应症/禁忌/风险 |

**覆盖率：5/8 (62.5%)**
缺失的 3 个全在预处理文档中有详细记录 → EXECUTION 归因

---

## 5. 术后护理方案（post-care-protocol）

| 源物料项目 | 预处理文档 | AIDA Entity |
|-----------|-----------|-------------|
| 光子嫩肤 IPL | ✅ compliance | ✅ 已创建 |
| 调Q激光 | ✅ compliance | ❌ 未创建 |
| CO2点阵激光 | ✅ compliance | ❌ 未创建 |
| 黄金微针射频 | ✅ compliance | ✅ 已创建 |
| 超声炮 HIFU | ✅ compliance | ❌ 未创建 |
| 水光注射 | ✅ compliance | ✅ 已创建 |
| 玻尿酸填充 | ✅ compliance | ❌ 未创建 |
| 肉毒素注射 | ✅ compliance | ✅ 已创建 |
| 果酸换肤 | ✅ compliance | ✅ 已创建 |
| 体表手术通用 | ✅ compliance | ❌ 未创建 |
| 双眼皮 | ✅ compliance | ❌ 未创建 |
| 眼袋 | ✅ compliance | ❌ 未创建 |
| 植发 | ✅ compliance | ❌ 未创建 |
| 脂肪填充 | ✅ compliance | ❌ 未创建 |
| 美皮护使用 | ✅ compliance | ❌ 未创建 |
| 修丽可CE使用 | ✅ compliance | ❌ 未创建 |

**覆盖率：5/16 (31.3%)，主力项目 5/12 (41.7%)**
全部缺失项在预处理文档中有完整记录 → EXECUTION 归因

---

## 6. 产品目录（product-inventory）

| 源物料项目 | 预处理文档 | AIDA Entity |
|-----------|-----------|-------------|
| 保妥适 100U | ✅ service-catalog | ⚠️ 作为 treatment-item |
| 乐提葆 100U | ✅ service-catalog | ❌ 未创建 |
| 吉适 100U | ✅ service-catalog | ❌ 未创建 |
| 乔雅登极致 | ✅ service-catalog | ❌ 未创建（但有 treatment） |
| 瑞蓝丽瑅 | ✅ service-catalog | ✅ 已创建 |
| 瑞蓝唯缇 | ✅ service-catalog | ✅ 已创建 |
| 嗨体颈纹 | ✅ service-catalog | ✅ 已创建 |
| 嗨体熊猫针 | ✅ service-catalog | ✅ 已创建 |
| 双美胶原蛋白 | ✅ service-catalog | ✅ 已创建 |
| 薇旖美胶原蛋白 | ✅ service-catalog | ✅ 已创建 |
| 爱维岚 | ✅ service-catalog | ✅ 已创建 |
| 溶解酶 | ✅ service-catalog | ✅ 已创建 |
| 修丽可CE精华 | ⚠️ compliance | ❌ 未创建 |
| 美皮护疤痕贴 | ⚠️ compliance | ❌ 未创建 |
| 利多卡因乳膏 | ⚠️ compliance | ❌ 未创建 |

**覆盖率：8/~40 (20%)，注射类 8/12 (67%)**

---

## 7. 组织角色（staff-role）

| 源物料项目 | 预处理文档 | AIDA Entity |
|-----------|-----------|-------------|
| 主诊医生 | ✅ business-overview | ✅ 已创建 |
| 护士 | ✅ business-overview | ✅ 已创建 |
| 客服 | ✅ business-overview | ✅ 已创建 |
| 设备工程师 | ✅ business-overview | ✅ 已创建 |

**覆盖率：4/4 (100%)**

---

## 8. 治理约束（governance constraints）

| 源物料约束 | 预处理文档 | governance.yaml | 运行时 |
|-----------|-----------|----------------|--------|
| 知情同意必签 | ✅ compliance | ✅ consent-required | ❌ 未加载 |
| 肉毒素2月≤200U | ✅ compliance | ✅ botox-max-dose | ❌ 未加载 |
| 光子间隔≥3周 | ✅ compliance | ✅ ipl-min-interval | ❌ 未加载 |
| 折扣不叠加 | ✅ service-catalog | ✅ no-double-discount | ❌ 未加载 |
| 禁忌症阻断 | ✅ compliance | ✅ contraindication-block | ❌ 未加载 |
| 三星钻石限20名 | ✅ service-catalog | ✅ diamond-3star-limit | ❌ 未加载 |
| 麻药面积≤2000cm² | ✅ compliance | ✅ topical-anesthesia-area | ❌ 未加载 |

**文件覆盖率：7/7 (100%) | 运行时生效率：0/7 (0%)**

---

## 9. 流程建模（Blueprint services）

| 源物料环节 | 预处理文档 | Blueprint Service | agentPrompt |
|-----------|-----------|-------------------|-------------|
| 预约 | ✅ clinical-workflow | ✅ svc-appointment | ✅ 含具体操作 |
| 接待 | ✅ clinical-workflow | ✅ svc-reception | ✅ 含具体操作 |
| 面诊 | ✅ clinical-workflow | ✅ svc-consultation | ✅ 含7维度评估 |
| 收费 | ✅ clinical-workflow | ✅ svc-billing | ✅ 含不折上折 |
| 治疗 | ✅ clinical-workflow | ✅ svc-treatment | ✅ 含参数记录 |
| 随访 | ✅ clinical-workflow | ✅ svc-follow-up | ✅ 含时间点 |
| 新预约 | ✅ clinical-workflow | ✅ svc-next-appointment | ✅ 含间隔检查 |

**覆盖率：7/7 (100%)**

---

## 10. 随访计划（follow-up-schedule）

| 源物料治疗 | 预处理文档 | AIDA 实体中 |
|-----------|-----------|-------------|
| 水光 Day2/7/Week3 | ✅ clinical-workflow | ✅ 已记录 |
| 黄金微针 Day2/7/Month3 | ✅ clinical-workflow | ✅ 已记录 |
| 肉毒-除皱 Day2/7/Month3-6 | ✅ clinical-workflow | ✅ 已记录 |
| 肉毒-咬肌 Day2/7/Month3-6 | ✅ clinical-workflow | ✅ 已记录 |
| 果酸 Day2/7/Week3 | ✅ clinical-workflow | ✅ 已记录 |
| 玻尿酸 Day2/Month3/6 | ✅ clinical-workflow | ✅ 已记录 |
| 光子 Day2/7/Week3/Month3-6 | ✅ clinical-workflow | ✅ 已记录 |
| 双眼皮 Day3/7 | ✅ clinical-workflow | ✅ 已记录 |

**覆盖率：8/8 (100%)**

---

## 覆盖率汇总

| 业务域 | 源物料总量 | 预处理覆盖 | AIDA 产出 | 端到端率 |
|--------|-----------|-----------|-----------|---------|
| 治疗项目 | ~50 | ~50 | 19 | 38% |
| 服务套餐 | 5 | 5 | 5 | **100%** |
| 会员等级 | 5×3=15 | 15 | 5×3=15 | **100%** |
| 知情同意书 | 8 | 8 | 5 | 62.5% |
| 术后护理 | ~16 | 16 | 5 | 31.3% |
| 产品目录 | ~40 | ~15 | 8 | 20% |
| 组织角色 | 4 | 4 | 4 | **100%** |
| 治理约束 | 8 | 8 | 7 (文件) | 87.5% (文件) |
| 流程环节 | 7 | 7 | 7 | **100%** |
| 随访计划 | 8 | 8 | 8 | **100%** |

### 管线瓶颈分析

| 瓶颈位置 | 受影响业务域 | 信息丢失量 |
|----------|-------------|-----------|
| 源物料→预处理 | 产品目录（40→15） | 25 SKU 未提取 |
| 预处理→AIDA | 术后护理（16→5）、知情同意（8→5）、治疗项目（50→19） | 34 项未转化 |
| AIDA→运行时 | 治理约束（7→0 加载） | 7 约束未生效 |

**主要信息丢失发生在 "预处理→AIDA" 环节**（EXECUTION 归因），次要丢失在 "源物料→预处理"（PREPROCESS 归因，产品清单不完整）。

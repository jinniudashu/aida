/**
 * Business Scenario Simulation
 *
 * Simulates Aida processing a real business requirement through all three
 * frequency modes. Run once against the shared database to populate Dashboard.
 *
 * Usage: node --import tsx dashboard/server/simulate.ts
 * (run from packages/bps-engine/)
 *
 * Scenario: "晨光咖啡三店标准化运营" (Morning Brew 3-Store Standardization)
 *
 * The business owner says:
 *   "我有3家咖啡店，想让Aida帮我：
 *    1. 推进第4家新店开业筹备
 *    2. 每周一做库存盘点，每天查看营收
 *    3. 大额采购超过5000元需要我审批
 *    4. 统一3家店的运营SOP"
 *
 * Aida's response covers all three operating frequencies:
 *   Freq 1 (Event-driven): New store opening pipeline — task → trigger → downstream
 *   Freq 2 (Heartbeat):    Progress scanning, failure triage, pattern reflection
 *   Freq 3 (Cron):         Weekly inventory, daily revenue check, monthly review
 */
import path from 'node:path'
import { createBpsEngine, createDatabase, loadBlueprintFromYaml, ManagementStore } from '../../src/index.js'
import type { BpsEngine } from '../../src/index.js'

const DB_PATH = process.env.BPS_DB_PATH || path.resolve(process.env.HOME || '/root', '.aida', 'data', 'bps.db')
const BP_DIR = process.env.BPS_BLUEPRINTS_DIR || path.resolve(import.meta.dirname, '..', 'blueprints')

console.log(`[simulate] Using database: ${DB_PATH}`)
const db = createDatabase(DB_PATH)
const engine: BpsEngine = createBpsEngine({ db })

// Load blueprints
import fs from 'node:fs'
if (fs.existsSync(BP_DIR)) {
  for (const file of fs.readdirSync(BP_DIR).filter(f => f.endsWith('.yaml'))) {
    loadBlueprintFromYaml(path.join(BP_DIR, file), engine.blueprintStore)
  }
}

const { tracker, dossierStore, processStore } = engine
const now = new Date()
const h = (hours: number) => new Date(now.getTime() + hours * 3600_000).toISOString()

// --- Operators ---
const insertOp = db.prepare(`
  INSERT OR IGNORE INTO bps_operators (id, label, name, status, active, role_ids, created_at, updated_at)
  VALUES (?, ?, ?, 'active', 1, '[]', ?, ?)
`)
const opNow = now.toISOString()
insertOp.run('op-aida', 'Aida', 'aida', opNow, opNow)
insertOp.run('op-owner', '老板 (Owner)', 'owner', opNow, opNow)

// ═══════════════════════════════════════════════════════
// PHASE 1: Aida Creates the Action Plan (Business Goals)
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 1: Creating action plans...')

const plan1 = dossierStore.getOrCreate('action-plan', 'plan-morning-brew-q1')
dossierStore.commit(plan1.id, {
  name: '晨光咖啡 Q1 运营目标',
  description: '推进第4家新店开业，统一3家现有门店运营标准，建立日常运营自动化',
  items: [
    { name: '第4家新店（望京店）开业筹备', status: 'in-progress', dueDate: '2026-04-15', priority: 'high' },
    { name: '3家现有店 SOP 标准化文档', status: 'in-progress', dueDate: '2026-03-31', priority: 'high' },
    { name: '供应商合同续签谈判', status: 'pending', dueDate: '2026-03-20', priority: 'medium' },
    { name: '员工季度培训计划', status: 'done', dueDate: '2026-03-10', priority: 'medium' },
    { name: '会员系统上线', status: 'pending', dueDate: '2026-04-30', priority: 'low' },
  ],
  periodicItems: [
    { name: '每周库存盘点', cron: '0 9 * * MON', lastRun: h(-7 * 24) },
    { name: '每日营收数据汇总', cron: '0 22 * * *', lastRun: h(-24) },
    { name: '月度运营复盘', cron: '0 10 1 * *', lastRun: h(-30 * 24) },
  ],
}, { committedBy: 'aida', message: 'Action plan created from business requirement' })

const plan2 = dossierStore.getOrCreate('action-plan', 'plan-daily-ops')
dossierStore.commit(plan2.id, {
  name: '日常运营自动化',
  description: 'Aida 自动执行的常规运营任务',
  items: [],
  periodicItems: [
    { name: '库存低量预警检查', cron: '0 8 * * *', lastRun: h(-12) },
    { name: '外卖平台评价回复', cron: '0 10,16 * * *', lastRun: h(-6) },
    { name: '设备维护提醒', cron: '0 9 * * FRI', lastRun: h(-5 * 24) },
    { name: '排班自动生成（下周）', cron: '0 14 * * THU', lastRun: h(-3 * 24) },
  ],
}, { committedBy: 'aida', message: 'Daily ops automation plan' })

// ═══════════════════════════════════════════════════════
// PHASE 2: Event-Driven Flow (Freq 1) — New Store Pipeline
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 2: Event-driven task chain (new store opening)...')

// Simulate the new store opening pipeline:
// site-survey → design-plan → licensing → hiring → opening-prep
// Each completion triggers the next (event-driven)

// Store entity
const store4 = dossierStore.getOrCreate('store', 'store-wangjing')
dossierStore.commit(store4.id, {
  name: '晨光咖啡·望京店',
  address: '北京市朝阳区望京SOHO T1-1F-08',
  city: '北京',
  district: '朝阳区',
  status: 'preparing',
  targetOpenDate: '2026-04-15',
}, { committedBy: 'aida', message: 'New store entity created' })

// Task 1: Site Survey — COMPLETED (5 days ago)
const t1 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'store', entityId: 'store-wangjing',
  operatorId: 'op-aida', metadata: { _taskLabel: '选址实地考察', _frequency: 'event' },
})
tracker.updateTask(t1.id, { state: 'IN_PROGRESS' })
tracker.completeTask(t1.id, { summary: '望京SOHO T1 一楼，人流量日均1.2万，租金合理' })
processStore.saveContextSnapshot(t1.id, { _reason: '实地考察完成，数据采集正常，推荐该位置' })

// Task 2: Design Plan — COMPLETED (3 days ago, triggered by task 1)
const t2 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'store', entityId: 'store-wangjing',
  operatorId: 'op-aida', metadata: { _taskLabel: '装修设计方案', _frequency: 'event', _triggeredBy: t1.id },
})
tracker.updateTask(t2.id, { state: 'IN_PROGRESS' })
tracker.completeTask(t2.id, { summary: '设计方案V2已确认，预算18万' })
processStore.saveContextSnapshot(t2.id, { _reason: '设计方案经老板确认，进入执照办理阶段' })

// Task 3: Licensing — IN_PROGRESS (triggered by task 2)
const t3 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'store', entityId: 'store-wangjing',
  operatorId: 'op-aida', metadata: { _taskLabel: '营业执照+食品经营许可', _frequency: 'event', _triggeredBy: t2.id },
})
tracker.updateTask(t3.id, { state: 'IN_PROGRESS' })
processStore.saveContextSnapshot(t3.id, { _reason: '已提交工商局申请，预计5个工作日出证' })

// Task 4: Hiring — IN_PROGRESS (parallel with licensing)
const t4 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'store', entityId: 'store-wangjing',
  operatorId: 'op-aida', metadata: { _taskLabel: '招聘店员+店长', _frequency: 'event', _triggeredBy: t2.id },
})
tracker.updateTask(t4.id, { state: 'IN_PROGRESS' })
processStore.saveContextSnapshot(t4.id, { _reason: '已收到12份简历，3人通过初筛，安排明天面试' })

// Task 5: Opening Prep — OPEN (blocked on licensing + hiring)
const t5 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'store', entityId: 'store-wangjing',
  operatorId: 'op-aida', metadata: { _taskLabel: '开业准备', _frequency: 'event' },
})

// ═══════════════════════════════════════════════════════
// PHASE 3: Cron-Driven (Freq 3) — Periodic Operations
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 3: Cron-driven periodic tasks...')

// Weekly inventory check — last 3 executions
for (let week = 3; week >= 1; week--) {
  for (const storeId of ['store-001', 'store-002', 'store-003']) {
    const t = tracker.createTask({
      serviceId: 'svc-order-pipeline', entityType: 'store', entityId: storeId,
      operatorId: 'op-aida', metadata: { _taskLabel: `库存盘点 W${4 - week}`, _frequency: 'cron' },
    })
    tracker.updateTask(t.id, { state: 'IN_PROGRESS' })
    tracker.completeTask(t.id, { summary: `${storeId} 库存盘点完成` })
    processStore.saveContextSnapshot(t.id, { _reason: `每周一例行库存盘点（第${4 - week}周）` })
  }
}

// Daily revenue — recent 3 days
for (let day = 3; day >= 1; day--) {
  const t = tracker.createTask({
    serviceId: 'svc-order-pipeline', entityType: 'action-plan', entityId: 'plan-daily-ops',
    operatorId: 'op-aida', metadata: { _taskLabel: `营收汇总 D-${day}`, _frequency: 'cron' },
  })
  tracker.updateTask(t.id, { state: 'IN_PROGRESS' })
  tracker.completeTask(t.id, {
    summary: `3店日营收：店1 ¥${3200 + Math.floor(Math.random() * 800)}, 店2 ¥${2800 + Math.floor(Math.random() * 600)}, 店3 ¥${3500 + Math.floor(Math.random() * 1000)}`,
  })
  processStore.saveContextSnapshot(t.id, { _reason: '每日22:00 cron 触发营收数据自动汇总' })
}

// SOP standardization tasks — mixed states
const sopT1 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'action-plan', entityId: 'plan-morning-brew-q1',
  operatorId: 'op-aida', metadata: { _taskLabel: 'SOP: 开店流程标准化', _frequency: 'cron' },
})
tracker.updateTask(sopT1.id, { state: 'IN_PROGRESS' })
tracker.completeTask(sopT1.id, { summary: '开店流程SOP v1.0 已生成并同步至3家门店' })
processStore.saveContextSnapshot(sopT1.id, { _reason: '开店流程标准化完成，包含14个检查项' })

const sopT2 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'action-plan', entityId: 'plan-morning-brew-q1',
  operatorId: 'op-aida', metadata: { _taskLabel: 'SOP: 饮品制作标准', _frequency: 'cron' },
})
tracker.updateTask(sopT2.id, { state: 'IN_PROGRESS' })
processStore.saveContextSnapshot(sopT2.id, { _reason: '正在整理3家店的饮品制作差异，统一出品标准' })

const sopT3 = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'action-plan', entityId: 'plan-morning-brew-q1',
  operatorId: 'op-aida', metadata: { _taskLabel: 'SOP: 食材验收标准', _frequency: 'cron' },
})

// ═══════════════════════════════════════════════════════
// PHASE 4: Heartbeat (Freq 2) — Failure Triage + Scan
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 4: Heartbeat — failure detection & scan...')

// A failed task discovered during heartbeat scan
const failedT = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'store', entityId: 'store-002',
  operatorId: 'op-aida', metadata: { _taskLabel: '外卖平台数据同步', _frequency: 'cron' },
})
tracker.updateTask(failedT.id, { state: 'IN_PROGRESS' })
tracker.failTask(failedT.id, '美团API返回429 Too Many Requests，限流中')
processStore.saveContextSnapshot(failedT.id, { _reason: 'Heartbeat 发现失败任务，已记录，等待限流解除后重试' })

// A blocked task found during heartbeat
const blockedT = tracker.createTask({
  serviceId: 'svc-order-pipeline', entityType: 'store', entityId: 'store-wangjing',
  operatorId: 'op-aida', metadata: { _taskLabel: '消防验收预约', _frequency: 'event' },
})
tracker.updateTask(blockedT.id, { state: 'IN_PROGRESS' })
tracker.updateTask(blockedT.id, { state: 'BLOCKED' })
processStore.saveContextSnapshot(blockedT.id, { _reason: 'Heartbeat 发现阻塞：消防队排期已满，最早3月15日，已通知老板' })

// ═══════════════════════════════════════════════════════
// PHASE 5: Approvals (Human-in-the-Loop)
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 5: Creating approval requests...')

const appr1 = dossierStore.getOrCreate('approval', 'appr-equip-purchase')
dossierStore.commit(appr1.id, {
  status: 'pending',
  question: '望京新店设备采购：La Marzocca咖啡机+磨豆机套装 ¥68,000，是否批准？',
  context: {
    storeId: 'store-wangjing',
    storeName: '晨光咖啡·望京店',
    vendor: '意大利进口直营',
    amount: 68000,
    budgetRemaining: 120000,
    alternatives: 'Breville套装 ¥32,000（国产替代）',
    recommendation: '推荐La Marzocca，品质一致性更高，3家店均使用同款',
  },
  serviceId: 'svc-order-pipeline',
  taskId: t3.id,
  requestedBy: 'aida',
  requestedAt: h(-2),
}, { committedBy: 'aida', message: '设备采购审批请求' })

const appr2 = dossierStore.getOrCreate('approval', 'appr-lease-renewal')
dossierStore.commit(appr2.id, {
  status: 'pending',
  question: '国贸店（store-001）租约续签：年租金从38万涨至42万（+10.5%），是否同意续签？',
  context: {
    storeId: 'store-001',
    storeName: '晨光咖啡·国贸店',
    currentRent: 380000,
    newRent: 420000,
    increaseRate: '10.5%',
    leaseExpiry: '2026-04-30',
    monthlyRevenue: '¥96,000 (avg)',
    recommendation: '建议续签，国贸店利润率22%，搬迁成本约15万+3个月过渡期损失',
  },
  serviceId: 'svc-order-pipeline',
  requestedBy: 'aida',
  requestedAt: h(-8),
}, { committedBy: 'aida', message: '租约续签审批请求' })

const appr3 = dossierStore.getOrCreate('approval', 'appr-marketing-budget')
dossierStore.commit(appr3.id, {
  status: 'pending',
  question: '望京店开业营销方案：预算¥15,000（含开业折扣券+大众点评推广+周边传单），是否批准？',
  context: {
    storeId: 'store-wangjing',
    storeName: '晨光咖啡·望京店',
    totalBudget: 15000,
    breakdown: { coupons: 5000, dianping: 6000, flyers: 2000, misc: 2000 },
    expectedReturn: '预计开业首月增加客流1200人次，回本周期约2周',
    recommendation: '预算合理，建议批准',
  },
  serviceId: 'svc-order-pipeline',
  requestedBy: 'aida',
  requestedAt: h(-1),
}, { committedBy: 'aida', message: '开业营销预算审批' })

// One already-decided approval (showing closed loop)
const appr4 = dossierStore.getOrCreate('approval', 'appr-supplier-switch')
dossierStore.commit(appr4.id, {
  status: 'approved',
  question: '牛奶供应商从A切换到B（成本降低8%，品质测试通过），是否批准？',
  context: {
    currentSupplier: '供应商A（蒙牛）',
    newSupplier: '供应商B（光明）',
    costReduction: '8%',
    qualityTest: 'passed',
  },
  serviceId: 'svc-order-pipeline',
  requestedBy: 'aida',
  requestedAt: h(-48),
  decidedBy: 'owner',
  decidedAt: h(-46),
  decision: 'approved',
  decisionReason: '同意切换，下周一开始执行',
}, { committedBy: 'owner', message: '供应商切换已批准' })

// ═══════════════════════════════════════════════════════
// PHASE 6: Dynamic Skill Creation (D1)
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 6: Dynamic skill creation record...')

// Record that Aida recognized a pattern and created a skill
const skillDossier = dossierStore.getOrCreate('skill-creation', 'skill-store-inventory-check')
dossierStore.commit(skillDossier.id, {
  skillName: 'store-inventory-check',
  status: 'created',
  triggerPattern: 'Aida 执行了 3 周库存盘点，识别出重复模式',
  examples: ['W1 三店库存盘点', 'W2 三店库存盘点', 'W3 三店库存盘点'],
  createdAt: h(-24),
}, { committedBy: 'aida', message: 'Skill crystallized from repetitive inventory check pattern' })

// ═══════════════════════════════════════════════════════
// PHASE 7: Stagger timestamps for realistic timeline
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 7: Adjusting timestamps...')

const updateTime = db.prepare(`UPDATE bps_processes SET start_time = ?, end_time = ? WHERE id = ?`)
const offsets: Array<{ id: string; startH: number; durationH: number | null }> = [
  // Event-driven chain (new store)
  { id: t1.id, startH: -120, durationH: 8 },   // site survey: 5 days ago, took 8h
  { id: t2.id, startH: -72, durationH: 16 },    // design: 3 days ago, took 16h
  { id: t3.id, startH: -36, durationH: null },   // licensing: 1.5 days ago, ongoing
  { id: t4.id, startH: -48, durationH: null },   // hiring: 2 days ago, ongoing
  { id: t5.id, startH: -1, durationH: null },    // opening prep: just created, waiting
  // Heartbeat findings
  { id: failedT.id, startH: -6, durationH: 0.5 },   // failed 6h ago
  { id: blockedT.id, startH: -24, durationH: null },  // blocked since yesterday
  // SOP tasks
  { id: sopT1.id, startH: -96, durationH: 48 },     // SOP: open flow, done
  { id: sopT2.id, startH: -48, durationH: null },    // SOP: drinks, in progress
  { id: sopT3.id, startH: -2, durationH: null },     // SOP: ingredients, open
]

for (const { id, startH, durationH } of offsets) {
  const start = h(startH)
  const end = durationH != null ? h(startH + durationH) : null
  updateTime.run(start, end, id)
}

// ═══════════════════════════════════════════════════════
// PHASE 8: Timeseries backfill for charts
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 8: Timeseries chart data...')

const insertTs = db.prepare(`
  INSERT INTO bps_stats_timeseries (id, metric, interval, bucket, dimensions, count)
  VALUES (?, ?, ?, ?, '', ?)
  ON CONFLICT(metric, interval, bucket, dimensions) DO UPDATE SET count = count + ?
`)

for (let d = 14; d >= 1; d--) {
  const date = new Date(now)
  date.setDate(date.getDate() - d)
  const bucket = date.toISOString().slice(0, 10)

  const created = 3 + Math.floor(Math.random() * 8)
  const completed = 2 + Math.floor(Math.random() * 6)
  const errors = Math.floor(Math.random() * 2)

  for (const [metric, count] of [
    ['dashboard.process.created', created],
    ['process.completed', completed],
    ['process.error', errors],
  ] as const) {
    insertTs.run(crypto.randomUUID(), metric, 'day', bucket, count, count)
  }
}

// ═══════════════════════════════════════════════════════
// PHASE 9: Store entities for existing shops
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 9: Store entities...')

for (const store of [
  { id: 'store-001', name: '晨光咖啡·国贸店', address: '北京市朝阳区国贸三期B1-05', status: 'operating' },
  { id: 'store-002', name: '晨光咖啡·三里屯店', address: '北京市朝阳区三里屯太古里南-1F', status: 'operating' },
  { id: 'store-003', name: '晨光咖啡·中关村店', address: '北京市海淀区中关村大厦1F-02', status: 'operating' },
]) {
  const d = dossierStore.getOrCreate('store', store.id)
  dossierStore.commit(d.id, store, { committedBy: 'aida', message: 'Store entity synced' })
}

// ═══════════════════════════════════════════════════════
// PHASE 10: Management Data (Constraints + Violations)
// ═══════════════════════════════════════════════════════

console.log('[simulate] Phase 10: Management constraints & violation history...')

const mgmtStore = new ManagementStore(db)

// Load business management constraints
mgmtStore.loadConstraints([
  {
    id: 'c-large-purchase',
    policyId: 'p-financial',
    label: '大额采购审批',
    scope: { tools: ['bps_update_entity'], entityTypes: ['procurement'], dataFields: ['amount'] },
    condition: 'amount <= 5000',
    onViolation: 'REQUIRE_APPROVAL',
    severity: 'HIGH',
    approver: 'owner',
    message: '采购金额 ¥{amount} 超过 ¥5,000 限额，需老板审批',
  },
  {
    id: 'c-business-hours',
    policyId: 'p-operational',
    label: '营业时间限制',
    scope: { tools: ['bps_update_entity', 'bps_create_task', 'bps_update_task'] },
    condition: 'hour >= 7 and hour <= 23',
    onViolation: 'BLOCK',
    severity: 'MEDIUM',
    message: '非营业时间（{hour}:00），写操作被阻止',
  },
  {
    id: 'c-store-modify-guard',
    policyId: 'p-data-integrity',
    label: '门店数据修改保护',
    scope: { tools: ['bps_update_entity'], entityTypes: ['store'], dataFields: ['status', 'address'] },
    condition: 'lifecycle != "ACTIVE"',
    onViolation: 'REQUIRE_APPROVAL',
    severity: 'HIGH',
    approver: 'owner',
    message: '门店关键字段（{entityId}）修改需审批',
  },
  {
    id: 'c-no-delete-active',
    policyId: 'p-data-integrity',
    label: '禁止删除活跃实体',
    scope: { tools: ['bps_update_entity'], dataFields: ['lifecycle'] },
    condition: 'lifecycle != "ARCHIVED"',
    onViolation: 'BLOCK',
    severity: 'CRITICAL',
    message: '不允许将活跃实体 {entityType}/{entityId} 归档',
  },
])

// Record some realistic violations that happened over the past few days
mgmtStore.recordViolation({
  constraintId: 'c-business-hours',
  policyId: 'p-operational',
  severity: 'MEDIUM',
  tool: 'bps_update_entity',
  entityType: 'store',
  entityId: 'store-002',
  verdict: 'BLOCK',
  condition: 'hour >= 7 and hour <= 23',
  evalContext: { hour: 3, entityType: 'store', entityId: 'store-002' },
  message: '非营业时间（3:00），写操作被阻止',
  circuitBreakerState: 'NORMAL',
})

mgmtStore.recordViolation({
  constraintId: 'c-large-purchase',
  policyId: 'p-financial',
  severity: 'HIGH',
  tool: 'bps_update_entity',
  entityType: 'procurement',
  entityId: 'po-coffee-machine',
  verdict: 'REQUIRE_APPROVAL',
  condition: 'amount <= 5000',
  evalContext: { amount: 68000, entityType: 'procurement', entityId: 'po-coffee-machine' },
  message: '采购金额 ¥68,000 超过 ¥5,000 限额，需老板审批',
  circuitBreakerState: 'NORMAL',
})

mgmtStore.recordViolation({
  constraintId: 'c-store-modify-guard',
  policyId: 'p-data-integrity',
  severity: 'HIGH',
  tool: 'bps_update_entity',
  entityType: 'store',
  entityId: 'store-001',
  verdict: 'REQUIRE_APPROVAL',
  condition: 'lifecycle == "ACTIVE"',
  evalContext: { entityType: 'store', entityId: 'store-001', lifecycle: 'ACTIVE', status: 'renovating' },
  message: '门店关键字段（store-001）修改需审批',
  circuitBreakerState: 'NORMAL',
})

// Create pending management approvals
mgmtStore.createApproval({
  constraintId: 'c-large-purchase',
  tool: 'bps_update_entity',
  toolInput: { entityType: 'procurement', entityId: 'po-coffee-machine', data: { amount: 68000, vendor: '意大利进口直营' } },
  entityType: 'procurement',
  entityId: 'po-coffee-machine',
  message: '采购金额 ¥68,000 超过 ¥5,000 限额，需老板审批',
  expiresAt: h(48),
})

mgmtStore.createApproval({
  constraintId: 'c-store-modify-guard',
  tool: 'bps_update_entity',
  toolInput: { entityType: 'store', entityId: 'store-001', data: { address: '北京市朝阳区建国路88号新址' } },
  entityType: 'store',
  entityId: 'store-001',
  message: '门店关键字段（store-001）修改需审批',
  expiresAt: h(24),
})

// ═══════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════

const allTasks = processStore.query({})
const byState: Record<string, number> = {}
for (const t of allTasks) byState[t.state] = (byState[t.state] ?? 0) + 1

console.log('\n[simulate] ✅ Scenario loaded successfully!')
console.log(`  Tasks:     ${allTasks.length} total (${Object.entries(byState).map(([s, n]) => `${s}: ${n}`).join(', ')})`)
console.log(`  Dossiers:  action-plan ×2, approval ×4, store ×4, skill-creation ×1`)
console.log(`  Management: 4 constraints, 3 violations, 2 pending approvals`)
console.log(`  Agent Log: ${allTasks.length * 2}+ entries (create + state changes)`)
console.log(`  Charts:    14 days of timeseries data`)
console.log('')
console.log('  Dashboard pages to check:')
console.log('    /                — overview: 现状/目标/下一步 三面板 + management status')
console.log('    /business-goals  — 2 action plans with items + completion stats')
console.log('    /approvals       — 3 pending + 1 approved')
console.log('    /management      — circuit breaker + constraints + violations + gov approvals')
console.log('    /agent-log       — full audit trail of all operations')
console.log('    /kanban          — tasks by state')

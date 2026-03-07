/**
 * Seed script — populates the in-memory engine with demo data.
 * Imported by engine.ts so data is available immediately on server start.
 */
import crypto from 'node:crypto'
import type { BpsEngine } from '../../src/index.js'

export async function seedDemoData(engine: BpsEngine) {
  const { tracker, dossierStore } = engine

  // --- Operators ---
  const insertOp = engine.db.prepare(`
    INSERT OR REPLACE INTO bps_operators (id, label, name, status, active, role_ids, created_at, updated_at)
    VALUES (?, ?, ?, 'active', 1, '[]', ?, ?)
  `)
  const opNow = new Date().toISOString()
  insertOp.run('op-alice', 'Alice Wang', 'alice', opNow, opNow)
  insertOp.run('op-bob', 'Bob Chen', 'bob', opNow, opNow)
  insertOp.run('op-system', 'System', 'system', opNow, opNow)
  insertOp.run('op-carlos', 'Carlos Lee', 'carlos', opNow, opNow)

  // --- Customers ---
  const customers = [
    { id: 'cust-001', name: 'Alice Wang', email: 'alice@example.com', tier: 'gold' },
    { id: 'cust-002', name: 'Bob Chen', email: 'bob@example.com', tier: 'silver' },
    { id: 'cust-003', name: 'Carol Li', email: 'carol@example.com', tier: 'bronze' },
    { id: 'cust-004', name: 'David Kim', email: 'david@example.com', tier: 'gold' },
  ]

  for (const c of customers) {
    const d = dossierStore.getOrCreate('customer', c.id)
    dossierStore.commit(d.id, c, { committedBy: 'seed', message: 'Initial customer data' })
  }

  // --- Orders ---
  const orders = [
    { id: 'ord-1001', customerId: 'cust-001', items: ['Widget A x2', 'Gadget B x1'], total: 149.99, status: 'confirmed' },
    { id: 'ord-1002', customerId: 'cust-002', items: ['Widget C x5'], total: 299.50, status: 'confirmed' },
    { id: 'ord-1003', customerId: 'cust-001', items: ['Gadget D x1'], total: 59.00, status: 'pending' },
    { id: 'ord-1004', customerId: 'cust-003', items: ['Widget A x1', 'Widget C x3'], total: 209.97, status: 'confirmed' },
    { id: 'ord-1005', customerId: 'cust-004', items: ['Gadget B x2'], total: 179.98, status: 'confirmed' },
    { id: 'ord-1006', customerId: 'cust-002', items: ['Widget A x10'], total: 499.90, status: 'confirmed' },
  ]

  for (const o of orders) {
    const d = dossierStore.getOrCreate('order', o.id)
    dossierStore.commit(d.id, o, { committedBy: 'seed', message: 'Order placed' })
  }

  // Update a couple orders to create version history
  const ord1001 = dossierStore.getOrCreate('order', 'ord-1001')
  dossierStore.commit(ord1001.id, { status: 'paid', paidAt: new Date().toISOString() }, { committedBy: 'payment-svc', message: 'Payment received' })

  const ord1002 = dossierStore.getOrCreate('order', 'ord-1002')
  dossierStore.commit(ord1002.id, { status: 'paid', paidAt: new Date().toISOString() }, { committedBy: 'payment-svc', message: 'Payment received' })
  dossierStore.commit(ord1002.id, { status: 'shipped', trackingNo: 'TRK-887766' }, { committedBy: 'shipping-svc', message: 'Shipped via express' })

  // --- Processes in various states (5-state model: OPEN → IN_PROGRESS → COMPLETED/FAILED/BLOCKED) ---
  // Order fulfillment processes
  const p1 = tracker.createTask({ serviceId: 'svc-order-pipeline', entityType: 'order', entityId: 'ord-1001', operatorId: 'op-alice' })
  tracker.updateTask(p1.id, { state: 'IN_PROGRESS' })

  const p2 = tracker.createTask({ serviceId: 'svc-order-pipeline', entityType: 'order', entityId: 'ord-1002', operatorId: 'op-bob' })
  tracker.updateTask(p2.id, { state: 'IN_PROGRESS' })
  tracker.updateTask(p2.id, { state: 'BLOCKED' })

  const p3 = tracker.createTask({ serviceId: 'svc-order-pipeline', entityType: 'order', entityId: 'ord-1003', operatorId: 'op-alice' })

  const p4 = tracker.createTask({ serviceId: 'svc-order-pipeline', entityType: 'order', entityId: 'ord-1004', operatorId: 'op-carlos' })
  tracker.updateTask(p4.id, { state: 'IN_PROGRESS' })
  tracker.updateTask(p4.id, { state: 'BLOCKED' })

  const p5 = tracker.createTask({ serviceId: 'svc-order-pipeline', entityType: 'order', entityId: 'ord-1005', operatorId: 'op-system' })
  tracker.completeTask(p5.id)

  const p6 = tracker.createTask({ serviceId: 'svc-order-pipeline', entityType: 'order', entityId: 'ord-1006', operatorId: 'op-bob' })
  tracker.failTask(p6.id, 'Order validation failed')

  // Customer onboarding processes
  const p7 = tracker.createTask({ serviceId: 'svc-customer-onboard', entityType: 'customer', entityId: 'cust-001', operatorId: 'op-system' })
  tracker.completeTask(p7.id)

  const p8 = tracker.createTask({ serviceId: 'svc-customer-onboard', entityType: 'customer', entityId: 'cust-002', operatorId: 'op-carlos' })
  tracker.updateTask(p8.id, { state: 'IN_PROGRESS' })

  const p9 = tracker.createTask({ serviceId: 'svc-customer-onboard', entityType: 'customer', entityId: 'cust-003', operatorId: 'op-alice' })

  // Some child processes for the running order
  const p10 = tracker.createTask({ serviceId: 'svc-validate-order', entityType: 'order', entityId: 'ord-1001', parentId: p1.id, operatorId: 'op-alice' })
  tracker.completeTask(p10.id)

  const p11 = tracker.createTask({ serviceId: 'svc-payment-processing', entityType: 'order', entityId: 'ord-1001', parentId: p1.id, operatorId: 'op-alice' })
  tracker.updateTask(p11.id, { state: 'IN_PROGRESS' })

  const p12 = tracker.createTask({ serviceId: 'svc-kyc-check', entityType: 'customer', entityId: 'cust-002', parentId: p8.id, operatorId: 'op-carlos' })
  tracker.updateTask(p12.id, { state: 'IN_PROGRESS' })
  tracker.updateTask(p12.id, { state: 'BLOCKED' })

  // --- Stagger start_time / end_time for realistic swimlane timelines ---
  const now = new Date()
  const updateTime = engine.db.prepare(`
    UPDATE bps_processes SET start_time = ?, end_time = ? WHERE id = ?
  `)
  const offsets: Array<{ id: string; startH: number; durationH: number | null }> = [
    { id: p1.id,  startH: -48, durationH: null },  // IN_PROGRESS 2 days ago, still going
    { id: p2.id,  startH: -36, durationH: null },   // BLOCKED
    { id: p3.id,  startH: -2,  durationH: null },   // OPEN, no start
    { id: p4.id,  startH: -24, durationH: null },   // BLOCKED
    { id: p5.id,  startH: -72, durationH: 8 },      // COMPLETED 3 days ago
    { id: p6.id,  startH: -12, durationH: 1 },      // FAILED after 1h
    { id: p7.id,  startH: -96, durationH: 24 },     // COMPLETED 4 days ago
    { id: p8.id,  startH: -18, durationH: null },   // IN_PROGRESS
    { id: p9.id,  startH: -1,  durationH: null },   // OPEN
    { id: p10.id, startH: -47, durationH: 2 },      // child, COMPLETED
    { id: p11.id, startH: -45, durationH: null },   // child, IN_PROGRESS
    { id: p12.id, startH: -17, durationH: null },   // child, BLOCKED
  ]

  for (const { id, startH, durationH } of offsets) {
    const start = new Date(now.getTime() + startH * 3600_000).toISOString()
    const end = durationH != null ? new Date(now.getTime() + (startH + durationH) * 3600_000).toISOString() : null
    updateTime.run(start, end, id)
  }

  // --- Timeseries backfill (7 days) ---
  const insertTs = engine.db.prepare(`
    INSERT INTO bps_stats_timeseries (id, metric, interval, bucket, dimensions, count)
    VALUES (?, ?, ?, ?, '', ?)
    ON CONFLICT(metric, interval, bucket, dimensions) DO UPDATE SET count = count + ?
  `)
  for (let d = 7; d >= 1; d--) {
    const date = new Date(now)
    date.setDate(date.getDate() - d)
    const bucket = date.toISOString().slice(0, 10) // YYYY-MM-DD

    const created = 5 + Math.floor(Math.random() * 15)
    const completed = 3 + Math.floor(Math.random() * 10)
    const errors = Math.floor(Math.random() * 4)

    for (const [metric, count] of [
      ['dashboard.process.created', created],
      ['process.completed', completed],
      ['process.error', errors],
    ] as const) {
      insertTs.run(crypto.randomUUID(), metric, 'day', bucket, count, count)
    }
  }

  // --- Phase C: Action Plans (Business Goals) ---
  const plan1 = dossierStore.getOrCreate('action-plan', 'plan-q1-2026')
  dossierStore.commit(plan1.id, {
    name: 'Q1 2026 Operational Goals',
    description: 'First quarter operational targets for order fulfillment optimization',
    items: [
      { name: 'Reduce order processing time by 20%', status: 'in-progress', dueDate: '2026-03-31', priority: 'high' },
      { name: 'Onboard 10 new enterprise customers', status: 'in-progress', dueDate: '2026-03-31', priority: 'high' },
      { name: 'Achieve 99% order accuracy rate', status: 'pending', dueDate: '2026-03-31', priority: 'medium' },
      { name: 'Set up automated inventory alerts', status: 'done', dueDate: '2026-02-15', priority: 'medium' },
    ],
    periodicItems: [
      { name: 'Weekly order volume report', cron: '0 9 * * MON' },
      { name: 'Daily failed order review', cron: '0 8 * * *' },
      { name: 'Monthly customer satisfaction survey', cron: '0 10 1 * *' },
    ],
  }, { committedBy: 'aida', message: 'Q1 goals established' })

  // Create related processes for plan progress tracking
  const planTask1 = tracker.createTask({ serviceId: 'svc-customer-onboard', entityType: 'action-plan', entityId: 'plan-q1-2026', operatorId: 'op-alice' })
  tracker.completeTask(planTask1.id)
  const planTask2 = tracker.createTask({ serviceId: 'svc-customer-onboard', entityType: 'action-plan', entityId: 'plan-q1-2026', operatorId: 'op-bob' })
  tracker.completeTask(planTask2.id)
  const planTask3 = tracker.createTask({ serviceId: 'svc-customer-onboard', entityType: 'action-plan', entityId: 'plan-q1-2026', operatorId: 'op-carlos' })
  tracker.updateTask(planTask3.id, { state: 'IN_PROGRESS' })
  tracker.createTask({ serviceId: 'svc-validate-order', entityType: 'action-plan', entityId: 'plan-q1-2026' })

  const plan2 = dossierStore.getOrCreate('action-plan', 'plan-weekly-ops')
  dossierStore.commit(plan2.id, {
    name: 'Weekly Operations Routine',
    description: 'Recurring operational tasks managed by Aida',
    items: [],
    periodicItems: [
      { name: 'Inventory stock check', cron: '0 9 * * MON', lastRun: new Date(Date.now() - 5 * 86_400_000).toISOString() },
      { name: 'Shipping carrier rate update', cron: '0 10 * * WED' },
      { name: 'Customer feedback digest', cron: '0 14 * * FRI', lastRun: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    ],
  }, { committedBy: 'aida', message: 'Weekly ops routine created' })

  // --- Phase C: Approvals ---
  const appr1 = dossierStore.getOrCreate('approval', 'appr-bulk-discount')
  dossierStore.commit(appr1.id, {
    status: 'pending',
    question: 'Approve 15% bulk discount for enterprise order from David Kim (ord-1005)?',
    context: { orderId: 'ord-1005', customerId: 'cust-004', discountRate: 0.15, orderTotal: 179.98, discountedTotal: 152.98 },
    serviceId: 'svc-order-pipeline',
    taskId: p5.id,
    requestedBy: 'aida',
    requestedAt: new Date(Date.now() - 3600_000).toISOString(),
  }, { committedBy: 'aida', message: 'Approval requested: bulk discount' })

  const appr2 = dossierStore.getOrCreate('approval', 'appr-expedited-ship')
  dossierStore.commit(appr2.id, {
    status: 'pending',
    question: 'Approve expedited shipping upgrade for ord-1004 (extra cost: $25)?',
    context: { orderId: 'ord-1004', customerId: 'cust-003', extraCost: 25, reason: 'Customer requested faster delivery' },
    serviceId: 'svc-pick-pack',
    requestedBy: 'aida',
    requestedAt: new Date(Date.now() - 7200_000).toISOString(),
  }, { committedBy: 'aida', message: 'Approval requested: expedited shipping' })

  const appr3 = dossierStore.getOrCreate('approval', 'appr-refund')
  dossierStore.commit(appr3.id, {
    status: 'approved',
    question: 'Approve refund of $59.00 for ord-1003 (item damaged in transit)?',
    context: { orderId: 'ord-1003', amount: 59.00, reason: 'Item damaged' },
    serviceId: 'svc-order-pipeline',
    requestedBy: 'aida',
    requestedAt: new Date(Date.now() - 86_400_000).toISOString(),
    decidedBy: 'admin',
    decidedAt: new Date(Date.now() - 43_200_000).toISOString(),
    decision: 'approved',
    decisionReason: 'Standard refund policy applies',
  }, { committedBy: 'admin', message: 'Refund approved' })

  console.log('[seed] Demo data loaded: 4 customers, 6 orders, 16 processes, 4 operators, 7-day timeseries, 2 action-plans, 3 approvals')
}

import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, type TestContext } from './helpers.js'

// Use leaf services to avoid rule-triggered child processes
const LEAF_SERVICE = 'svc-validate-order'
const LEAF_SERVICE_2 = 'svc-kyc-check'

describe('GET /api/kanban', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return 5 columns for 5 task states', async () => {
    const { status, body } = await getJson(ctx.app, '/api/kanban')
    expect(status).toBe(200)
    expect(body).toHaveLength(5)
    const states = body.map((col: any) => col.state)
    expect(states).toEqual(expect.arrayContaining(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BLOCKED']))
  })

  it('should place processes in correct columns', async () => {
    const p1 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
    const p2 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2' })
    ctx.engine.tracker.updateTask(p2.id, { state: 'IN_PROGRESS' })

    const { body } = await getJson(ctx.app, '/api/kanban')
    const openCol = body.find((col: any) => col.state === 'OPEN')
    const inProgressCol = body.find((col: any) => col.state === 'IN_PROGRESS')
    expect(openCol.count).toBe(1)
    expect(inProgressCol.count).toBe(1)
  })

  it('should filter by serviceId', async () => {
    ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
    ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE_2, entityType: 'customer', entityId: 'c1' })

    const { body } = await getJson(ctx.app, `/api/kanban?serviceId=${LEAF_SERVICE}`)
    const totalProcesses = body.reduce((sum: number, col: any) => sum + col.count, 0)
    expect(totalProcesses).toBe(1)
  })

  it('should filter by entityType', async () => {
    ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
    ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE_2, entityType: 'customer', entityId: 'c1' })

    const { body } = await getJson(ctx.app, '/api/kanban?entityType=customer')
    const totalProcesses = body.reduce((sum: number, col: any) => sum + col.count, 0)
    expect(totalProcesses).toBe(1)
  })

  it('should include operatorLabel when operator exists', async () => {
    const now = new Date().toISOString()
    ctx.engine.db.prepare(`INSERT INTO bps_operators (id, label, name, status, active, role_ids, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, '[]', ?, ?)`).run('op-test', 'Test Operator', 'test', now, now)

    ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1', operatorId: 'op-test' })

    const { body } = await getJson(ctx.app, '/api/kanban')
    const openCol = body.find((col: any) => col.state === 'OPEN')
    expect(openCol.processes[0].operatorLabel).toBe('Test Operator')
  })
})

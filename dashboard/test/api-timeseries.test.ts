import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, type TestContext } from './helpers.js'

// Use leaf service to avoid rule-triggered child processes inflating counts
const LEAF_SERVICE = 'svc-validate-order'

describe('GET /api/stats/timeseries', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return 400 when required params are missing', async () => {
    const { status, body } = await getJson(ctx.app, '/api/stats/timeseries')
    expect(status).toBe(400)
    expect(body.error).toMatch(/missing/i)
  })

  it('should return 400 when some params are missing', async () => {
    const { status } = await getJson(ctx.app, '/api/stats/timeseries?metric=foo&interval=day')
    expect(status).toBe(400)
  })

  it('should return empty array when no data exists', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { status, body } = await getJson(ctx.app, `/api/stats/timeseries?metric=nonexistent&interval=day&from=${today}&to=${today}`)
    expect(status).toBe(200)
    expect(body).toEqual([])
  })

  it('should return timeseries data after creating processes', async () => {
    // Use leaf services so each createTask fires exactly 1 dashboard.process.created event
    ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
    ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2' })

    const today = new Date().toISOString().slice(0, 10)
    const { status, body } = await getJson(ctx.app, `/api/stats/timeseries?metric=dashboard.process.created&interval=day&from=${today}&to=${today}`)
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].count).toBe(2)
  })

  it('should return process.completed metric after completing processes', async () => {
    const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
    // completeTask auto-advances OPEN → IN_PROGRESS → COMPLETED and emits process:completed
    // which triggers the statsStore.recordEvent('process.completed') wired in createBpsEngine()
    ctx.engine.tracker.completeTask(p.id)

    const today = new Date().toISOString().slice(0, 10)
    // process.completed is recorded without dimensions
    const { body } = await getJson(ctx.app, `/api/stats/timeseries?metric=process.completed&interval=day&from=${today}&to=${today}`)
    expect(body).toHaveLength(1)
    expect(body[0].count).toBe(1)
  })
})

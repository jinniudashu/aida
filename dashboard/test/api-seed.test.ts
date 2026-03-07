import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, type TestContext } from './helpers.js'
import { seedDemoData } from '../server/seed.js'

describe('Seeded demo data smoke tests', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = createTestContext()
    await seedDemoData(ctx.engine)
  })

  it('overview should have non-zero counts', async () => {
    const { status, body } = await getJson(ctx.app, '/api/overview')
    expect(status).toBe(200)
    expect(body.processes.totalCount).toBeGreaterThanOrEqual(12)
    expect(body.entities.totalCount).toBeGreaterThanOrEqual(10) // 4 customers + 6 orders
    expect(body.services.totalCount).toBe(10)
  })

  it('kanban should have processes in multiple columns', async () => {
    const { body } = await getJson(ctx.app, '/api/kanban')
    const nonEmptyCols = body.filter((col: any) => col.count > 0)
    expect(nonEmptyCols.length).toBeGreaterThanOrEqual(4)
  })

  it('processes should return >=12 items', async () => {
    const { body } = await getJson(ctx.app, '/api/processes')
    expect(body.length).toBeGreaterThanOrEqual(12)
  })

  it('entities should include customers and orders', async () => {
    const { body: customers } = await getJson(ctx.app, '/api/entities?entityType=customer')
    expect(customers.length).toBe(4)

    const { body: orders } = await getJson(ctx.app, '/api/entities?entityType=order')
    expect(orders.length).toBe(6)
  })

  it('workload should have 4 operators', async () => {
    const { body } = await getJson(ctx.app, '/api/operators/workload')
    expect(body.operators.length).toBe(4)
  })

  it('timeseries should have 7 days of historical data', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const sevenDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)

    const { body } = await getJson(ctx.app, `/api/stats/timeseries?metric=dashboard.process.created&interval=day&from=${sevenDaysAgo}&to=${today}`)
    expect(body.length).toBeGreaterThanOrEqual(7)
  })
})

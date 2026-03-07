import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, type TestContext } from './helpers.js'

describe('GET /api/overview', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return overview with services from loaded blueprint', async () => {
    const { status, body } = await getJson(ctx.app, '/api/overview')
    expect(status).toBe(200)
    // Blueprint has 10 services
    expect(body.services.totalCount).toBe(10)
    // Zero processes / entities in empty engine
    expect(body.processes.totalCount).toBe(0)
    expect(body.entities.totalCount).toBe(0)
  })

  it('should count services by executorType', async () => {
    const { body } = await getJson(ctx.app, '/api/overview')
    const byType = body.services.byExecutorType
    // system: svc-order-pipeline, svc-validate-order, svc-payment-processing,
    //         svc-notify-customer, svc-customer-onboard, svc-welcome-email = 6
    // agent: svc-inventory-check, svc-ship, svc-kyc-check = 3
    // manual: svc-pick-pack = 1
    expect(byType.system).toBe(6)
    expect(byType.agent).toBe(3)
    expect(byType.manual).toBe(1)
  })

  it('should count entities by type after creating dossiers', async () => {
    ctx.engine.dossierStore.getOrCreate('customer', 'c1')
    ctx.engine.dossierStore.getOrCreate('customer', 'c2')
    ctx.engine.dossierStore.getOrCreate('order', 'o1')

    const { body } = await getJson(ctx.app, '/api/overview')
    expect(body.entities.totalCount).toBe(3)
    expect(body.entities.byType.customer).toBe(2)
    expect(body.entities.byType.order).toBe(1)
  })

  it('should count processes by state after creating processes', async () => {
    // Use leaf services (no rules trigger on OPEN for these)
    const p1 = ctx.engine.tracker.createTask({ serviceId: 'svc-validate-order', entityType: 'order', entityId: 'o1' })
    const p2 = ctx.engine.tracker.createTask({ serviceId: 'svc-validate-order', entityType: 'order', entityId: 'o2' })
    ctx.engine.tracker.updateTask(p2.id, { state: 'FAILED' })

    const { body } = await getJson(ctx.app, '/api/overview')
    expect(body.processes.totalCount).toBe(2)
    expect(body.processes.byState.OPEN).toBe(1)
    expect(body.processes.byState.FAILED).toBe(1)
    expect(body.processes.activeCount).toBe(1)
    expect(body.processes.errorCount).toBe(1)
  })

  it('should track entity lifecycle counts', async () => {
    ctx.engine.dossierStore.getOrCreate('customer', 'c1')
    const { body } = await getJson(ctx.app, '/api/overview')
    expect(body.entities.byLifecycle.ACTIVE).toBe(1)
  })

  it('should include recentChanges sorted newest first', async () => {
    const d1 = ctx.engine.dossierStore.getOrCreate('customer', 'c1')
    ctx.engine.dossierStore.commit(d1.id, { name: 'First' }, { committedBy: 'test', message: 'v1' })

    const d2 = ctx.engine.dossierStore.getOrCreate('order', 'o1')
    ctx.engine.dossierStore.commit(d2.id, { item: 'A' }, { committedBy: 'test', message: 'v1' })

    const { body } = await getJson(ctx.app, '/api/overview')
    // Both committed dossiers should appear in recent changes
    expect(body.entities.recentChanges.length).toBeGreaterThanOrEqual(2)
  })
})

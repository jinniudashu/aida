import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, postJson, type TestContext } from './helpers.js'

describe('Trial Run — simulate-complete', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should simulate-complete an OPEN process to COMPLETED', async () => {
    const p = ctx.engine.tracker.createTask({
      serviceId: 'svc-validate-order',
      entityType: 'order',
      entityId: 'trial-001',
    })
    expect(p.state).toBe('OPEN')

    const { status, body } = await postJson(ctx.app, `/api/processes/${p.id}/simulate-complete`, {})
    expect(status).toBe(200)
    expect(body.process.state).toBe('COMPLETED')
    expect(body.process.id).toBe(p.id)
  })

  it('should simulate-complete an IN_PROGRESS process to COMPLETED', async () => {
    const p = ctx.engine.tracker.createTask({
      serviceId: 'svc-validate-order',
      entityType: 'order',
      entityId: 'trial-002',
    })
    ctx.engine.tracker.updateTask(p.id, { state: 'IN_PROGRESS' })

    const { status, body } = await postJson(ctx.app, `/api/processes/${p.id}/simulate-complete`, {})
    expect(status).toBe(200)
    expect(body.process.state).toBe('COMPLETED')
  })

  it('should simulate-complete a BLOCKED process to COMPLETED', async () => {
    const p = ctx.engine.tracker.createTask({
      serviceId: 'svc-validate-order',
      entityType: 'order',
      entityId: 'trial-003',
    })
    ctx.engine.tracker.updateTask(p.id, { state: 'IN_PROGRESS' })
    ctx.engine.tracker.updateTask(p.id, { state: 'BLOCKED' })

    const { status, body } = await postJson(ctx.app, `/api/processes/${p.id}/simulate-complete`, {})
    expect(status).toBe(200)
    expect(body.process.state).toBe('COMPLETED')
  })

  it('should simulate-complete child processes and return tree', async () => {
    // Manually set up parent + child process tree (no rule engine)
    const root = ctx.engine.tracker.createTask({
      serviceId: 'svc-order-pipeline',
      entityType: 'order',
      entityId: 'trial-004',
    })
    const child = ctx.engine.tracker.createTask({
      serviceId: 'svc-validate-order',
      entityType: 'order',
      entityId: 'trial-004',
      parentId: root.id,
    })

    // Simulate-complete the child
    const { status, body } = await postJson(ctx.app, `/api/processes/${child.id}/simulate-complete`, {})
    expect(status).toBe(200)
    expect(body.process.state).toBe('COMPLETED')

    // Tree should show root with child
    expect(body.tree).not.toBeNull()
    expect(body.tree.process.id).toBe(root.id)
    const completedChild = body.tree.children.find((c: any) => c.process.serviceId === 'svc-validate-order')
    expect(completedChild).toBeDefined()
    expect(completedChild.process.state).toBe('COMPLETED')
  })

  it('should simulate-complete multiple children in a pipeline', async () => {
    // Manually build the full pipeline tree
    const root = ctx.engine.tracker.createTask({
      serviceId: 'svc-order-pipeline',
      entityType: 'order',
      entityId: 'trial-005',
    })

    const validate = ctx.engine.tracker.createTask({
      serviceId: 'svc-validate-order', entityType: 'order', entityId: 'trial-005', parentId: root.id,
    })
    const payment = ctx.engine.tracker.createTask({
      serviceId: 'svc-payment-processing', entityType: 'order', entityId: 'trial-005', parentId: root.id,
    })
    const inventory = ctx.engine.tracker.createTask({
      serviceId: 'svc-inventory-check', entityType: 'order', entityId: 'trial-005', parentId: root.id,
    })
    const notify = ctx.engine.tracker.createTask({
      serviceId: 'svc-notify-customer', entityType: 'order', entityId: 'trial-005', parentId: root.id,
    })
    const pickPack = ctx.engine.tracker.createTask({
      serviceId: 'svc-pick-pack', entityType: 'order', entityId: 'trial-005', parentId: root.id,
    })
    const ship = ctx.engine.tracker.createTask({
      serviceId: 'svc-ship', entityType: 'order', entityId: 'trial-005', parentId: root.id,
    })

    // Walk the pipeline: simulate-complete each step
    await postJson(ctx.app, `/api/processes/${validate.id}/simulate-complete`, {})
    await postJson(ctx.app, `/api/processes/${payment.id}/simulate-complete`, {})
    await postJson(ctx.app, `/api/processes/${inventory.id}/simulate-complete`, {})
    await postJson(ctx.app, `/api/processes/${notify.id}/simulate-complete`, {})
    await postJson(ctx.app, `/api/processes/${pickPack.id}/simulate-complete`, {})

    const { status, body } = await postJson(ctx.app, `/api/processes/${ship.id}/simulate-complete`, {})
    expect(status).toBe(200)
    expect(body.process.state).toBe('COMPLETED')

    // All children should be COMPLETED
    const finalTree = ctx.engine.processStore.getProcessTree(root.id)!
    for (const child of finalTree.children) {
      expect(child.process.state).toBe('COMPLETED')
    }
    // 6 child services: validate, payment, inventory, notify, pick-pack, ship
    expect(finalTree.children).toHaveLength(6)
  })

  it('should return 404 for non-existent process', async () => {
    const { status, body } = await postJson(ctx.app, '/api/processes/nonexistent-id/simulate-complete', {})
    expect(status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it('should return 400 for already COMPLETED process', async () => {
    const p = ctx.engine.tracker.createTask({
      serviceId: 'svc-validate-order',
      entityType: 'order',
      entityId: 'trial-006',
    })
    // Drive to COMPLETED
    ctx.engine.tracker.updateTask(p.id, { state: 'IN_PROGRESS' })
    ctx.engine.tracker.updateTask(p.id, { state: 'COMPLETED' })

    const { status, body } = await postJson(ctx.app, `/api/processes/${p.id}/simulate-complete`, {})
    expect(status).toBe(400)
    expect(body.error).toMatch(/COMPLETED/)
  })
})

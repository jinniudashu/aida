import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, postJson, type TestContext } from './helpers.js'

// Use leaf services (no rules trigger on OPEN) to get predictable process counts
const LEAF_SERVICE = 'svc-validate-order'

describe('Process API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  // --- POST /api/processes ---
  describe('POST /api/processes', () => {
    it('should create a process and return 201', async () => {
      const { status, body } = await postJson(ctx.app, '/api/processes', {
        serviceId: LEAF_SERVICE,
        entityType: 'order',
        entityId: 'ord-001',
      })
      expect(status).toBe(201)
      expect(body.id).toBeDefined()
      expect(body.state).toBe('OPEN')
      expect(body.serviceId).toBe(LEAF_SERVICE)
    })

    it('should accept any serviceId (tracker does not validate against blueprint)', async () => {
      const { status, body } = await postJson(ctx.app, '/api/processes', {
        serviceId: 'nonexistent-service',
        entityType: 'order',
        entityId: 'ord-001',
      })
      expect(status).toBe(201)
      expect(body.serviceId).toBe('nonexistent-service')
    })
  })

  // --- GET /api/processes ---
  describe('GET /api/processes', () => {
    it('should list all processes', async () => {
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2' })

      const { status, body } = await getJson(ctx.app, '/api/processes')
      expect(status).toBe(200)
      expect(body).toHaveLength(2)
    })

    it('should filter by state', async () => {
      const p1 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2' })
      ctx.engine.tracker.updateTask(p1.id, { state: 'FAILED' })

      const { body } = await getJson(ctx.app, '/api/processes?state=FAILED')
      expect(body).toHaveLength(1)
      expect(body[0].state).toBe('FAILED')
    })

    it('should filter by serviceId', async () => {
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.createTask({ serviceId: 'svc-pick-pack', entityType: 'order', entityId: 'o2' })

      const { body } = await getJson(ctx.app, `/api/processes?serviceId=${LEAF_SERVICE}`)
      expect(body).toHaveLength(1)
      expect(body[0].serviceId).toBe(LEAF_SERVICE)
    })

    it('should filter by entityType', async () => {
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.createTask({ serviceId: 'svc-kyc-check', entityType: 'customer', entityId: 'c1' })

      const { body } = await getJson(ctx.app, '/api/processes?entityType=customer')
      expect(body).toHaveLength(1)
    })

    it('should support pagination with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: `o${i}` })
      }

      const { body } = await getJson(ctx.app, '/api/processes?limit=2&offset=1')
      expect(body).toHaveLength(2)
    })
  })

  // --- GET /api/processes/:id ---
  describe('GET /api/processes/:id', () => {
    it('should return process detail', async () => {
      const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })

      const { status, body } = await getJson(ctx.app, `/api/processes/${p.id}`)
      expect(status).toBe(200)
      expect(body.process.id).toBe(p.id)
    })

    it('should return 404 for nonexistent process', async () => {
      const { status, body } = await getJson(ctx.app, '/api/processes/nonexistent-id')
      expect(status).toBe(404)
      expect(body.error).toBeDefined()
    })
  })

  // --- GET /api/processes/:id/tree ---
  describe('GET /api/processes/:id/tree', () => {
    it('should return process tree with children', async () => {
      const parent = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.createTask({ serviceId: 'svc-payment-processing', entityType: 'order', entityId: 'o1', parentId: parent.id })
      ctx.engine.tracker.createTask({ serviceId: 'svc-pick-pack', entityType: 'order', entityId: 'o1', parentId: parent.id })

      const { status, body } = await getJson(ctx.app, `/api/processes/${parent.id}/tree`)
      expect(status).toBe(200)
      expect(body.process.id).toBe(parent.id)
      expect(body.children).toHaveLength(2)
    })

    it('should return leaf node with empty children', async () => {
      const leaf = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })

      const { body } = await getJson(ctx.app, `/api/processes/${leaf.id}/tree`)
      expect(body.children).toHaveLength(0)
    })

    it('should return 404 for nonexistent tree', async () => {
      const { status } = await getJson(ctx.app, '/api/processes/no-such-id/tree')
      expect(status).toBe(404)
    })
  })

  // --- POST /api/processes/:id/transition ---
  describe('POST /api/processes/:id/transition', () => {
    it('should transition process through full lifecycle', async () => {
      const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })

      let res = await postJson(ctx.app, `/api/processes/${p.id}/transition`, { newState: 'IN_PROGRESS' })
      expect(res.status).toBe(200)
      expect(res.body.state).toBe('IN_PROGRESS')

      res = await postJson(ctx.app, `/api/processes/${p.id}/transition`, { newState: 'COMPLETED' })
      expect(res.body.state).toBe('COMPLETED')
    })

    it('should return 400 for invalid state transition', async () => {
      const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      // OPEN → COMPLETED is invalid (must go through IN_PROGRESS)
      const { status } = await postJson(ctx.app, `/api/processes/${p.id}/transition`, { newState: 'COMPLETED' })
      expect(status).toBe(400)
    })

    it('should return 400 when newState is missing', async () => {
      const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      const { status, body } = await postJson(ctx.app, `/api/processes/${p.id}/transition`, {})
      expect(status).toBe(400)
      expect(body.error).toMatch(/newState/i)
    })
  })
})

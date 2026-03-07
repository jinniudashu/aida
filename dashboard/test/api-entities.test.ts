import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, postJson, type TestContext } from './helpers.js'

describe('Entity API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  // --- POST /api/entities/:entityType/:entityId ---
  describe('POST /api/entities/:entityType/:entityId', () => {
    it('should create an entity and return 201', async () => {
      const { status, body } = await postJson(ctx.app, '/api/entities/customer/c1', {
        data: { name: 'Alice', tier: 'gold' },
        committedBy: 'test',
        message: 'Initial data',
      })
      expect(status).toBe(201)
      expect(body.dossier).toBeDefined()
      expect(body.dossier.entityType).toBe('customer')
      expect(body.dossier.entityId).toBe('c1')
      expect(body.version).toBeDefined()
    })

    it('should increment version on repeated commits', async () => {
      await postJson(ctx.app, '/api/entities/order/o1', { data: { status: 'new' }, committedBy: 'test', message: 'v1' })
      const { body } = await postJson(ctx.app, '/api/entities/order/o1', { data: { status: 'paid' }, committedBy: 'test', message: 'v2' })
      expect(body.version.version).toBe(2)
    })
  })

  // --- GET /api/entities ---
  describe('GET /api/entities', () => {
    it('should list all entities', async () => {
      ctx.engine.dossierStore.getOrCreate('customer', 'c1')
      ctx.engine.dossierStore.getOrCreate('order', 'o1')

      const { status, body } = await getJson(ctx.app, '/api/entities')
      expect(status).toBe(200)
      expect(body).toHaveLength(2)
    })

    it('should filter by entityType', async () => {
      ctx.engine.dossierStore.getOrCreate('customer', 'c1')
      ctx.engine.dossierStore.getOrCreate('customer', 'c2')
      ctx.engine.dossierStore.getOrCreate('order', 'o1')

      const { body } = await getJson(ctx.app, '/api/entities?entityType=customer')
      expect(body).toHaveLength(2)
    })

    it('should filter by lifecycle', async () => {
      ctx.engine.dossierStore.getOrCreate('customer', 'c1')
      ctx.engine.dossierStore.getOrCreate('order', 'o1')

      // Default lifecycle is 'ACTIVE' (uppercase in DB)
      const { body } = await getJson(ctx.app, '/api/entities?lifecycle=ACTIVE')
      expect(body).toHaveLength(2)

      const { body: body2 } = await getJson(ctx.app, '/api/entities?lifecycle=ARCHIVED')
      expect(body2).toHaveLength(0)
    })

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        ctx.engine.dossierStore.getOrCreate('customer', `c${i}`)
      }

      const { body } = await getJson(ctx.app, '/api/entities?limit=2&offset=1')
      expect(body).toHaveLength(2)
    })
  })

  // --- GET /api/entities/:id ---
  describe('GET /api/entities/:id', () => {
    it('should return entity detail with versions and relatedProcesses', async () => {
      const d = ctx.engine.dossierStore.getOrCreate('customer', 'c1')
      ctx.engine.dossierStore.commit(d.id, { name: 'Alice' }, { committedBy: 'test', message: 'v1' })
      ctx.engine.dossierStore.commit(d.id, { name: 'Alice Wang' }, { committedBy: 'test', message: 'v2' })

      // Create a related process (use leaf service to avoid rule-triggered children)
      ctx.engine.tracker.createTask({ serviceId: 'svc-kyc-check', entityType: 'customer', entityId: 'c1' })

      const { status, body } = await getJson(ctx.app, `/api/entities/${d.id}`)
      expect(status).toBe(200)
      expect(body.dossier).toBeDefined()
      expect(body.versions.length).toBeGreaterThanOrEqual(2)
      expect(body.relatedProcesses.length).toBe(1)
    })

    it('should return 404 for nonexistent entity', async () => {
      const { status, body } = await getJson(ctx.app, '/api/entities/nonexistent-id')
      expect(status).toBe(404)
      expect(body.error).toBeDefined()
    })
  })
})

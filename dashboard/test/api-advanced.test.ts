import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, type TestContext } from './helpers.js'

// Use leaf services to avoid rule-triggered child processes
const LEAF_SERVICE = 'svc-validate-order'

describe('Advanced API endpoints', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  // --- GET /api/services ---
  describe('GET /api/services', () => {
    it('should list all services from blueprint', async () => {
      const { status, body } = await getJson(ctx.app, '/api/services')
      expect(status).toBe(200)
      expect(body).toHaveLength(10)
    })

    it('should filter by entityType', async () => {
      const { body } = await getJson(ctx.app, '/api/services?entityType=customer')
      // customer services: svc-customer-onboard, svc-kyc-check, svc-welcome-email
      expect(body).toHaveLength(3)
      for (const svc of body) {
        expect(svc.entityType).toBe('customer')
      }
    })
  })

  // --- GET /api/rules ---
  describe('GET /api/rules', () => {
    it('should list active rules with event and service labels', async () => {
      const { status, body } = await getJson(ctx.app, '/api/rules')
      expect(status).toBe(200)
      expect(body.length).toBe(8)
      const rule = body[0]
      expect(rule.id).toBeDefined()
      expect(rule.label).toBeDefined()
      expect(rule.eventLabel).toBeDefined()
      // Layer 3: sysCall and evaluationMode fields
      expect(rule).toHaveProperty('sysCall')
      expect(rule).toHaveProperty('evaluationMode')
      expect(['deterministic', 'non_deterministic']).toContain(rule.evaluationMode)
    })

    it('should filter by targetServiceId', async () => {
      const { body } = await getJson(ctx.app, '/api/rules?targetServiceId=svc-customer-onboard')
      expect(body).toHaveLength(2)
    })
  })

  // --- GET /api/operators/workload ---
  describe('GET /api/operators/workload', () => {
    it('should return empty operators for fresh engine', async () => {
      const { status, body } = await getJson(ctx.app, '/api/operators/workload')
      expect(status).toBe(200)
      expect(body.operators).toHaveLength(0)
      expect(body.timeline).toHaveLength(0)
    })

    it('should aggregate by operator after creating processes', async () => {
      const now = new Date().toISOString()
      ctx.engine.db.prepare(`INSERT INTO bps_operators (id, label, name, status, active, role_ids, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, '[]', ?, ?)`).run('op-a', 'Alice', 'alice', now, now)
      ctx.engine.db.prepare(`INSERT INTO bps_operators (id, label, name, status, active, role_ids, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, '[]', ?, ?)`).run('op-b', 'Bob', 'bob', now, now)

      const p1 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1', operatorId: 'op-a' })
      ctx.engine.tracker.updateTask(p1.id, { state: 'IN_PROGRESS' })

      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2', operatorId: 'op-b' })

      const { body } = await getJson(ctx.app, '/api/operators/workload')
      expect(body.operators).toHaveLength(2)

      const alice = body.operators.find((o: any) => o.operatorId === 'op-a')
      expect(alice.label).toBe('Alice')
      expect(alice.byState.IN_PROGRESS).toBe(1)
      expect(alice.active).toBe(1)

      const bob = body.operators.find((o: any) => o.operatorId === 'op-b')
      expect(bob.byState.OPEN).toBe(1)
    })
  })

  // --- GET /api/entity-network ---
  describe('GET /api/entity-network', () => {
    it('should return nodes and edges for entities with data references', async () => {
      const custD = ctx.engine.dossierStore.getOrCreate('customer', 'cust-1')
      ctx.engine.dossierStore.commit(custD.id, { name: 'Alice' }, { committedBy: 'test', message: 'init' })

      const orderD = ctx.engine.dossierStore.getOrCreate('order', 'ord-1')
      ctx.engine.dossierStore.commit(orderD.id, { customerId: 'cust-1', total: 100 }, { committedBy: 'test', message: 'init' })

      const { status, body } = await getJson(ctx.app, '/api/entity-network')
      expect(status).toBe(200)
      expect(body.nodes).toHaveLength(2)

      const dataEdge = body.edges.find((e: any) => e.relation === 'customerId')
      expect(dataEdge).toBeDefined()
      expect(dataEdge.source).toBe(orderD.id)
      expect(dataEdge.target).toBe(custD.id)
    })

    it('should filter by entityType', async () => {
      ctx.engine.dossierStore.getOrCreate('customer', 'c1')
      ctx.engine.dossierStore.getOrCreate('order', 'o1')

      const { body } = await getJson(ctx.app, '/api/entity-network?entityType=customer')
      expect(body.nodes).toHaveLength(1)
      expect(body.nodes[0].entityType).toBe('customer')
    })

    it('should return empty for no entities', async () => {
      const { body } = await getJson(ctx.app, '/api/entity-network')
      expect(body.nodes).toHaveLength(0)
      expect(body.edges).toHaveLength(0)
    })
  })

  // --- GET /api/services/activity ---
  describe('GET /api/services/activity', () => {
    it('should return empty object for fresh engine', async () => {
      const { status, body } = await getJson(ctx.app, '/api/services/activity')
      expect(status).toBe(200)
      expect(body).toEqual({})
    })

    it('should return state counts grouped by service', async () => {
      const p1 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.updateTask(p1.id, { state: 'IN_PROGRESS' })

      const p2 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2' })
      // p2 stays in OPEN

      const { status, body } = await getJson(ctx.app, '/api/services/activity')
      expect(status).toBe(200)
      expect(body[LEAF_SERVICE]).toBeDefined()
      expect(body[LEAF_SERVICE]['IN_PROGRESS']).toBe(1)
      expect(body[LEAF_SERVICE]['OPEN']).toBe(1)
    })

    it('should exclude COMPLETED processes', async () => {
      const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.updateTask(p.id, { state: 'IN_PROGRESS' })
      ctx.engine.tracker.updateTask(p.id, { state: 'COMPLETED' })

      const { body } = await getJson(ctx.app, '/api/services/activity')
      // COMPLETED excluded — if no other active processes, service should not appear
      expect(body[LEAF_SERVICE]).toBeUndefined()
    })
  })

  // --- GET /api/alerts ---
  describe('GET /api/alerts', () => {
    it('should return empty alerts for fresh engine', async () => {
      const { status, body } = await getJson(ctx.app, '/api/alerts')
      expect(status).toBe(200)
      expect(body).toHaveLength(0)
    })

    it('should return warning when FAILED processes exist', async () => {
      const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.updateTask(p.id, { state: 'FAILED' })

      const { body } = await getJson(ctx.app, '/api/alerts')
      const errorAlert = body.find((a: any) => a.id === 'l1-error-warning')
      expect(errorAlert).toBeDefined()
      expect(errorAlert.severity).toBe('warning')
    })

    it('should return critical when >5 FAILED processes', async () => {
      for (let i = 0; i < 6; i++) {
        const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: `o${i}` })
        ctx.engine.tracker.updateTask(p.id, { state: 'FAILED' })
      }

      const { body } = await getJson(ctx.app, '/api/alerts')
      const critAlert = body.find((a: any) => a.id === 'l1-error-critical')
      expect(critAlert).toBeDefined()
      expect(critAlert.severity).toBe('critical')
    })
  })
})

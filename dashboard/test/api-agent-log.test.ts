import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, type TestContext } from './helpers.js'

const LEAF_SERVICE = 'svc-validate-order'

describe('Agent Log API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  describe('GET /api/agent-log', () => {
    it('should return empty log initially', async () => {
      const { status, body } = await getJson(ctx.app, '/api/agent-log')
      expect(status).toBe(200)
      expect(body).toEqual([])
    })

    it('should return log entries after task creation', async () => {
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })

      const { status, body } = await getJson(ctx.app, '/api/agent-log')
      expect(status).toBe(200)
      expect(body.length).toBeGreaterThanOrEqual(1)
      expect(body[0].action).toBe('created')
      expect(body[0].serviceId).toBe(LEAF_SERVICE)
    })

    it('should record state transitions', async () => {
      const task = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.updateTask(task.id, { state: 'IN_PROGRESS' })

      const { body } = await getJson(ctx.app, '/api/agent-log')
      // Most recent first
      expect(body[0].action).toBe('state_changed')
      expect(body[0].fromState).toBe('OPEN')
      expect(body[0].toState).toBe('IN_PROGRESS')
    })

    it('should include reason from context snapshot', async () => {
      const task = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      // Save a reason via metadata snapshot
      ctx.engine.processStore.saveContextSnapshot(task.id, { _reason: 'Test reason for audit' })

      const { body } = await getJson(ctx.app, '/api/agent-log')
      expect(body[0].reason).toBe('Test reason for audit')
    })

    it('should filter by action', async () => {
      const task = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.updateTask(task.id, { state: 'IN_PROGRESS' })
      ctx.engine.tracker.completeTask(task.id)

      const { body } = await getJson(ctx.app, '/api/agent-log?action=completed')
      expect(body.length).toBe(1)
      expect(body[0].action).toBe('completed')
    })

    it('should filter by taskId', async () => {
      const t1 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2' })

      const { body } = await getJson(ctx.app, `/api/agent-log?taskId=${t1.id}`)
      expect(body.every((e: any) => e.taskId === t1.id)).toBe(true)
    })

    it('should support pagination with limit and offset', async () => {
      // Create multiple tasks to generate multiple log entries
      for (let i = 0; i < 5; i++) {
        ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: `o${i}` })
      }

      const { body } = await getJson(ctx.app, '/api/agent-log?limit=2&offset=0')
      expect(body.length).toBe(2)
    })

    it('should record completed and failed actions', async () => {
      const t1 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
      ctx.engine.tracker.completeTask(t1.id)

      const t2 = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o2' })
      ctx.engine.tracker.failTask(t2.id, 'something went wrong')

      const { body } = await getJson(ctx.app, '/api/agent-log')
      const actions = body.map((e: any) => e.action)
      expect(actions).toContain('completed')
      expect(actions).toContain('failed')
    })
  })
})

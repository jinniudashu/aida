import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, type TestContext } from './helpers.js'

describe('Business Goals API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  describe('GET /api/business-goals', () => {
    it('should return empty array when no action plans exist', async () => {
      const { status, body } = await getJson(ctx.app, '/api/business-goals')
      expect(status).toBe(200)
      expect(body).toEqual([])
    })

    it('should return action plans with basic info', async () => {
      const dossier = ctx.engine.dossierStore.getOrCreate('action-plan', 'plan-001')
      ctx.engine.dossierStore.commit(dossier.id, {
        name: 'Q1 Goals',
        description: 'First quarter goals',
        items: [
          { name: 'Launch store A', status: 'pending', dueDate: '2026-03-15' },
          { name: 'Launch store B', status: 'done', dueDate: '2026-03-30' },
        ],
      })

      const { status, body } = await getJson(ctx.app, '/api/business-goals')
      expect(status).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0].planId).toBe('plan-001')
      expect(body[0].name).toBe('Q1 Goals')
      expect(body[0].description).toBe('First quarter goals')
      expect(body[0].items).toHaveLength(2)
    })

    it('should include periodic items', async () => {
      const dossier = ctx.engine.dossierStore.getOrCreate('action-plan', 'plan-002')
      ctx.engine.dossierStore.commit(dossier.id, {
        name: 'Weekly Tasks',
        periodicItems: [
          { name: 'Weekly inventory check', cron: '0 9 * * MON' },
          { name: 'Daily standup', cron: '0 9 * * *' },
        ],
      })

      const { body } = await getJson(ctx.app, '/api/business-goals')
      expect(body[0].periodicItems).toHaveLength(2)
      expect(body[0].periodicItems[0].cron).toBe('0 9 * * MON')
    })

    it('should compute process completion stats', async () => {
      const dossier = ctx.engine.dossierStore.getOrCreate('action-plan', 'plan-003')
      ctx.engine.dossierStore.commit(dossier.id, { name: 'With Processes' })

      // Create related processes
      const t1 = ctx.engine.tracker.createTask({
        serviceId: 'svc-validate-order', entityType: 'action-plan', entityId: 'plan-003',
      })
      ctx.engine.tracker.completeTask(t1.id)

      const t2 = ctx.engine.tracker.createTask({
        serviceId: 'svc-validate-order', entityType: 'action-plan', entityId: 'plan-003',
      })
      // Leave t2 as OPEN

      const { body } = await getJson(ctx.app, '/api/business-goals')
      expect(body[0].processStats.total).toBe(2)
      expect(body[0].processStats.byState['COMPLETED']).toBe(1)
      expect(body[0].processStats.completionRate).toBe(50)
    })

    it('should handle plans with no items gracefully', async () => {
      const dossier = ctx.engine.dossierStore.getOrCreate('action-plan', 'plan-empty')
      ctx.engine.dossierStore.commit(dossier.id, { name: 'Empty Plan' })

      const { body } = await getJson(ctx.app, '/api/business-goals')
      expect(body[0].items).toEqual([])
      expect(body[0].periodicItems).toEqual([])
      expect(body[0].processStats.completionRate).toBe(0)
    })
  })
})

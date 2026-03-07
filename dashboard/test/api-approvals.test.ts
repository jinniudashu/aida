import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, postJson, type TestContext } from './helpers.js'

describe('Approvals API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  function createApproval(id: string, data: Record<string, unknown> = {}) {
    const dossier = ctx.engine.dossierStore.getOrCreate('approval', id)
    ctx.engine.dossierStore.commit(dossier.id, {
      status: 'pending',
      question: `Approve action for ${id}?`,
      requestedBy: 'aida',
      requestedAt: new Date().toISOString(),
      ...data,
    })
    return dossier
  }

  describe('GET /api/approvals', () => {
    it('should return empty array when no approvals exist', async () => {
      const { status, body } = await getJson(ctx.app, '/api/approvals')
      expect(status).toBe(200)
      expect(body).toEqual([])
    })

    it('should return pending approvals by default', async () => {
      createApproval('appr-001')
      createApproval('appr-002')

      const { body } = await getJson(ctx.app, '/api/approvals')
      expect(body).toHaveLength(2)
      expect(body[0].status).toBe('pending')
    })

    it('should include approval details', async () => {
      createApproval('appr-003', {
        question: 'Should we proceed with store expansion?',
        context: { storeCount: 5, budget: 100000 },
        serviceId: 'svc-expansion',
        taskId: 'task-xyz',
      })

      const { body } = await getJson(ctx.app, '/api/approvals')
      expect(body[0].question).toBe('Should we proceed with store expansion?')
      expect(body[0].serviceId).toBe('svc-expansion')
      expect(body[0].taskId).toBe('task-xyz')
      expect(body[0].context).toEqual({ storeCount: 5, budget: 100000 })
    })

    it('should filter by status', async () => {
      createApproval('appr-004')
      createApproval('appr-005', { status: 'approved', decidedBy: 'user' })

      const { body: pending } = await getJson(ctx.app, '/api/approvals?status=pending')
      expect(pending).toHaveLength(1)
      expect(pending[0].approvalId).toBe('appr-004')

      const { body: approved } = await getJson(ctx.app, '/api/approvals?status=approved')
      expect(approved).toHaveLength(1)
      expect(approved[0].approvalId).toBe('appr-005')

      const { body: all } = await getJson(ctx.app, '/api/approvals?status=all')
      expect(all).toHaveLength(2)
    })
  })

  describe('POST /api/approvals/:id/decide', () => {
    it('should approve an approval request', async () => {
      createApproval('appr-010')

      const { status, body } = await postJson(ctx.app, '/api/approvals/appr-010/decide', {
        decision: 'approved',
        decidedBy: 'admin',
        reason: 'Looks good',
      })

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.decision).toBe('approved')

      // Verify the dossier was updated
      const result = ctx.engine.dossierStore.get('approval', 'appr-010')
      expect(result?.data.status).toBe('approved')
      expect(result?.data.decidedBy).toBe('admin')
      expect(result?.data.decisionReason).toBe('Looks good')
    })

    it('should reject an approval request', async () => {
      createApproval('appr-011')

      const { status, body } = await postJson(ctx.app, '/api/approvals/appr-011/decide', {
        decision: 'rejected',
        reason: 'Budget exceeded',
      })

      expect(status).toBe(200)
      expect(body.decision).toBe('rejected')

      const result = ctx.engine.dossierStore.get('approval', 'appr-011')
      expect(result?.data.status).toBe('rejected')
    })

    it('should return 400 for invalid decision', async () => {
      createApproval('appr-012')

      const { status, body } = await postJson(ctx.app, '/api/approvals/appr-012/decide', {
        decision: 'maybe',
      })
      expect(status).toBe(400)
      expect(body.error).toMatch(/invalid decision/i)
    })

    it('should return 400 when decision is missing', async () => {
      createApproval('appr-013')

      const { status } = await postJson(ctx.app, '/api/approvals/appr-013/decide', {})
      expect(status).toBe(400)
    })

    it('should return 404 for nonexistent approval', async () => {
      const { status } = await postJson(ctx.app, '/api/approvals/nonexistent/decide', {
        decision: 'approved',
      })
      expect(status).toBe(404)
    })

    it('should use default decidedBy when not provided', async () => {
      createApproval('appr-014')

      await postJson(ctx.app, '/api/approvals/appr-014/decide', {
        decision: 'approved',
      })

      const result = ctx.engine.dossierStore.get('approval', 'appr-014')
      expect(result?.data.decidedBy).toBe('dashboard-user')
    })
  })
})

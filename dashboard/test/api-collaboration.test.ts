import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, postJson, type TestContext } from './helpers.js'

describe('Collaboration API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('GET /api/collaboration/status returns initial empty state', async () => {
    const { status, body } = await getJson(ctx.app, '/api/collaboration/status')
    expect(status).toBe(200)
    expect(body.pendingCount).toBe(0)
    expect(body.counts.pending).toBe(0)
  })

  it('GET /api/collaboration/tasks returns empty list initially', async () => {
    const { status, body } = await getJson(ctx.app, '/api/collaboration/tasks')
    expect(status).toBe(200)
    expect(body.count).toBe(0)
    expect(body.tasks).toEqual([])
  })

  it('GET /api/collaboration/tasks?status=pending filters correctly', async () => {
    const store = ctx.engine.collaborationStore

    const t1 = store.createTask({ title: 'A', description: 'A' })
    store.createTask({ title: 'B', description: 'B' })
    store.respond(t1.id, { ok: true }, 'user')

    const { body: pendingBody } = await getJson(ctx.app, '/api/collaboration/tasks?status=pending')
    expect(pendingBody.count).toBe(1)
    expect(pendingBody.tasks[0].title).toBe('B')

    const { body: completedBody } = await getJson(ctx.app, '/api/collaboration/tasks?status=completed')
    expect(completedBody.count).toBe(1)
    expect(completedBody.tasks[0].title).toBe('A')
  })

  it('GET /api/collaboration/tasks/:id returns task detail', async () => {
    const store = ctx.engine.collaborationStore
    const task = store.createTask({
      title: 'Treatment form',
      description: 'Confirm dosage',
      inputSchema: { type: 'object', properties: { dosage: { type: 'number' } } },
      priority: 'high',
    })

    const { status, body } = await getJson(ctx.app, `/api/collaboration/tasks/${task.id}`)
    expect(status).toBe(200)
    expect(body.title).toBe('Treatment form')
    expect(body.priority).toBe('high')
    expect(body.inputSchema.properties.dosage.type).toBe('number')
  })

  it('GET /api/collaboration/tasks/:id returns 404 for missing task', async () => {
    const { status } = await getJson(ctx.app, '/api/collaboration/tasks/nonexistent')
    expect(status).toBe(404)
  })

  it('POST /api/collaboration/tasks/:id/respond submits response', async () => {
    const store = ctx.engine.collaborationStore
    const task = store.createTask({ title: 'Approve', description: 'Approve this' })

    const { status, body } = await postJson(
      ctx.app,
      `/api/collaboration/tasks/${task.id}/respond`,
      { data: { approved: true, reason: 'Looks good' }, respondedBy: 'dr-wang' },
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('completed')
    expect(body.task.response.data).toEqual({ approved: true, reason: 'Looks good' })
    expect(body.task.response.respondedBy).toBe('dr-wang')
  })

  it('POST /api/collaboration/tasks/:id/respond defaults respondedBy to dashboard-user', async () => {
    const store = ctx.engine.collaborationStore
    const task = store.createTask({ title: 'Test', description: 'Test' })

    const { body } = await postJson(
      ctx.app,
      `/api/collaboration/tasks/${task.id}/respond`,
      { data: { ok: true } },
    )

    expect(body.task.response.respondedBy).toBe('dashboard-user')
  })

  it('POST /api/collaboration/tasks/:id/respond rejects missing data', async () => {
    const store = ctx.engine.collaborationStore
    const task = store.createTask({ title: 'Test', description: 'Test' })

    const { status } = await postJson(
      ctx.app,
      `/api/collaboration/tasks/${task.id}/respond`,
      { respondedBy: 'user' },
    )
    expect(status).toBe(400)
  })

  it('POST /api/collaboration/tasks/:id/respond rejects double-respond', async () => {
    const store = ctx.engine.collaborationStore
    const task = store.createTask({ title: 'Test', description: 'Test' })
    store.respond(task.id, { ok: true }, 'user')

    const { status } = await postJson(
      ctx.app,
      `/api/collaboration/tasks/${task.id}/respond`,
      { data: { ok: false } },
    )
    expect(status).toBe(400)
  })

  it('POST /api/collaboration/tasks/:id/cancel cancels a task', async () => {
    const store = ctx.engine.collaborationStore
    const task = store.createTask({ title: 'Cancel me', description: 'Cancel' })

    const { status, body } = await postJson(
      ctx.app,
      `/api/collaboration/tasks/${task.id}/cancel`,
      {},
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)

    const retrieved = store.getTask(task.id)
    expect(retrieved!.status).toBe('cancelled')
  })

  it('GET /api/collaboration/status reflects task counts', async () => {
    const store = ctx.engine.collaborationStore
    store.createTask({ title: 'A', description: 'A', priority: 'urgent' })
    store.createTask({ title: 'B', description: 'B' })
    const c = store.createTask({ title: 'C', description: 'C' })
    store.respond(c.id, { done: true }, 'user')

    const { body } = await getJson(ctx.app, '/api/collaboration/status')
    expect(body.pendingCount).toBe(2)
    expect(body.counts.pending).toBe(2)
    expect(body.counts.completed).toBe(1)
  })
})

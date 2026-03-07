import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, type TestContext } from './helpers.js'

// Use leaf service to avoid rule-triggered child process creation
const LEAF_SERVICE = 'svc-validate-order'

describe('GET /api/events (SSE)', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should respond with text/event-stream content type', async () => {
    const res = await ctx.app.request('/api/events')
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
  })

  it('should emit process:created event when process is created', async () => {
    const events = await collectSSEEvents(ctx, async () => {
      ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
    })
    const created = events.find(e => e.event === 'process:created')
    expect(created).toBeDefined()
    expect(created!.data.serviceId).toBe(LEAF_SERVICE)
  })

  it('should emit process:state_changed on transition', async () => {
    const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })

    const events = await collectSSEEvents(ctx, async () => {
      ctx.engine.tracker.updateTask(p.id, { state: 'IN_PROGRESS' })
    })
    const changed = events.find(e => e.event === 'process:state_changed')
    expect(changed).toBeDefined()
  })

  it('should emit process:state_changed to FAILED on error transition', async () => {
    const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })

    const events = await collectSSEEvents(ctx, async () => {
      ctx.engine.tracker.updateTask(p.id, { state: 'FAILED' })
    })
    // updateTask emits process:state_changed (not process:error)
    const changed = events.find(e => e.event === 'process:state_changed' && e.data.to === 'FAILED')
    expect(changed).toBeDefined()
  })

  it('should emit process:completed on COMPLETED transition', async () => {
    const p = ctx.engine.tracker.createTask({ serviceId: LEAF_SERVICE, entityType: 'order', entityId: 'o1' })
    ctx.engine.tracker.updateTask(p.id, { state: 'IN_PROGRESS' })

    const events = await collectSSEEvents(ctx, async () => {
      // completeTask() emits process:completed; updateTask only emits process:state_changed
      ctx.engine.tracker.completeTask(p.id)
    })
    const completed = events.find(e => e.event === 'process:completed')
    expect(completed).toBeDefined()
  })
})

/**
 * Helper: Start SSE stream, execute action, collect events, then cancel stream.
 */
async function collectSSEEvents(
  ctx: TestContext,
  action: () => Promise<void>,
): Promise<Array<{ event: string; data: any }>> {
  const res = await ctx.app.request('/api/events')
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const events: Array<{ event: string; data: any }> = []

  // Perform the action that should trigger events
  await action()

  // Give a tick for events to flush
  await new Promise(r => setTimeout(r, 50))

  // Read available chunks
  const readWithTimeout = async () => {
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), 100),
    )
    return Promise.race([reader.read(), timeoutPromise])
  }

  let chunk = await readWithTimeout()
  while (!chunk.done) {
    const text = decoder.decode(chunk.value, { stream: true })
    // Parse SSE format: "event: xxx\ndata: yyy\n\n"
    const blocks = text.split('\n\n').filter(Boolean)
    for (const block of blocks) {
      const lines = block.split('\n')
      let event = ''
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) data = line.slice(5).trim()
      }
      if (event && event !== 'heartbeat') {
        try {
          events.push({ event, data: JSON.parse(data) })
        } catch {
          events.push({ event, data })
        }
      }
    }
    chunk = await readWithTimeout()
  }

  reader.cancel()
  return events
}

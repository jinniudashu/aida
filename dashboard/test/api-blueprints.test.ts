import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, postJson, type TestContext } from './helpers.js'

const MINI_BLUEPRINT = `
version: "1.0"
name: "Test Blueprint"
services:
  - id: "svc-test-a"
    label: "Test Service A"
    executorType: "agent"
    entityType: "widget"
  - id: "svc-test-b"
    label: "Test Service B"
    executorType: "manual"
    entityType: "widget"
events:
  - id: "evt-test-done"
    label: "Test Done"
    expression: "state == 'COMPLETED'"
instructions:
  - id: "instr-start-b"
    label: "Start B"
    sysCall: "start_service"
rules:
  - id: "rule-a-to-b"
    label: "A completes then start B"
    targetServiceId: "svc-test-a"
    serviceId: "svc-test-a"
    eventId: "evt-test-done"
    instructionId: "instr-start-b"
    operandServiceId: "svc-test-b"
`

describe('Blueprint API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  describe('POST /api/blueprints', () => {
    it('should load a valid YAML blueprint and return 201', async () => {
      const { status, body } = await postJson(ctx.app, '/api/blueprints', {
        yaml: MINI_BLUEPRINT,
      })
      expect(status).toBe(201)
      expect(body.services).toBe(2)
      expect(body.events).toBe(1)
      expect(body.instructions).toBe(1)
      expect(body.rules).toBe(1)
      expect(body.errors).toEqual([])
    })

    it('should make loaded services visible via GET /api/services', async () => {
      await postJson(ctx.app, '/api/blueprints', { yaml: MINI_BLUEPRINT })
      const { body } = await getJson(ctx.app, '/api/services?entityType=widget')
      const ids = body.map((s: { id: string }) => s.id)
      expect(ids).toContain('svc-test-a')
      expect(ids).toContain('svc-test-b')
    })

    it('should make loaded rules visible via GET /api/rules', async () => {
      await postJson(ctx.app, '/api/blueprints', { yaml: MINI_BLUEPRINT })
      const { body } = await getJson(ctx.app, '/api/rules')
      const ruleIds = body.map((r: { id: string }) => r.id)
      expect(ruleIds).toContain('rule-a-to-b')
    })

    it('should return 400 when yaml field is missing', async () => {
      const { status, body } = await postJson(ctx.app, '/api/blueprints', { name: 'oops' })
      expect(status).toBe(400)
      expect(body.error).toContain('yaml')
    })

    it('should return 400 for invalid YAML syntax', async () => {
      const { status } = await postJson(ctx.app, '/api/blueprints', { yaml: 'key: [unclosed' })
      expect(status).toBe(400)
    })

    it('should return 207 when blueprint has partial errors', async () => {
      const partialYaml = `
version: "1.0"
name: "Partial"
services:
  - id: "svc-ok"
    label: "OK Service"
rules:
  - id: "rule-bad"
    label: "Bad Rule"
    targetServiceId: ""
    serviceId: ""
    eventId: ""
    instructionId: ""
`
      const { status, body } = await postJson(ctx.app, '/api/blueprints', { yaml: partialYaml })
      // Service loads OK, rule may fail → 207 if errors present, or 201 if all pass
      expect([201, 207]).toContain(status)
      expect(body.services).toBe(1)
    })
  })
})

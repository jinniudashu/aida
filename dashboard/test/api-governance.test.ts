import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext, getJson, postJson, type TestContext } from './helpers.js'

describe('Governance API', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('GET /api/governance/status returns initial state', async () => {
    const { status, body } = await getJson(ctx.app, '/api/governance/status')
    expect(status).toBe(200)
    expect(body.circuitBreaker.state).toBe('NORMAL')
    expect(body.constraintCount).toBe(0)
    expect(body.pendingApprovalCount).toBe(0)
    expect(body.recentViolations).toEqual([])
  })

  it('GET /api/governance/status reflects loaded constraints', async () => {
    ctx.governanceStore.loadConstraints([{
      id: 'test-c1',
      policyId: 'test-policy',
      label: 'Test constraint',
      scope: { tools: ['bps_update_entity'] },
      condition: 'hour >= 9',
      onViolation: 'BLOCK',
      severity: 'HIGH',
      message: 'Not allowed',
    }])

    const { body } = await getJson(ctx.app, '/api/governance/status')
    expect(body.constraintCount).toBe(1)
  })

  it('GET /api/governance/status reflects violations', async () => {
    ctx.governanceStore.recordViolation({
      constraintId: 'c1',
      policyId: 'p1',
      severity: 'HIGH',
      tool: 'bps_update_entity',
      verdict: 'BLOCK',
      condition: 'hour >= 9',
      evalContext: { hour: 3 },
      message: 'Blocked: outside hours',
      circuitBreakerState: 'NORMAL',
    })

    const { body } = await getJson(ctx.app, '/api/governance/status')
    expect(body.recentViolations.length).toBe(1)
    expect(body.recentViolations[0].severity).toBe('HIGH')
    expect(body.recentViolations[0].message).toBe('Blocked: outside hours')
  })

  it('GET /api/governance/violations returns violation list', async () => {
    ctx.governanceStore.recordViolation({
      constraintId: 'c1',
      policyId: 'p1',
      severity: 'CRITICAL',
      tool: 'bps_create_task',
      verdict: 'BLOCK',
      condition: 'weekday != 0',
      evalContext: { weekday: 0 },
      message: 'No work on Sundays',
      circuitBreakerState: 'NORMAL',
    })

    const { status, body } = await getJson(ctx.app, '/api/governance/violations')
    expect(status).toBe(200)
    expect(body.length).toBe(1)
    expect(body[0].severity).toBe('CRITICAL')
    expect(body[0].tool).toBe('bps_create_task')
    expect(body[0].condition).toBe('weekday != 0')
  })

  it('GET /api/governance/violations respects limit param', async () => {
    for (let i = 0; i < 5; i++) {
      ctx.governanceStore.recordViolation({
        constraintId: `c${i}`,
        policyId: 'p1',
        severity: 'HIGH',
        tool: 'bps_update_entity',
        verdict: 'BLOCK',
        condition: 'true',
        evalContext: {},
        message: `Violation ${i}`,
        circuitBreakerState: 'NORMAL',
      })
    }

    const { body } = await getJson(ctx.app, '/api/governance/violations?limit=3')
    expect(body.length).toBe(3)
  })

  it('GET /api/governance/constraints returns constraint list', async () => {
    ctx.governanceStore.loadConstraints([
      {
        id: 'c-test-1', policyId: 'p1', label: 'Test 1',
        scope: { tools: ['bps_update_entity'], entityTypes: ['store'], dataFields: ['address'] },
        condition: 'lifecycle != "ACTIVE"', onViolation: 'REQUIRE_APPROVAL', severity: 'HIGH', message: 'Needs approval',
      },
      {
        id: 'c-test-2', policyId: 'p2', label: 'Test 2',
        scope: { tools: ['bps_create_task'] },
        condition: 'hour >= 7', onViolation: 'BLOCK', severity: 'MEDIUM', message: 'Off hours',
      },
    ])

    const { status, body } = await getJson(ctx.app, '/api/governance/constraints')
    expect(status).toBe(200)
    expect(body.length).toBe(2)
    expect(body[0].id).toBe('c-test-1')
    expect(body[0].scope.entityTypes).toEqual(['store'])
    expect(body[1].onViolation).toBe('BLOCK')
  })

  it('GET /api/governance/approvals returns pending approvals', async () => {
    ctx.governanceStore.createApproval({
      constraintId: 'c1', tool: 'bps_update_entity',
      toolInput: { entityType: 'store', entityId: 's1', data: { address: 'new' } },
      entityType: 'store', entityId: 's1',
      message: 'Store update needs approval',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    })

    const { status, body } = await getJson(ctx.app, '/api/governance/approvals')
    expect(status).toBe(200)
    expect(body.length).toBe(1)
    expect(body[0].constraintId).toBe('c1')
    expect(body[0].status).toBe('PENDING')
    expect(body[0].toolInput.entityType).toBe('store')
  })

  it('POST /api/governance/approvals/:id/decide approves and executes the operation', async () => {
    const approval = ctx.governanceStore.createApproval({
      constraintId: 'c1', tool: 'bps_update_entity',
      toolInput: { entityType: 'store', entityId: 'replay-test', data: { name: 'Replay Store' } },
      message: 'Needs approval',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    })

    const { status, body } = await postJson(ctx.app, `/api/governance/approvals/${approval.id}/decide`, {
      decision: 'APPROVED', decidedBy: 'test-user',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.decision).toBe('APPROVED')
    // Verify the operation was actually executed
    expect(body.executionResult).toBeDefined()
    expect(body.executionResult.success).toBe(true)
    expect(body.executionResult.tool).toBe('bps_update_entity')

    // Verify the entity was created in the store
    const entity = ctx.engine.dossierStore.get('store', 'replay-test')
    expect(entity).toBeDefined()
    expect(entity!.data.name).toBe('Replay Store')

    // Verify no longer pending
    const { body: pending } = await getJson(ctx.app, '/api/governance/approvals')
    expect(pending.length).toBe(0)
  })

  it('POST /api/governance/approvals/:id/decide rejection does not execute', async () => {
    const approval = ctx.governanceStore.createApproval({
      constraintId: 'c1', tool: 'bps_update_entity',
      toolInput: { entityType: 'store', entityId: 'reject-test', data: { name: 'Should Not Exist' } },
      message: 'Needs approval',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    })

    const { status, body } = await postJson(ctx.app, `/api/governance/approvals/${approval.id}/decide`, {
      decision: 'REJECTED', decidedBy: 'test-user',
    })
    expect(status).toBe(200)
    expect(body.decision).toBe('REJECTED')
    expect(body.executionResult).toBeNull()

    // Verify the entity was NOT created
    const entity = ctx.engine.dossierStore.get('store', 'reject-test')
    expect(entity).toBeNull()
  })

  it('POST /api/governance/approvals/:id/decide rejects invalid decision', async () => {
    const { status } = await postJson(ctx.app, '/api/governance/approvals/fake-id/decide', {
      decision: 'INVALID',
    })
    expect(status).toBe(400)
  })

  it('POST /api/governance/circuit-breaker/reset resets to NORMAL', async () => {
    // Push circuit breaker to non-normal state
    ctx.governanceStore.updateCircuitBreaker('RESTRICTED', { critical: 0, high: 5, windowStart: new Date().toISOString() })
    expect(ctx.governanceStore.getCircuitBreakerState().state).toBe('RESTRICTED')

    const { status, body } = await postJson(ctx.app, '/api/governance/circuit-breaker/reset', {})
    expect(status).toBe(200)
    expect(body.state).toBe('NORMAL')
    expect(ctx.governanceStore.getCircuitBreakerState().state).toBe('NORMAL')
  })
})

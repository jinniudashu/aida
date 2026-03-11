import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { type BpsEngine, GovernanceStore, loadBlueprintFromString, loadGovernanceFromString } from '../../src/index.js'
import { engine, governanceStore as defaultGovernanceStore } from './engine.js'

/**
 * Replay a previously governance-blocked tool call directly on the engine.
 * Called after a human approves the operation in the Dashboard.
 */
function replayToolCall(
  engine: BpsEngine,
  tool: string,
  toolInput: Record<string, unknown>,
  opts?: { governanceStore?: GovernanceStore },
): Record<string, unknown> {
  switch (tool) {
    case 'bps_update_entity': {
      const { entityType, entityId, data, message } = toolInput as {
        entityType: string; entityId: string; data: Record<string, unknown>; message?: string
      }
      const dossier = engine.dossierStore.getOrCreate(entityType, entityId)
      const version = engine.dossierStore.commit(dossier.id, data, { message: message ?? 'Approved via governance' })

      // Two-stage publish: promote drafts from mock-publish-tmp/ to mock-publish/
      let promotedFiles: string[] = []
      if (data && (data.publishReady === true || data.publishReady === 1 || data.publishReady === '1')) {
        const aidaHome = path.join(os.homedir(), '.aida')
        const tmpDir = path.join(aidaHome, 'mock-publish-tmp')
        const pubDir = path.join(aidaHome, 'mock-publish')
        if (fs.existsSync(tmpDir)) {
          for (const sub of fs.readdirSync(tmpDir)) {
            const srcSub = path.join(tmpDir, sub)
            if (!fs.statSync(srcSub).isDirectory()) continue
            const dstSub = path.join(pubDir, sub)
            fs.mkdirSync(dstSub, { recursive: true })
            for (const file of fs.readdirSync(srcSub)) {
              const src = path.join(srcSub, file)
              if (!fs.statSync(src).isFile()) continue
              const dst = path.join(dstSub, file)
              fs.copyFileSync(src, dst)
              fs.unlinkSync(src)
              promotedFiles.push(path.join(sub, file))
            }
          }
        }
      }

      return { success: true, tool, dossierId: dossier.id, version: version.version, promotedFiles }
    }
    case 'bps_create_task': {
      const { serviceId, entityType, entityId, operatorId, metadata } = toolInput as {
        serviceId: string; entityType?: string; entityId?: string; operatorId?: string; metadata?: Record<string, unknown>
      }
      const task = engine.tracker.createTask({ serviceId, entityType, entityId, operatorId, metadata })
      return { success: true, tool, taskId: task.id, pid: task.pid, state: task.state }
    }
    case 'bps_update_task': {
      const { taskId, state, metadata } = toolInput as {
        taskId: string; state?: string; metadata?: Record<string, unknown>
      }
      const updated = engine.tracker.updateTask(taskId, { state, metadata })
      return { success: true, tool, taskId, currentState: updated.state }
    }
    case 'bps_complete_task': {
      const { taskId, result } = toolInput as { taskId: string; result?: unknown }
      const completed = engine.tracker.completeTask(taskId, result)
      return { success: true, tool, taskId, finalState: completed.state }
    }
    case 'bps_create_skill': {
      const { name, description, body } = toolInput as { name: string; description: string; body: string }
      const skillsDir = path.join(os.homedir(), '.openclaw', 'workspace', 'skills')
      const skillDir = path.join(skillsDir, name)
      const skillPath = path.join(skillDir, 'SKILL.md')
      if (fs.existsSync(skillPath)) {
        return { success: false, tool, error: `Skill "${name}" already exists` }
      }
      const content = ['---', `name: ${name}`, `description: ${description}`, '---', body].join('\n')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(skillPath, content, 'utf-8')
      return { success: true, tool, name, path: skillPath }
    }
    case 'bps_load_blueprint': {
      const { yaml, persist } = toolInput as { yaml: string; persist?: boolean }
      if (!yaml) return { success: false, tool, error: 'Missing yaml content' }
      const loadResult = loadBlueprintFromString(yaml, engine.blueprintStore)
      if (loadResult.errors.length > 0) {
        return { success: false, tool, errors: loadResult.errors }
      }
      if (persist !== false && loadResult.services > 0) {
        const blueprintsDir = path.join(os.homedir(), '.aida', 'blueprints')
        fs.mkdirSync(blueprintsDir, { recursive: true })
        const name = `approved-${Date.now()}.yaml`
        fs.writeFileSync(path.join(blueprintsDir, name), yaml, 'utf-8')
      }
      return { success: true, tool, services: loadResult.services, rules: loadResult.rules }
    }
    case 'bps_register_agent': {
      // Agent registration is complex (writes workspace + edits openclaw.json).
      // After approval, the agent should retry the tool call directly.
      return { success: true, tool, note: 'Agent registration approved. The agent should retry bps_register_agent.' }
    }
    case 'bps_load_governance': {
      const govStore = opts?.governanceStore
      if (!govStore) return { success: false, tool, error: 'Governance store not available' }
      const { yaml: govYaml } = toolInput as { yaml?: string }
      if (!govYaml) {
        // Reload from file
        const govPath = path.join(os.homedir(), '.aida', 'governance.yaml')
        if (!fs.existsSync(govPath)) return { success: false, tool, error: 'governance.yaml not found' }
        const content = fs.readFileSync(govPath, 'utf-8')
        const parsed = loadGovernanceFromString(content)
        if (parsed.errors.length > 0) return { success: false, tool, errors: parsed.errors }
        const count = govStore.loadConstraints(parsed.constraints)
        return { success: true, tool, constraintsLoaded: count }
      }
      const parsed = loadGovernanceFromString(govYaml)
      if (parsed.errors.length > 0) return { success: false, tool, errors: parsed.errors }
      const count = govStore.loadConstraints(parsed.constraints)
      return { success: true, tool, constraintsLoaded: count }
    }
    default:
      return { success: false, error: `Unknown tool: ${tool}` }
  }
}

export function createApp(engine: BpsEngine, opts?: { governanceStore?: GovernanceStore }): Hono {

const governanceStore = opts?.governanceStore ?? defaultGovernanceStore

const app = new Hono()

app.use('/*', cors())

// --- SSE endpoint ---

app.get('/api/events', (c) => {
  return streamSSE(c, async (stream) => {
    const tracker = engine.tracker

    const listeners: Array<{ event: string; fn: (...args: any[]) => void }> = []

    function relay(event: string) {
      const fn = (payload: unknown) => {
        stream.writeSSE({ event, data: JSON.stringify(payload) }).catch(() => {})
      }
      tracker.on(event, fn)
      listeners.push({ event, fn })
    }

    relay('process:created')
    relay('process:state_changed')
    relay('process:completed')
    relay('process:error')
    relay('dossier:committed')

    // Governance events
    function relayGov(event: string) {
      const fn = (payload: unknown) => {
        stream.writeSSE({ event, data: JSON.stringify(payload) }).catch(() => {})
      }
      governanceStore.on(event, fn)
      listeners.push({ event, fn })
    }

    relayGov('governance:violation')
    relayGov('governance:approval_created')
    relayGov('governance:approval_decided')
    relayGov('governance:circuit_breaker_changed')

    stream.onAbort(() => {
      for (const { event, fn } of listeners) {
        tracker.removeListener(event, fn)
        governanceStore.removeListener(event, fn)
      }
    })

    // Heartbeat loop — keeps connection alive
    while (!stream.aborted) {
      await stream.writeSSE({ event: 'heartbeat', data: '' })
      await stream.sleep(30_000)
    }
  })
})

// --- GET routes ---

app.get('/api/overview', (c) => {
  try {
    return c.json(engine.dashboardQuery.getOverview())
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/kanban', (c) => {
  try {
    const filter: Record<string, unknown> = {}
    const serviceId = c.req.query('serviceId')
    const entityType = c.req.query('entityType')
    if (serviceId) filter.serviceId = serviceId
    if (entityType) filter.entityType = entityType
    const columns = engine.dashboardQuery.getProcessKanban(filter) as Array<{ state: string; processes: Array<Record<string, unknown>>; count: number }>

    // Build operator id→label map
    const opRows = engine.db.prepare(`SELECT id, label FROM bps_operators`).all() as Array<{ id: string; label: string }>
    const opMap = new Map(opRows.map(o => [o.id, o.label]))

    for (const col of columns) {
      for (const proc of col.processes) {
        proc.operatorLabel = proc.operatorId ? (opMap.get(proc.operatorId as string) ?? undefined) : undefined
      }
    }

    return c.json(columns)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/processes', (c) => {
  try {
    const filter: Record<string, unknown> = {}
    const state = c.req.query('state')
    const serviceId = c.req.query('serviceId')
    const entityType = c.req.query('entityType')
    const entityId = c.req.query('entityId')
    const limit = c.req.query('limit')
    const offset = c.req.query('offset')
    if (state) filter.state = state
    if (serviceId) filter.serviceId = serviceId
    if (entityType) filter.entityType = entityType
    if (entityId) filter.entityId = entityId
    if (limit) filter.limit = Number(limit)
    if (offset) filter.offset = Number(offset)
    return c.json(engine.processStore.query(filter))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/processes/:id', (c) => {
  try {
    const detail = engine.dashboardQuery.getProcessDetail(c.req.param('id'))
    if (!detail) return c.json({ error: 'Process not found' }, 404)
    return c.json(detail)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/processes/:id/tree', (c) => {
  try {
    const tree = engine.processStore.getProcessTree(c.req.param('id'))
    if (!tree) return c.json({ error: 'Process not found' }, 404)
    return c.json(tree)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/entities', (c) => {
  try {
    const opts: Record<string, unknown> = {}
    const entityType = c.req.query('entityType')
    const lifecycle = c.req.query('lifecycle')
    const limit = c.req.query('limit')
    const offset = c.req.query('offset')
    if (entityType) opts.entityType = entityType
    if (lifecycle) opts.lifecycle = lifecycle
    if (limit) opts.limit = Number(limit)
    if (offset) opts.offset = Number(offset)
    const results = engine.dossierStore.search(opts)
    return c.json(results.map(r => ({
      entityType: r.dossier.entityType,
      entityId: r.dossier.entityId,
      lifecycle: r.dossier.lifecycle,
      currentVersion: r.dossier.currentVersion,
      createdAt: r.dossier.createdAt,
      updatedAt: r.dossier.updatedAt,
      dossier: r.dossier,
      data: r.data,
    })))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/entities/:id', (c) => {
  try {
    const detail = engine.dashboardQuery.getEntityDetail(c.req.param('id'))
    if (!detail) return c.json({ error: 'Entity not found' }, 404)
    return c.json(detail)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/services', (c) => {
  try {
    const filter: Record<string, unknown> = {}
    const entityType = c.req.query('entityType')
    const status = c.req.query('status')
    if (entityType) filter.entityType = entityType
    if (status) filter.status = status
    return c.json(engine.blueprintStore.listServices(filter))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// --- Phase 3: Advanced view endpoints ---

app.get('/api/rules', (c) => {
  try {
    const targetServiceId = c.req.query('targetServiceId')
    let sql = `
      SELECT r.id, r.label, r.name, r.status, r.target_service_id, r."order",
             r.service_id, r.event_id, r.instruction_id, r.operand_service_id,
             e.label AS event_label, e.expression AS event_expression,
             e.evaluation_mode AS event_evaluation_mode,
             i.sys_call AS instruction_sys_call,
             s1.label AS service_label, s1.service_type, s1.executor_type,
             s2.label AS operand_service_label, s2.service_type AS operand_service_type,
             s2.executor_type AS operand_executor_type
      FROM bps_service_rules r
      LEFT JOIN bps_events e ON r.event_id = e.id
      LEFT JOIN bps_instructions i ON r.instruction_id = i.id
      LEFT JOIN bps_services s1 ON r.service_id = s1.id
      LEFT JOIN bps_services s2 ON r.operand_service_id = s2.id
      WHERE r.status = 'active'
    `
    const params: string[] = []
    if (targetServiceId) {
      sql += ` AND r.target_service_id = ?`
      params.push(targetServiceId)
    }
    sql += ` ORDER BY r.target_service_id, r."order" ASC`

    const rows = engine.db.prepare(sql).all(...params) as Record<string, unknown>[]
    const result = rows.map(r => ({
      id: r.id,
      label: r.label,
      targetServiceId: r.target_service_id,
      order: r.order,
      serviceId: r.service_id,
      serviceLabel: r.service_label,
      serviceType: r.service_type,
      executorType: r.executor_type,
      eventId: r.event_id,
      eventLabel: r.event_label,
      eventExpression: r.event_expression,
      instructionId: r.instruction_id,
      sysCall: r.instruction_sys_call ?? null,
      evaluationMode: r.event_evaluation_mode ?? 'deterministic',
      operandServiceId: r.operand_service_id,
      operandServiceLabel: r.operand_service_label,
      operandServiceType: r.operand_service_type,
      operandExecutorType: r.operand_executor_type,
    }))
    return c.json(result)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/operators/workload', (c) => {
  try {
    // Summary: count by operator + state
    const summaryRows = engine.db.prepare(`
      SELECT p.operator_id, p.state, COUNT(*) AS count
      FROM bps_processes p
      WHERE p.operator_id IS NOT NULL
      GROUP BY p.operator_id, p.state
    `).all() as Array<{ operator_id: string; state: string; count: number }>

    // Get operator labels
    const opRows = engine.db.prepare(`
      SELECT id, label, name FROM bps_operators
    `).all() as Array<{ id: string; label: string; name: string }>
    const opMap = new Map(opRows.map(o => [o.id, o]))

    // Build per-operator summaries
    const opSummaryMap = new Map<string, { operatorId: string; label: string; byState: Record<string, number>; total: number; active: number }>()
    for (const row of summaryRows) {
      if (!opSummaryMap.has(row.operator_id)) {
        const op = opMap.get(row.operator_id)
        opSummaryMap.set(row.operator_id, {
          operatorId: row.operator_id,
          label: op?.label ?? row.operator_id,
          byState: {},
          total: 0,
          active: 0,
        })
      }
      const entry = opSummaryMap.get(row.operator_id)!
      entry.byState[row.state] = row.count
      entry.total += row.count
      if (row.state === 'IN_PROGRESS' || row.state === 'BLOCKED') {
        entry.active += row.count
      }
    }

    // Timeline: all processes with operators
    const timelineRows = engine.db.prepare(`
      SELECT p.id, p.pid, p.service_id, p.state, p.operator_id, p.start_time, p.end_time, p.created_at, p.entity_type, p.entity_id
      FROM bps_processes p
      WHERE p.operator_id IS NOT NULL
      ORDER BY p.operator_id, p.created_at
    `).all() as Array<Record<string, unknown>>
    const timeline = timelineRows.map(r => ({
      id: r.id,
      pid: r.pid,
      serviceId: r.service_id,
      state: r.state,
      operatorId: r.operator_id,
      startTime: r.start_time,
      endTime: r.end_time,
      createdAt: r.created_at,
      entityType: r.entity_type,
      entityId: r.entity_id,
    }))

    return c.json({
      operators: [...opSummaryMap.values()],
      timeline,
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/entity-network', (c) => {
  try {
    const entityType = c.req.query('entityType')

    // Nodes: all dossiers
    let dossierSql = `SELECT id, entity_type, entity_id, lifecycle, current_version, created_at, updated_at FROM bps_dossiers`
    const dossierParams: string[] = []
    if (entityType) {
      dossierSql += ` WHERE entity_type = ?`
      dossierParams.push(entityType)
    }
    const dossierRows = engine.db.prepare(dossierSql).all(...dossierParams) as Array<Record<string, unknown>>
    const nodes = dossierRows.map(d => ({
      id: d.id as string,
      entityType: d.entity_type as string,
      entityId: d.entity_id as string,
      lifecycle: d.lifecycle as string,
    }))

    const entityIdToDossierId = new Map<string, string>()
    for (const n of nodes) entityIdToDossierId.set(n.entityId, n.id)

    // Edges from data references: parse latest dossier version data for *Id fields
    const edges: Array<{ source: string; target: string; relation: string }> = []
    const edgeSet = new Set<string>()

    for (const node of nodes) {
      const versionRow = engine.db.prepare(`
        SELECT data FROM bps_dossier_versions WHERE dossier_id = ? ORDER BY version DESC LIMIT 1
      `).get(node.id) as { data: string } | undefined
      if (!versionRow) continue
      try {
        const data = JSON.parse(versionRow.data) as Record<string, unknown>
        for (const [key, val] of Object.entries(data)) {
          if (key.endsWith('Id') && typeof val === 'string' && entityIdToDossierId.has(val)) {
            const targetDossierId = entityIdToDossierId.get(val)!
            if (targetDossierId === node.id) continue
            const edgeKey = `${node.id}->${targetDossierId}:${key}`
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey)
              edges.push({ source: node.id, target: targetDossierId, relation: key })
            }
          }
        }
      } catch { /* skip unparseable */ }
    }

    // Edges from shared processes: entities linked through parent/child processes
    const processRows = engine.db.prepare(`
      SELECT p1.entity_id AS entity1, p2.entity_id AS entity2
      FROM bps_processes p1
      JOIN bps_processes p2 ON p1.parent_id = p2.id
      WHERE p1.entity_id IS NOT NULL AND p2.entity_id IS NOT NULL AND p1.entity_id != p2.entity_id
    `).all() as Array<{ entity1: string; entity2: string }>
    for (const row of processRows) {
      const src = entityIdToDossierId.get(row.entity1)
      const tgt = entityIdToDossierId.get(row.entity2)
      if (src && tgt) {
        const edgeKey = `${src}->${tgt}:process`
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edges.push({ source: src, target: tgt, relation: 'process' })
        }
      }
    }

    return c.json({ nodes, edges })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/alerts', (c) => {
  try {
    const alerts: Array<{ id: string; severity: 'critical' | 'warning' | 'info'; type: string; message: string }> = []

    // L1 Rule 1: Error process count
    const errorRow = engine.db.prepare(`SELECT COUNT(*) AS cnt FROM bps_processes WHERE state = 'FAILED'`).get() as { cnt: number }
    if (errorRow.cnt > 5) {
      alerts.push({ id: 'l1-error-critical', severity: 'critical', type: 'threshold', message: `${errorRow.cnt} processes in FAILED state (threshold: 5)` })
    } else if (errorRow.cnt > 0) {
      alerts.push({ id: 'l1-error-warning', severity: 'warning', type: 'threshold', message: `${errorRow.cnt} process(es) in FAILED state` })
    }

    // L1 Rule 2: Stale entities (not updated in 7 days)
    const staleDate = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const staleRows = engine.db.prepare(`SELECT entity_type, entity_id FROM bps_dossiers WHERE updated_at < ?`).all(staleDate) as Array<{ entity_type: string; entity_id: string }>
    if (staleRows.length > 0) {
      alerts.push({ id: 'l1-stale-entities', severity: 'warning', type: 'threshold', message: `${staleRows.length} entity/entities not updated in 7+ days` })
    }

    // L1 Rule 3: Overloaded operators (>10 RUNNING processes)
    const overloadRows = engine.db.prepare(`
      SELECT o.label, p.operator_id, COUNT(*) AS cnt
      FROM bps_processes p
      LEFT JOIN bps_operators o ON p.operator_id = o.id
      WHERE p.state = 'RUNNING' AND p.operator_id IS NOT NULL
      GROUP BY p.operator_id
      HAVING cnt > 10
    `).all() as Array<{ label: string; operator_id: string; cnt: number }>
    for (const row of overloadRows) {
      alerts.push({ id: `l1-overload-${row.operator_id}`, severity: 'warning', type: 'threshold', message: `Operator "${row.label || row.operator_id}" has ${row.cnt} running processes (threshold: 10)` })
    }

    // L2: Dynamic baseline alerts (mean + 2σ on 7-day timeseries)
    const l2Metrics = ['process.error', 'dashboard.process.created']
    const today = new Date().toISOString().slice(0, 10)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)

    for (const metric of l2Metrics) {
      const rows = engine.db.prepare(`
        SELECT bucket, count FROM bps_stats_timeseries
        WHERE metric = ? AND interval = 'day' AND bucket >= ? AND bucket <= ?
        ORDER BY bucket
      `).all(metric, sevenDaysAgo, today) as Array<{ bucket: string; count: number }>

      if (rows.length < 3) continue // need enough data

      // Separate today's value from historical
      const todayRow = rows.find(r => r.bucket === today)
      const historical = rows.filter(r => r.bucket !== today)
      if (!todayRow || historical.length < 2) continue

      const mean = historical.reduce((s, r) => s + r.count, 0) / historical.length
      const variance = historical.reduce((s, r) => s + (r.count - mean) ** 2, 0) / historical.length
      const stddev = Math.sqrt(variance)
      const threshold = mean + 2 * stddev

      if (todayRow.count > threshold && threshold > 0) {
        const label = metric === 'process.error' ? 'Error count' : 'Process creation count'
        alerts.push({
          id: `l2-baseline-${metric}`,
          severity: 'warning',
          type: 'baseline',
          message: `${label} today (${todayRow.count}) exceeds baseline (mean=${mean.toFixed(1)}, threshold=${threshold.toFixed(1)})`,
        })
      }
    }

    return c.json(alerts)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/services/activity', (c) => {
  try {
    const rows = engine.db.prepare(`
      SELECT service_id, state, COUNT(*) AS count
      FROM bps_processes
      WHERE state NOT IN ('COMPLETED')
      GROUP BY service_id, state
    `).all() as Array<{ service_id: string; state: string; count: number }>

    const result: Record<string, Record<string, number>> = {}
    for (const row of rows) {
      if (!result[row.service_id]) result[row.service_id] = {}
      result[row.service_id][row.state] = row.count
    }
    return c.json(result)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/stats/timeseries', (c) => {
  try {
    const metric = c.req.query('metric')
    const interval = c.req.query('interval') as 'hour' | 'day' | 'week'
    const from = c.req.query('from')
    const to = c.req.query('to')
    if (!metric || !interval || !from || !to) {
      return c.json({ error: 'Missing required params: metric, interval, from, to' }, 400)
    }
    return c.json(engine.statsStore.getTimeSeries(metric, interval, from, to))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// --- POST routes ---

app.post('/api/blueprints', async (c) => {
  try {
    const body = await c.req.json()
    const yaml = body.yaml as string
    if (!yaml) return c.json({ error: 'Missing required field: yaml' }, 400)
    const result = loadBlueprintFromString(yaml, engine.blueprintStore)
    return c.json(result, result.errors.length > 0 ? 207 : 201)
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

app.post('/api/processes', async (c) => {
  try {
    const body = await c.req.json()
    const process = engine.tracker.createTask(body)
    return c.json(process, 201)
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

app.post('/api/processes/:id/transition', async (c) => {
  try {
    const { newState } = await c.req.json()
    if (!newState) return c.json({ error: 'Missing newState' }, 400)
    const updated = engine.tracker.updateTask(c.req.param('id'), { state: newState })
    return c.json(updated)
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

app.post('/api/processes/:id/simulate-complete', async (c) => {
  try {
    const id = c.req.param('id')
    const process = engine.processStore.get(id)
    if (!process) return c.json({ error: 'Process not found' }, 404)

    const CHAIN: Record<string, string[]> = {
      OPEN: ['IN_PROGRESS', 'COMPLETED'],
      IN_PROGRESS: ['COMPLETED'],
      BLOCKED: ['IN_PROGRESS', 'COMPLETED'],
    }
    const steps = CHAIN[process.state]
    if (!steps) {
      return c.json({ error: `Cannot simulate-complete a process in ${process.state} state` }, 400)
    }

    let current = process
    for (const state of steps) {
      current = engine.tracker.updateTask(current.id, { state })
    }

    const tree = engine.processStore.getProcessTree(current.parentId ?? current.id)
    return c.json({ process: current, tree })
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

// --- Store Profile API (JSON-LD / Schema.org) ---

app.get('/api/store-profiles', (c) => {
  try {
    const city = c.req.query('city')
    const district = c.req.query('district')
    const businessCircle = c.req.query('businessCircle')
    const keyword = c.req.query('keyword')

    const results = engine.dossierStore.search({ entityType: 'store', lifecycle: 'ACTIVE' })

    const filtered = results.filter(r => {
      const d = r.data as Record<string, unknown>
      if (city && d.city !== city) return false
      if (district && d.district !== district) return false
      if (businessCircle && d.businessCircle !== businessCircle) return false
      if (keyword) {
        const kw = keyword.toLowerCase()
        const text = [d.storeName, d.features, d.address, d.businessCircle]
          .filter(Boolean).join(' ').toLowerCase()
        if (!text.includes(kw)) return false
      }
      return true
    })

    const stores = filtered.map(r => {
      const d = r.data as Record<string, unknown>
      return {
        storeId: r.dossier.entityId,
        storeName: d.storeName,
        city: d.city,
        district: d.district,
        businessCircle: d.businessCircle,
        address: d.address,
        operatingHours: d.operatingHours,
        features: d.features,
        roomSummary: Array.isArray(d.roomTypes)
          ? (d.roomTypes as Array<Record<string, unknown>>).map(rt => ({
              type: rt.type, capacity: rt.capacity,
              priceWeekday: rt.priceWeekday, priceWeekend: rt.priceWeekend,
            }))
          : [],
        detailUrl: `/api/store-profiles/${r.dossier.entityId}`,
      }
    })

    return c.json({ count: stores.length, stores })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/store-profiles/:storeId', (c) => {
  try {
    const storeId = c.req.param('storeId')
    const result = engine.dossierStore.get('store', storeId)
    if (!result) return c.json({ error: 'Store not found' }, 404)

    const d = result.data as Record<string, unknown>
    const accept = c.req.header('Accept') ?? ''

    // JSON-LD response (Schema.org LocalBusiness)
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': ['LocalBusiness', 'EntertainmentBusiness'],
      '@id': `idlex:store:${storeId}`,
      name: d.storeName,
      address: {
        '@type': 'PostalAddress',
        streetAddress: d.address,
        addressLocality: d.city,
        addressRegion: d.district,
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: d.lat,
        longitude: d.lng,
      },
      openingHours: d.operatingHours,
      telephone: d.contactPhone,
      description: d.features,
      areaServed: d.businessCircle,
      additionalProperty: [
        ...(Array.isArray(d.roomTypes) ? (d.roomTypes as Array<Record<string, unknown>>).map(rt => ({
          '@type': 'PropertyValue',
          name: `room_${rt.type}`,
          value: JSON.stringify({
            type: rt.type, capacity: rt.capacity, count: rt.count,
            priceWeekday: rt.priceWeekday, priceWeekend: rt.priceWeekend,
          }),
        })) : []),
        { '@type': 'PropertyValue', name: 'equipment', value: JSON.stringify(d.equipment) },
        { '@type': 'PropertyValue', name: 'saasSystem', value: d.saasSystem },
      ],
    }

    // If client requests JSON-LD specifically
    if (accept.includes('application/ld+json')) {
      return c.json(jsonLd, 200, {
        'Content-Type': 'application/ld+json',
      })
    }

    // Default: return both raw and JSON-LD
    return c.json({
      storeId,
      storeName: d.storeName,
      raw: d,
      jsonLd,
      dossier: {
        id: result.dossier.id,
        version: result.dossier.currentVersion,
        lifecycle: result.dossier.lifecycle,
        updatedAt: result.dossier.updatedAt,
      },
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/store-profiles/:storeId/availability', (c) => {
  try {
    const storeId = c.req.param('storeId')
    const roomType = c.req.query('roomType')
    const result = engine.dossierStore.get('store', storeId)
    if (!result) return c.json({ error: 'Store not found' }, 404)

    const d = result.data as Record<string, unknown>
    const rooms = (Array.isArray(d.roomTypes) ? d.roomTypes : []) as Array<Record<string, unknown>>
    const filtered = roomType ? rooms.filter(rt => rt.type === roomType) : rooms

    return c.json({
      storeId,
      storeName: d.storeName,
      operatingHours: d.operatingHours,
      rooms: filtered.map(rt => ({
        type: rt.type,
        capacity: rt.capacity,
        totalCount: rt.count,
        priceWeekday: rt.priceWeekday,
        priceWeekend: rt.priceWeekend,
      })),
      lastUpdated: result.dossier.updatedAt,
      note: 'Real-time availability requires SaaS system integration. Showing static room inventory.',
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// --- Phase C: Agent Log, Business Goals, Approvals ---

app.get('/api/agent-log', (c) => {
  try {
    const taskId = c.req.query('taskId')
    const action = c.req.query('action')
    const limit = Number(c.req.query('limit') || '100')
    const offset = Number(c.req.query('offset') || '0')

    let sql = `
      SELECT l.id, l.task_id, l.action, l.from_state, l.to_state, l.details, l.timestamp,
             p.service_id, p.entity_type, p.entity_id, p.name AS task_name
      FROM bps_task_log l
      LEFT JOIN bps_processes p ON l.task_id = p.id
    `
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (taskId) {
      conditions.push('l.task_id = ?')
      params.push(taskId)
    }
    if (action) {
      conditions.push('l.action = ?')
      params.push(action)
    }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
    sql += ' ORDER BY l.timestamp DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = engine.db.prepare(sql).all(...params) as Record<string, unknown>[]

    // Collect task IDs to look up reasons from context snapshots
    const taskIds = [...new Set(rows.map(r => r.task_id as string))]
    const reasons = new Map<string, string>()
    for (const tid of taskIds) {
      const snap = engine.processStore.getLatestSnapshot(tid)
      if (snap?.contextData?._reason) {
        reasons.set(tid, snap.contextData._reason as string)
      }
    }

    const entries = rows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      taskName: r.task_name ?? null,
      serviceId: r.service_id ?? null,
      entityType: r.entity_type ?? null,
      entityId: r.entity_id ?? null,
      action: r.action,
      fromState: r.from_state ?? null,
      toState: r.to_state ?? null,
      details: r.details ? JSON.parse(r.details as string) : null,
      reason: reasons.get(r.task_id as string) ?? null,
      timestamp: r.timestamp,
    }))

    return c.json(entries)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/business-goals', (c) => {
  try {
    // Fetch all active action-plan dossiers
    const plans = engine.dossierStore.search({ entityType: 'action-plan', lifecycle: 'ACTIVE' })

    const goals = plans.map(r => {
      const data = r.data as Record<string, unknown>

      // Count related processes by state
      const relatedProcesses = engine.processStore.query({
        entityType: 'action-plan',
        entityId: r.dossier.entityId,
      })
      const byState: Record<string, number> = {}
      for (const p of relatedProcesses) {
        byState[p.state] = (byState[p.state] ?? 0) + 1
      }

      // Extract items/goals from the plan data
      const items = (Array.isArray(data.items) ? data.items : []) as Array<Record<string, unknown>>
      const periodicItems = (Array.isArray(data.periodicItems) ? data.periodicItems : []) as Array<Record<string, unknown>>

      return {
        planId: r.dossier.entityId,
        dossierId: r.dossier.id,
        name: data.name ?? data.title ?? r.dossier.entityId,
        description: data.description ?? null,
        items: items.map(item => ({
          name: item.name ?? item.title,
          status: item.status ?? 'pending',
          dueDate: item.dueDate ?? null,
          priority: item.priority ?? null,
        })),
        periodicItems: periodicItems.map(item => ({
          name: item.name ?? item.title,
          cron: item.cron ?? null,
          lastRun: item.lastRun ?? null,
          nextRun: item.nextRun ?? null,
        })),
        processStats: {
          total: relatedProcesses.length,
          byState,
          completionRate: relatedProcesses.length > 0
            ? Math.round(((byState['COMPLETED'] ?? 0) / relatedProcesses.length) * 100)
            : 0,
        },
        updatedAt: r.dossier.updatedAt,
      }
    })

    return c.json(goals)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/approvals', (c) => {
  try {
    const status = c.req.query('status') ?? 'pending'

    // Approvals are dossiers with entityType=approval
    const results = engine.dossierStore.search({ entityType: 'approval', lifecycle: 'ACTIVE' })

    const approvals = results
      .map(r => {
        const data = r.data as Record<string, unknown>
        return {
          id: r.dossier.id,
          approvalId: r.dossier.entityId,
          status: (data.status as string) ?? 'pending',
          question: data.question ?? data.title ?? 'Approval needed',
          context: data.context ?? null,
          taskId: data.taskId ?? null,
          serviceId: data.serviceId ?? null,
          requestedBy: data.requestedBy ?? null,
          requestedAt: data.requestedAt ?? r.dossier.createdAt,
          decidedBy: data.decidedBy ?? null,
          decidedAt: data.decidedAt ?? null,
          decision: data.decision ?? null,
          updatedAt: r.dossier.updatedAt,
        }
      })
      .filter(a => status === 'all' || a.status === status)

    return c.json(approvals)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.post('/api/approvals/:id/decide', async (c) => {
  try {
    const approvalId = c.req.param('id')
    const body = await c.req.json()
    const { decision, decidedBy, reason } = body as {
      decision: 'approved' | 'rejected'
      decidedBy?: string
      reason?: string
    }

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return c.json({ error: 'Missing or invalid decision (must be "approved" or "rejected")' }, 400)
    }

    // Find the approval dossier
    const result = engine.dossierStore.get('approval', approvalId)
    if (!result) return c.json({ error: 'Approval not found' }, 404)

    // Commit the decision
    engine.dossierStore.commit(result.dossier.id, {
      status: decision,
      decision,
      decidedBy: decidedBy ?? 'dashboard-user',
      decidedAt: new Date().toISOString(),
      decisionReason: reason,
    }, {
      committedBy: decidedBy ?? 'dashboard-user',
      message: `Approval ${decision}: ${reason ?? ''}`.trim(),
    })

    return c.json({ success: true, approvalId, decision })
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

// --- Governance API ---

app.get('/api/governance/status', (c) => {
  try {
    const cbState = governanceStore.getCircuitBreakerState()
    const constraints = governanceStore.listConstraints()
    const pendingApprovals = governanceStore.getPendingApprovals()
    const recentViolations = governanceStore.getRecentViolations(5)

    return c.json({
      circuitBreaker: cbState,
      circuitBreakerState: cbState.state,
      constraintCount: constraints.length,
      constraintEffectiveness: governanceStore.getConstraintEffectiveness(),
      pendingApprovalCount: pendingApprovals.length,
      recentViolations: recentViolations.map(v => ({
        id: v.id,
        constraintId: v.constraintId,
        policyId: v.policyId,
        severity: v.severity,
        tool: v.tool,
        message: v.message,
        createdAt: v.createdAt,
      })),
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/governance/violations', (c) => {
  try {
    const limit = Number(c.req.query('limit') || '50')
    const violations = governanceStore.getRecentViolations(limit)
    return c.json(violations.map(v => ({
      id: v.id,
      constraintId: v.constraintId,
      policyId: v.policyId,
      severity: v.severity,
      tool: v.tool,
      entityType: v.entityType ?? null,
      entityId: v.entityId ?? null,
      verdict: v.verdict,
      condition: v.condition,
      message: v.message,
      circuitBreakerState: v.circuitBreakerState,
      createdAt: v.createdAt,
    })))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/governance/constraints', (c) => {
  try {
    const constraints = governanceStore.listConstraints()
    return c.json(constraints.map(c => ({
      id: c.id,
      policyId: c.policyId,
      label: c.label,
      scope: c.scope,
      condition: c.condition,
      onViolation: c.onViolation,
      severity: c.severity,
      approver: c.approver ?? null,
      message: c.message,
    })))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.get('/api/governance/approvals', (c) => {
  try {
    const approvals = governanceStore.getPendingApprovals()
    return c.json(approvals.map(a => ({
      id: a.id,
      constraintId: a.constraintId,
      tool: a.tool,
      toolInput: a.toolInput,
      entityType: a.entityType ?? null,
      entityId: a.entityId ?? null,
      message: a.message,
      status: a.status,
      approvedBy: a.approvedBy ?? null,
      decidedAt: a.decidedAt ?? null,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
    })))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.post('/api/governance/approvals/:id/decide', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { decision, decidedBy } = body as { decision: 'APPROVED' | 'REJECTED'; decidedBy?: string }

    if (!decision || !['APPROVED', 'REJECTED'].includes(decision)) {
      return c.json({ error: 'Invalid decision (must be "APPROVED" or "REJECTED")' }, 400)
    }

    const approval = governanceStore.getApproval(id)
    if (!approval) return c.json({ error: 'Approval not found' }, 404)
    if (approval.status !== 'PENDING') return c.json({ error: 'Approval already decided' }, 400)

    governanceStore.decideApproval(id, decision, decidedBy ?? 'dashboard-user')

    // On APPROVED: replay the originally-blocked operation
    let executionResult: Record<string, unknown> | null = null
    if (decision === 'APPROVED') {
      try {
        executionResult = replayToolCall(engine, approval.tool, approval.toolInput, { governanceStore })
      } catch (err) {
        executionResult = { success: false, error: `Replay failed: ${err instanceof Error ? err.message : String(err)}` }
      }
    }

    return c.json({ success: true, id, decision, executionResult })
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

app.post('/api/governance/circuit-breaker/reset', async (c) => {
  try {
    governanceStore.resetCircuitBreaker()
    return c.json({ success: true, state: 'NORMAL' })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.post('/api/entities/:entityType/:entityId', async (c) => {
  try {
    const { entityType, entityId } = c.req.param()
    const body = await c.req.json()
    const dossier = engine.dossierStore.getOrCreate(entityType, entityId)
    const version = engine.dossierStore.commit(dossier.id, body.data ?? {}, {
      committedBy: body.committedBy,
      message: body.message,
    })
    return c.json({ dossier, version }, 201)
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

return app
}

export default createApp(engine)

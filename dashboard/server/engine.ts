import { createBpsEngine, createDatabase, createMemoryDatabase, loadBlueprintFromYaml, GovernanceStore, ActionGate, loadGovernanceFile } from '../../src/index.js'
import path from 'node:path'
import fs from 'node:fs'
import { seedDemoData } from './seed.js'

const bpDir = process.env.BPS_BLUEPRINTS_DIR || path.resolve(import.meta.dirname, '..', 'blueprints')

// Support shared SQLite: BPS_DB_PATH → file-based (shared with OC plugin), otherwise in-memory
const dbPath = process.env.BPS_DB_PATH
const db = dbPath ? createDatabase(dbPath) : createMemoryDatabase()
if (dbPath) console.log(`[bps] Using shared database: ${dbPath}`)

export const engine = createBpsEngine({ db })

// Governance layer
export const governanceStore = new GovernanceStore(db)
export const actionGate = new ActionGate(governanceStore)

// Load governance.yaml if BPS_DB_PATH points to a project
const aidaDir = process.env.AIDA_HOME || (dbPath ? path.resolve(path.dirname(dbPath), '..') : '')
const govYamlPath = aidaDir ? path.join(aidaDir, 'governance.yaml') : ''
if (govYamlPath && fs.existsSync(govYamlPath)) {
  const result = loadGovernanceFile(govYamlPath)
  if (result.errors.length === 0) {
    const count = governanceStore.loadConstraints(result.constraints)
    console.log(`[governance] Loaded ${count} constraints from governance.yaml`)
  } else {
    console.warn(`[governance] governance.yaml errors: ${result.errors.join('; ')}`)
  }
}

if (fs.existsSync(bpDir)) {
  for (const file of fs.readdirSync(bpDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))) {
    try {
      const result = loadBlueprintFromYaml(path.join(bpDir, file), engine.blueprintStore)
      console.log(`[bps] Loaded ${file}: ${result.services} services, ${result.events} events, ${result.rules} rules`)
      if (result.errors.length > 0) {
        console.warn(`[bps] ${file} errors: ${result.errors.join('; ')}`)
      }
    } catch (err) {
      console.error(`[bps] Failed to load ${file}: ${err}`)
    }
  }
}

// Dimension-free stats for dashboard charts (engine records process.created with { serviceId } dims)
engine.tracker.on('process:created', () => {
  engine.statsStore.recordEvent('dashboard.process.created')
})

// Seed demo data only in standalone mode (in-memory), skip when sharing DB with OC plugin
if (!dbPath && !process.env.BPS_NO_SEED) {
  seedDemoData(engine).catch(err => console.error(`[seed] Failed: ${err}`))
}

import { createBpsEngine, ManagementStore, loadBlueprintFromString, type BpsEngine } from '../../src/index.js'
import { createApp } from '../server/routes.js'
import type { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'

export interface TestContext {
  engine: BpsEngine
  managementStore: ManagementStore
  app: Hono
}

/**
 * Create a fresh engine + app for each test.
 * Loads the demo-order-fulfillment blueprint and wires up dashboard stats event.
 */
export function createTestContext(): TestContext {
  const engine = createBpsEngine()
  const managementStore = new ManagementStore(engine.db)

  // Load demo blueprint
  const bpPath = path.resolve(import.meta.dirname, '..', 'blueprints', 'demo-order-fulfillment.yaml')
  const yaml = fs.readFileSync(bpPath, 'utf-8')
  loadBlueprintFromString(yaml, engine.blueprintStore)

  // Mirror what engine.ts does: record dimension-free stats for dashboard charts
  engine.tracker.on('process:created', () => {
    engine.statsStore.recordEvent('dashboard.process.created')
  })

  const app = createApp(engine, { managementStore })
  return { engine, managementStore, app }
}

/** GET helper — returns { status, body } */
export async function getJson(app: Hono, path: string): Promise<{ status: number; body: any }> {
  const res = await app.request(path)
  const body = await res.json()
  return { status: res.status, body }
}

/** POST helper — returns { status, body } */
export async function postJson(app: Hono, path: string, data: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const body = await res.json()
  return { status: res.status, body }
}

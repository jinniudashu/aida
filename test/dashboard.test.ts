import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
} from '../src/index.js';
import { StatsStore } from '../src/store/stats-store.js';
import { DashboardQueryService } from '../src/store/dashboard-query-service.js';

const TEST_BLUEPRINT = `
version: "1.0"
name: "Dashboard Test Blueprint"

services:
  - id: "svc-collect"
    label: "Data Collection"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"

  - id: "svc-review"
    label: "Review"
    serviceType: "atomic"
    executorType: "manual"
    entityType: "store"

  - id: "svc-system"
    label: "System Task"
    serviceType: "atomic"
    executorType: "system"

events: []
instructions: []
rules: []
`;

// ——— StatsStore ———

describe('StatsStore', () => {
  let engine: BpsEngine;
  let stats: StatsStore;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    stats = engine.statsStore;
  });

  it('should recordEvent and getTimeSeries with dimensions', () => {
    stats.recordEvent('process.created', { serviceId: 'svc-collect' });
    stats.recordEvent('process.created', { serviceId: 'svc-collect' });

    const today = new Date().toISOString().slice(0, 10);
    const series = stats.getTimeSeries('process.created', 'day', today, today, { serviceId: 'svc-collect' });
    expect(series.length).toBe(1);
    expect(series[0].count).toBe(2);
    expect(series[0].dimensions).toEqual({ serviceId: 'svc-collect' });
  });

  it('should recordEvent and getTimeSeries without dimensions', () => {
    stats.recordEvent('process.completed');
    stats.recordEvent('process.completed');
    stats.recordEvent('process.completed');

    const today = new Date().toISOString().slice(0, 10);
    const series = stats.getTimeSeries('process.completed', 'day', today, today);
    expect(series.length).toBe(1);
    expect(series[0].count).toBe(3);
    expect(series[0].dimensions).toBeUndefined();
  });

  it('should saveSnapshot and getLatestSnapshot', () => {
    stats.saveSnapshot('overview', { total: 10 });
    stats.saveSnapshot('overview', { total: 20 });

    const latest = stats.getLatestSnapshot('overview');
    expect(latest).not.toBeNull();
    expect(latest!.data).toEqual({ total: 20 });
    expect(latest!.snapshotType).toBe('overview');
  });

  it('should return null for getLatestSnapshot with no data', () => {
    const result = stats.getLatestSnapshot('nonexistent');
    expect(result).toBeNull();
  });
});

// ——— ProcessStore enhancements ———

describe('ProcessStore enhancements', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
  });

  it('query: should filter by single state', () => {
    engine.tracker.createTask({ serviceId: 'svc-collect' });
    engine.tracker.createTask({ serviceId: 'svc-review' });

    const results = engine.processStore.query({ state: 'OPEN' });
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const p of results) expect(p.state).toBe('OPEN');
  });

  it('query: should filter by multiple states (state[])', () => {
    const t1 = engine.tracker.createTask({ serviceId: 'svc-collect' });
    engine.tracker.updateTask(t1.id, { state: 'IN_PROGRESS' });

    const results = engine.processStore.query({ state: ['OPEN', 'IN_PROGRESS'] });
    const states = new Set(results.map(r => r.state));
    for (const s of states) expect(['OPEN', 'IN_PROGRESS']).toContain(s);
  });

  it('query: should filter by serviceId', () => {
    engine.tracker.createTask({ serviceId: 'svc-collect' });
    engine.tracker.createTask({ serviceId: 'svc-review' });

    const results = engine.processStore.query({ serviceId: 'svc-collect' });
    for (const p of results) expect(p.serviceId).toBe('svc-collect');
  });

  it('query: should filter by entityType + entityId', () => {
    engine.tracker.createTask({ serviceId: 'svc-collect', entityType: 'store', entityId: 'S001' });
    engine.tracker.createTask({ serviceId: 'svc-collect', entityType: 'store', entityId: 'S002' });

    const results = engine.processStore.query({ entityType: 'store', entityId: 'S001' });
    expect(results.length).toBe(1);
    expect(results[0].entityId).toBe('S001');
  });

  it('query: should support limit + offset', () => {
    engine.tracker.createTask({ serviceId: 'svc-collect' });
    engine.tracker.createTask({ serviceId: 'svc-collect' });
    engine.tracker.createTask({ serviceId: 'svc-collect' });

    const page1 = engine.processStore.query({ serviceId: 'svc-collect', limit: 2 });
    expect(page1.length).toBe(2);

    const page2 = engine.processStore.query({ serviceId: 'svc-collect', limit: 2, offset: 2 });
    expect(page2.length).toBe(1);
  });

  it('query: should return [] for empty state array', () => {
    const results = engine.processStore.query({ state: [] });
    expect(results).toEqual([]);
  });

  it('getProcessTree: should build parent-child-grandchild tree', () => {
    const root = engine.tracker.createTask({ serviceId: 'svc-collect' });
    const child = engine.tracker.createTask({ serviceId: 'svc-review', parentId: root.id });
    engine.tracker.createTask({ serviceId: 'svc-system', parentId: child.id });

    const tree = engine.processStore.getProcessTree(root.id);
    expect(tree).not.toBeNull();
    expect(tree!.process.id).toBe(root.id);
    expect(tree!.children.length).toBe(1);
    expect(tree!.children[0].process.id).toBe(child.id);
    expect(tree!.children[0].children.length).toBe(1);
  });

  it('getProcessTree: leaf node should have empty children', () => {
    const leaf = engine.tracker.createTask({ serviceId: 'svc-collect' });

    const tree = engine.processStore.getProcessTree(leaf.id);
    expect(tree).not.toBeNull();
    expect(tree!.children).toEqual([]);
  });

  it('getProcessTree: should return null for nonexistent id', () => {
    expect(engine.processStore.getProcessTree('nonexistent')).toBeNull();
  });

  it('countByState: should aggregate correctly', () => {
    engine.tracker.createTask({ serviceId: 'svc-collect' });
    const t2 = engine.tracker.createTask({ serviceId: 'svc-review' });
    engine.tracker.updateTask(t2.id, { state: 'IN_PROGRESS' });

    const counts = engine.processStore.countByState();
    expect(counts['OPEN']).toBeGreaterThanOrEqual(1);
    expect(counts['IN_PROGRESS']).toBeGreaterThanOrEqual(1);
  });

  it('countByState: should return {} on empty table', () => {
    const counts = engine.processStore.countByState();
    expect(counts).toEqual({});
  });
});

// ——— DossierStore.getRecentChanges ———

describe('DossierStore.getRecentChanges', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
  });

  it('should return changes ordered by updatedAt descending', () => {
    const d1 = engine.dossierStore.getOrCreate('store', 'S001');
    engine.dossierStore.commit(d1.id, { name: 'Store 1' }, { message: 'init' });

    const d2 = engine.dossierStore.getOrCreate('store', 'S002');
    engine.dossierStore.commit(d2.id, { name: 'Store 2' }, { message: 'init' });

    const changes = engine.dossierStore.getRecentChanges(10);
    expect(changes.length).toBe(2);
    expect(changes[0].dossier.entityId).toBe('S002');
    expect(changes[1].dossier.entityId).toBe('S001');
  });

  it('should respect limit', () => {
    for (let i = 0; i < 5; i++) {
      const d = engine.dossierStore.getOrCreate('store', `S${i}`);
      engine.dossierStore.commit(d.id, { index: i });
    }

    const changes = engine.dossierStore.getRecentChanges(3);
    expect(changes.length).toBe(3);
  });

  it('should exclude version=0 dossiers (no committed data)', () => {
    engine.dossierStore.getOrCreate('store', 'empty');
    const d = engine.dossierStore.getOrCreate('store', 'committed');
    engine.dossierStore.commit(d.id, { name: 'has data' });

    const changes = engine.dossierStore.getRecentChanges(10);
    expect(changes.length).toBe(1);
    expect(changes[0].dossier.entityId).toBe('committed');
  });
});

// ——— DashboardQueryService ———

describe('DashboardQueryService', () => {
  let engine: BpsEngine;
  let dashboard: DashboardQueryService;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    dashboard = engine.dashboardQuery;
  });

  it('getOverview: should aggregate entities, processes, and services', () => {
    const d1 = engine.dossierStore.getOrCreate('store', 'S001');
    engine.dossierStore.commit(d1.id, { name: 'Store 1' });
    const d2 = engine.dossierStore.getOrCreate('order', 'O001');
    engine.dossierStore.commit(d2.id, { status: 'new' });

    engine.tracker.createTask({ serviceId: 'svc-collect' });

    const overview = dashboard.getOverview();

    expect(overview.entities.totalCount).toBe(2);
    expect(overview.entities.byType['store']).toBe(1);
    expect(overview.entities.byType['order']).toBe(1);

    expect(overview.processes.totalCount).toBeGreaterThanOrEqual(1);

    expect(overview.services.totalCount).toBe(3);
    expect(overview.services.byExecutorType['agent']).toBe(1);
    expect(overview.services.byExecutorType['manual']).toBe(1);
    expect(overview.services.byExecutorType['system']).toBe(1);
  });

  it('getProcessKanban: should return 5 columns', () => {
    engine.tracker.createTask({ serviceId: 'svc-collect' });

    const kanban = dashboard.getProcessKanban();
    expect(kanban.length).toBe(5);

    const states = kanban.map(c => c.state);
    expect(states).toEqual(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BLOCKED']);
  });

  it('getProcessKanban: should respect filter', () => {
    engine.tracker.createTask({ serviceId: 'svc-collect', entityType: 'store' });
    engine.tracker.createTask({ serviceId: 'svc-review', entityType: 'order' });

    const kanban = dashboard.getProcessKanban({ entityType: 'store' });
    const totalFiltered = kanban.reduce((sum, col) => sum + col.count, 0);
    expect(totalFiltered).toBe(1);
  });

  it('getEntityDetail: should return dossier + versions + related processes', () => {
    const d = engine.dossierStore.getOrCreate('store', 'S001');
    engine.dossierStore.commit(d.id, { name: 'Store 1' });
    engine.dossierStore.commit(d.id, { rating: 5 });

    engine.tracker.createTask({ serviceId: 'svc-collect', entityType: 'store', entityId: 'S001' });

    const detail = dashboard.getEntityDetail(d.id);
    expect(detail).not.toBeNull();
    expect(detail!.dossier.id).toBe(d.id);
    expect(detail!.data).toEqual({ name: 'Store 1', rating: 5 });
    expect(detail!.versions.length).toBe(2);
    expect(detail!.relatedProcesses.length).toBe(1);
  });

  it('getEntityDetail: should return null for nonexistent', () => {
    expect(dashboard.getEntityDetail('nonexistent')).toBeNull();
  });

  it('getProcessDetail: should return process + context + tree', () => {
    const root = engine.tracker.createTask({ serviceId: 'svc-collect' });
    engine.tracker.createTask({ serviceId: 'svc-review', parentId: root.id });

    const detail = dashboard.getProcessDetail(root.id);
    expect(detail).not.toBeNull();
    expect(detail!.process.id).toBe(root.id);
    expect(detail!.tree).not.toBeNull();
    expect(detail!.tree!.children.length).toBe(1);
  });
});

// ——— Event integration ———

describe('Event-driven stats collection', () => {
  it('should record stats when task is created', () => {
    const engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);

    engine.tracker.createTask({ serviceId: 'svc-collect' });

    const today = new Date().toISOString().slice(0, 10);
    const series = engine.statsStore.getTimeSeries('process.created', 'day', today, today, { serviceId: 'svc-collect' });
    expect(series.length).toBe(1);
    expect(series[0].count).toBeGreaterThanOrEqual(1);
  });
});

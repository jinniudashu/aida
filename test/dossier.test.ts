import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
  type DossierStore,
} from '../src/index.js';

const TEST_BLUEPRINT = `
version: "1.0"
name: "Dossier Test Blueprint"

services:
  - id: "svc-collect"
    label: "Data Collection"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"

  - id: "svc-no-entity"
    label: "No Entity Service"
    serviceType: "atomic"
    executorType: "manual"

events: []
instructions: []
rules: []
`;

describe('DossierStore', () => {
  let engine: BpsEngine;
  let store: DossierStore;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    store = engine.dossierStore;
  });

  // 1. 档案创建和读取（getOrCreate 幂等性）
  it('should create a dossier on first getOrCreate and return same on second call', () => {
    const d1 = store.getOrCreate('store', 'store-001');
    expect(d1.entityType).toBe('store');
    expect(d1.entityId).toBe('store-001');
    expect(d1.lifecycle).toBe('ACTIVE');
    expect(d1.currentVersion).toBe(0);

    const d2 = store.getOrCreate('store', 'store-001');
    expect(d2.id).toBe(d1.id);
  });

  // 2. 版本提交 + 智能合并语义
  it('should commit versions with smart merge semantics', () => {
    const dossier = store.getOrCreate('store', 'store-001');

    const v1 = store.commit(dossier.id, { name: 'Test Store', city: 'Beijing' });
    expect(v1.version).toBe(1);
    expect(v1.data).toEqual({ name: 'Test Store', city: 'Beijing' });

    const v2 = store.commit(dossier.id, { city: 'Shanghai', rating: 5 });
    expect(v2.version).toBe(2);
    expect(v2.data).toEqual({ name: 'Test Store', city: 'Shanghai', rating: 5 });
  });

  // 2b. 数组合并语义：已有数组 + 新数组 = 追加
  it('should concatenate arrays instead of replacing them', () => {
    const dossier = store.getOrCreate('store', 'store-arr');

    store.commit(dossier.id, { name: 'Plan', logs: ['day1: started'] });
    const v1 = store.get('store', 'store-arr');
    expect(v1!.data.logs).toEqual(['day1: started']);

    store.commit(dossier.id, { logs: ['day2: continued'] });
    const v2 = store.get('store', 'store-arr');
    expect(v2!.data.logs).toEqual(['day1: started', 'day2: continued']);
    expect(v2!.data.name).toBe('Plan'); // scalar preserved
  });

  // 2c. 新数组字段（无已有值）正常写入
  it('should write array as-is when no existing array', () => {
    const dossier = store.getOrCreate('store', 'store-newarr');

    store.commit(dossier.id, { tags: ['alpha', 'beta'] });
    const result = store.get('store', 'store-newarr');
    expect(result!.data.tags).toEqual(['alpha', 'beta']);
  });

  // 2d. 数组替换为标量时覆盖
  it('should replace array with scalar when patch provides scalar', () => {
    const dossier = store.getOrCreate('store', 'store-arr-scalar');

    store.commit(dossier.id, { items: ['a', 'b'] });
    store.commit(dossier.id, { items: 'replaced' });
    const result = store.get('store', 'store-arr-scalar');
    expect(result!.data.items).toBe('replaced');
  });

  // 3. patch 审计记录正确性
  it('should record patch as the submitted data (not diff)', () => {
    const dossier = store.getOrCreate('store', 'store-001');

    store.commit(dossier.id, { name: 'Store A', score: 90 });
    const v2 = store.commit(dossier.id, { score: 95, tags: ['geo'] });

    expect(v2.patch).toEqual({ score: 95, tags: ['geo'] });
    expect(v2.data).toEqual({ name: 'Store A', score: 95, tags: ['geo'] });
  });

  // 4. 版本历史追溯
  it('should list version history and retrieve specific versions', () => {
    const dossier = store.getOrCreate('order', 'ord-100');

    store.commit(dossier.id, { status: 'created' }, { message: 'order created' });
    store.commit(dossier.id, { status: 'paid' }, { message: 'payment received' });
    store.commit(dossier.id, { status: 'shipped' }, { message: 'shipped out' });

    const versions = store.listVersions(dossier.id);
    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe(1);
    expect(versions[2].version).toBe(3);

    const v2 = store.getVersion(dossier.id, 2);
    expect(v2).not.toBeNull();
    expect(v2!.data).toEqual({ status: 'paid' });
    expect(v2!.commitMessage).toBe('payment received');
  });

  // 5. 生命周期迁移（DRAFT → ACTIVE → ARCHIVED）
  it('should transition lifecycle states', () => {
    const dossier = store.getOrCreate('store', 'store-lc');

    store.transition(dossier.id, 'DRAFT');
    const result1 = store.get('store', 'store-lc');
    expect(result1!.dossier.lifecycle).toBe('DRAFT');

    store.transition(dossier.id, 'ACTIVE');
    const result2 = store.get('store', 'store-lc');
    expect(result2!.dossier.lifecycle).toBe('ACTIVE');

    store.transition(dossier.id, 'ARCHIVED');
    const result3 = store.get('store', 'store-lc');
    expect(result3!.dossier.lifecycle).toBe('ARCHIVED');
  });

  // 6. ARCHIVED 状态拒绝写入
  it('should reject commits to ARCHIVED dossiers', () => {
    const dossier = store.getOrCreate('store', 'store-arc');
    store.commit(dossier.id, { name: 'before archive' });
    store.transition(dossier.id, 'ARCHIVED');

    expect(() => store.commit(dossier.id, { name: 'after archive' }))
      .toThrow(/ARCHIVED/);
  });

  // 7. 按条件查询档案
  it('should query dossiers by entityType and lifecycle', () => {
    store.getOrCreate('store', 's1');
    store.getOrCreate('store', 's2');
    store.getOrCreate('order', 'o1');

    const d3 = store.getOrCreate('store', 's3');
    store.transition(d3.id, 'ARCHIVED');

    expect(store.query({ entityType: 'store' })).toHaveLength(3);
    expect(store.query({ entityType: 'order' })).toHaveLength(1);
    expect(store.query({ lifecycle: 'ACTIVE' })).toHaveLength(3);
    expect(store.query({ entityType: 'store', lifecycle: 'ARCHIVED' })).toHaveLength(1);
    expect(store.query()).toHaveLength(4);
  });

  // 8. get() 返回当前数据
  it('should return current data via get()', () => {
    store.getOrCreate('store', 'store-get');
    const empty = store.get('store', 'store-get');
    expect(empty!.data).toEqual({});

    store.commit(empty!.dossier.id, { x: 1 });
    const filled = store.get('store', 'store-get');
    expect(filled!.data).toEqual({ x: 1 });
    expect(filled!.dossier.currentVersion).toBe(1);
  });

  // 9. get() 对不存在的档案返回 null
  it('should return null for non-existent dossier', () => {
    expect(store.get('nope', 'nope')).toBeNull();
  });

  // 10. getVersion 对不存在的版本返回 null
  it('should return null for non-existent version', () => {
    const d = store.getOrCreate('store', 'sv');
    expect(store.getVersion(d.id, 999)).toBeNull();
  });

  // --- getById (erpsysId) ---

  it('should lookup dossier by erpsysId (dossier.id) without knowing entityType', () => {
    const dossier = store.getOrCreate('store', 'store-erp');
    store.commit(dossier.id, { name: 'ERP Store', city: 'Beijing' });

    const result = store.getById(dossier.id);
    expect(result).not.toBeNull();
    expect(result!.dossier.entityType).toBe('store');
    expect(result!.dossier.entityId).toBe('store-erp');
    expect(result!.data).toEqual({ name: 'ERP Store', city: 'Beijing' });
  });

  it('should return null for non-existent erpsysId', () => {
    expect(store.getById('non-existent-uuid')).toBeNull();
  });

  it('should return same result via getById and get', () => {
    const dossier = store.getOrCreate('order', 'ord-erp');
    store.commit(dossier.id, { total: 200 });

    const byId = store.getById(dossier.id);
    const byTypeId = store.get('order', 'ord-erp');
    expect(byId).toEqual(byTypeId);
  });
});

describe('DossierStore Search', () => {
  let engine: BpsEngine;
  let store: DossierStore;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    store = engine.dossierStore;

    // Seed data
    const d1 = store.getOrCreate('store', 's1');
    store.commit(d1.id, { name: 'Store A', city: 'Beijing', rating: 4.5 });

    const d2 = store.getOrCreate('store', 's2');
    store.commit(d2.id, { name: 'Store B', city: 'Shanghai', rating: 3.8 });

    const d3 = store.getOrCreate('store', 's3');
    store.commit(d3.id, { name: 'Store C', city: 'Shanghai', rating: 4.9 });

    const d4 = store.getOrCreate('order', 's1');
    store.commit(d4.id, { total: 100, city: 'Shanghai' });
  });

  it('should search by entityType', () => {
    const results = store.search({ entityType: 'store' });
    expect(results).toHaveLength(3);
    results.forEach(r => expect(r.dossier.entityType).toBe('store'));
  });

  it('should search by dataFilter (single field)', () => {
    const results = store.search({ dataFilter: { city: 'Shanghai' } });
    expect(results).toHaveLength(3);
  });

  it('should search by entityType + dataFilter', () => {
    const results = store.search({ entityType: 'store', dataFilter: { city: 'Shanghai' } });
    expect(results).toHaveLength(2);
    expect(results.map(r => r.dossier.entityId).sort()).toEqual(['s2', 's3']);
  });

  it('should search by dataFilter with numeric value', () => {
    const results = store.search({ entityType: 'store', dataFilter: { rating: 4.9 } });
    expect(results).toHaveLength(1);
    expect(results[0].dossier.entityId).toBe('s3');
  });

  it('should search with multiple dataFilter fields (AND semantics)', () => {
    const results = store.search({ dataFilter: { city: 'Shanghai', rating: 3.8 } });
    expect(results).toHaveLength(1);
    expect(results[0].dossier.entityId).toBe('s2');
  });

  it('should return data along with dossier in search results', () => {
    const results = store.search({ entityType: 'store', dataFilter: { city: 'Beijing' } });
    expect(results).toHaveLength(1);
    expect(results[0].data).toEqual({ name: 'Store A', city: 'Beijing', rating: 4.5 });
  });

  it('should support limit', () => {
    const results = store.search({ entityType: 'store', limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('should support offset + limit for pagination', () => {
    const all = store.search({ entityType: 'store' });
    const page2 = store.search({ entityType: 'store', limit: 2, offset: 2 });
    expect(page2).toHaveLength(1);
    expect(page2[0].dossier.id).toBe(all[2].dossier.id);
  });

  it('should search with no filters (returns all with data)', () => {
    const results = store.search();
    expect(results).toHaveLength(4);
    results.forEach(r => expect(r.data).toBeDefined());
  });

  it('should search by lifecycle', () => {
    const d = store.getOrCreate('store', 's1');
    store.transition(d.id, 'ARCHIVED');

    const active = store.search({ lifecycle: 'ACTIVE' });
    expect(active).toHaveLength(3);

    const archived = store.search({ lifecycle: 'ARCHIVED' });
    expect(archived).toHaveLength(1);
    expect(archived[0].dossier.entityId).toBe('s1');
  });

  it('should reject invalid dataFilter field names', () => {
    expect(() => store.search({ dataFilter: { 'DROP TABLE; --': 'hack' } }))
      .toThrow(/Invalid dataFilter field name/);
  });

  it('should find dossiers across types by entityId', () => {
    const results = store.findByEntityId('s1');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.entityType).sort()).toEqual(['order', 'store']);
  });

  it('should return empty array for unknown entityId', () => {
    expect(store.findByEntityId('nonexistent')).toHaveLength(0);
  });

  it('should find dossiers by committer processId', () => {
    const d = store.getOrCreate('store', 'committer-test');
    store.commit(d.id, { x: 1 }, { committedBy: 'proc-A' });

    const d2 = store.getOrCreate('order', 'committer-test-2');
    store.commit(d2.id, { y: 2 }, { committedBy: 'proc-A' });
    store.commit(d2.id, { y: 3 }, { committedBy: 'proc-B' });

    const byA = store.findByCommitter('proc-A');
    expect(byA).toHaveLength(2);

    const byB = store.findByCommitter('proc-B');
    expect(byB).toHaveLength(1);
    expect(byB[0].entityId).toBe('committer-test-2');
  });

  it('should return empty for unknown committer', () => {
    expect(store.findByCommitter('unknown-proc')).toHaveLength(0);
  });
});

describe('Dossier + ProcessTracker Integration', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
  });

  it('should auto-commit to dossier when task with entity completes', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-collect',
      entityType: 'store',
      entityId: 'store-auto',
    });

    engine.tracker.completeTask(task.id, { name: 'Auto Store', rating: 4.5 });

    const result = engine.dossierStore.get('store', 'store-auto');
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ name: 'Auto Store', rating: 4.5 });
    expect(result!.dossier.currentVersion).toBe(1);
  });

  it('should increment versions when multiple tasks commit to same dossier', () => {
    const t1 = engine.tracker.createTask({
      serviceId: 'svc-collect',
      entityType: 'store',
      entityId: 'store-multi',
    });
    engine.tracker.completeTask(t1.id, { name: 'Multi Store' });

    const t2 = engine.tracker.createTask({
      serviceId: 'svc-collect',
      entityType: 'store',
      entityId: 'store-multi',
    });
    engine.tracker.completeTask(t2.id, { rating: 5 });

    const result = engine.dossierStore.get('store', 'store-multi');
    expect(result!.dossier.currentVersion).toBe(2);
    expect(result!.data).toEqual({ name: 'Multi Store', rating: 5 });

    const versions = engine.dossierStore.listVersions(result!.dossier.id);
    expect(versions).toHaveLength(2);
  });

  it('should NOT auto-commit when task has no entityType/entityId', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-no-entity',
    });
    engine.tracker.completeTask(task.id, { result: 'done' });

    const all = engine.dossierStore.query();
    expect(all).toHaveLength(0);
  });

  it('should NOT auto-commit when task completes without result', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-collect',
      entityType: 'store',
      entityId: 'store-empty',
    });
    engine.tracker.completeTask(task.id);

    const all = engine.dossierStore.query();
    expect(all).toHaveLength(0);
  });

  it('should emit dossier:committed event', () => {
    const events: Array<{ dossierId: string; entityType: string; entityId: string; taskId: string }> = [];
    engine.tracker.on('dossier:committed', (e) => events.push(e));

    const task = engine.tracker.createTask({
      serviceId: 'svc-collect',
      entityType: 'store',
      entityId: 'store-evt',
    });
    engine.tracker.completeTask(task.id, { done: true });

    expect(events).toHaveLength(1);
    expect(events[0].entityType).toBe('store');
    expect(events[0].entityId).toBe('store-evt');
    expect(events[0].taskId).toBe(task.id);
  });

  it('should wrap primitive returnValue in _result field', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-collect',
      entityType: 'store',
      entityId: 'store-prim',
    });
    engine.tracker.completeTask(task.id, 'success');

    const result = engine.dossierStore.get('store', 'store-prim');
    expect(result!.data).toEqual({ _result: 'success' });
  });
});

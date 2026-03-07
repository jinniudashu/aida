import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
  ProcessStateMachine,
  BpsStateError,
} from '../src/index.js';

// ——— 测试用蓝图 YAML ———
const TEST_BLUEPRINT = `
version: "1.0"
name: "BPS Engine Test Blueprint"

services:
  - id: "svc-onboard"
    label: "门店入驻"
    serviceType: "composite"
    executorType: "system"
    entityType: "store"
    manualStart: true

  - id: "svc-data-collect"
    label: "数据采集"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"
    agentSkills: ["data_collection"]

  - id: "svc-geo-publish"
    label: "GEO内容发布"
    serviceType: "atomic"
    executorType: "agent"
    agentSkills: ["geo_content_gen"]
    agentPrompt: "为门店生成GEO内容"

events: []
instructions: []
rules: []
`;

describe('ProcessStateMachine (5-state)', () => {
  it('should allow valid transitions', () => {
    expect(ProcessStateMachine.canTransition('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(ProcessStateMachine.canTransition('OPEN', 'BLOCKED')).toBe(true);
    expect(ProcessStateMachine.canTransition('OPEN', 'FAILED')).toBe(true);
    expect(ProcessStateMachine.canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(ProcessStateMachine.canTransition('IN_PROGRESS', 'BLOCKED')).toBe(true);
    expect(ProcessStateMachine.canTransition('IN_PROGRESS', 'FAILED')).toBe(true);
    expect(ProcessStateMachine.canTransition('BLOCKED', 'OPEN')).toBe(true);
    expect(ProcessStateMachine.canTransition('BLOCKED', 'IN_PROGRESS')).toBe(true);
    expect(ProcessStateMachine.canTransition('FAILED', 'OPEN')).toBe(true);
  });

  it('should reject invalid transitions', () => {
    expect(ProcessStateMachine.canTransition('OPEN', 'COMPLETED')).toBe(false);
    expect(ProcessStateMachine.canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(ProcessStateMachine.canTransition('COMPLETED', 'OPEN')).toBe(false);
    expect(ProcessStateMachine.canTransition('FAILED', 'COMPLETED')).toBe(false);
  });

  it('should throw on assertTransition for invalid state', () => {
    expect(() => ProcessStateMachine.assertTransition('OPEN', 'COMPLETED'))
      .toThrow(BpsStateError);
  });

  it('should identify terminal states', () => {
    expect(ProcessStateMachine.isTerminal('COMPLETED')).toBe(true);
    expect(ProcessStateMachine.isTerminal('FAILED')).toBe(true);
    expect(ProcessStateMachine.isTerminal('IN_PROGRESS')).toBe(false);
    expect(ProcessStateMachine.isTerminal('OPEN')).toBe(false);
  });
});

describe('ProcessTracker', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
  });

  it('should load blueprint and query services', () => {
    const services = engine.blueprintStore.listServices({ status: 'active' });
    expect(services).toHaveLength(3);

    const onboard = engine.blueprintStore.getService('svc-onboard');
    expect(onboard).not.toBeNull();
    expect(onboard!.label).toBe('门店入驻');
    expect(onboard!.serviceType).toBe('composite');
  });

  it('should create a task with OPEN state', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-001',
    });

    expect(task.state).toBe('OPEN');
    expect(task.serviceId).toBe('svc-data-collect');
    expect(task.entityType).toBe('store');
    expect(task.pid).toBe(1);
  });

  it('should save and retrieve metadata snapshots', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-geo-publish',
      metadata: { storeId: 'store-001', modelTarget: 'doubao' },
    });

    const result = engine.tracker.getTask(task.id);
    expect(result).not.toBeNull();
    expect(result!.metadata).not.toBeNull();
    expect(result!.metadata!['storeId']).toBe('store-001');
    expect(result!.metadata!['modelTarget']).toBe('doubao');
  });

  it('should enforce state transition rules', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
    });

    // OPEN → IN_PROGRESS (valid)
    const inProgress = engine.tracker.updateTask(task.id, { state: 'IN_PROGRESS' });
    expect(inProgress.state).toBe('IN_PROGRESS');

    // IN_PROGRESS → COMPLETED (valid)
    const completed = engine.tracker.updateTask(task.id, { state: 'COMPLETED' });
    expect(completed.state).toBe('COMPLETED');

    // COMPLETED → IN_PROGRESS (invalid)
    expect(() =>
      engine.tracker.updateTask(task.id, { state: 'IN_PROGRESS' })
    ).toThrow(BpsStateError);
  });

  it('should complete task and auto-advance through states', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-geo-publish',
    });

    // completeTask auto-advances OPEN → IN_PROGRESS → COMPLETED
    const completed = engine.tracker.completeTask(task.id, { contentUrl: 'https://example.com' });
    expect(completed.state).toBe('COMPLETED');
    expect(completed.endTime).toBeDefined();
  });

  it('should complete task from BLOCKED state', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-geo-publish',
    });

    engine.tracker.updateTask(task.id, { state: 'BLOCKED' });
    const completed = engine.tracker.completeTask(task.id);
    expect(completed.state).toBe('COMPLETED');
  });

  it('should fail task', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
    });

    const failed = engine.tracker.failTask(task.id, 'something went wrong');
    expect(failed.state).toBe('FAILED');
    expect(failed.endTime).toBeDefined();
  });

  it('should emit engine events', () => {
    const events: Array<{ type: string; data: unknown }> = [];
    engine.tracker.on('task:created', (d) => events.push({ type: 'created', data: d }));
    engine.tracker.on('task:completed', (d) => events.push({ type: 'completed', data: d }));

    const task = engine.tracker.createTask({
      serviceId: 'svc-geo-publish',
    });
    engine.tracker.completeTask(task.id);

    expect(events.some(e => e.type === 'created')).toBe(true);
    expect(events.some(e => e.type === 'completed')).toBe(true);
  });

  it('should emit legacy events for Dashboard compatibility', () => {
    const events: string[] = [];
    engine.tracker.on('process:created', () => events.push('process:created'));
    engine.tracker.on('process:completed', () => events.push('process:completed'));

    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.tracker.completeTask(task.id);

    expect(events).toContain('process:created');
    expect(events).toContain('process:completed');
  });

  it('should assign incrementing PIDs', () => {
    const t1 = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    const t2 = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });

    expect(t2.pid).toBeGreaterThan(t1.pid);
  });

  it('should auto-commit to dossier when task with entity completes', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-auto',
    });

    engine.tracker.completeTask(task.id, { name: 'Auto Store', rating: 4.5 });

    const result = engine.dossierStore.get('store', 'store-auto');
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ name: 'Auto Store', rating: 4.5 });
    expect(result!.dossier.currentVersion).toBe(1);
  });

  it('should write audit log entries', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
    });
    engine.tracker.completeTask(task.id);

    // Check audit log via direct DB query
    const logs = engine.db.prepare(
      'SELECT * FROM bps_task_log WHERE task_id = ? ORDER BY timestamp ASC'
    ).all(task.id) as Array<Record<string, unknown>>;

    expect(logs.length).toBeGreaterThanOrEqual(2); // created + completed
    expect(logs[0]['action']).toBe('created');
    expect(logs[logs.length - 1]['action']).toBe('completed');
  });

  it('should query tasks by filter', () => {
    engine.tracker.createTask({ serviceId: 'svc-data-collect' });
    engine.tracker.createTask({ serviceId: 'svc-geo-publish' });

    const results = engine.tracker.queryTasks({ serviceId: 'svc-data-collect' });
    expect(results.length).toBe(1);
    expect(results[0].serviceId).toBe('svc-data-collect');
  });

  it('should get task tree', () => {
    const parent = engine.tracker.createTask({ serviceId: 'svc-onboard' });
    engine.tracker.createTask({ serviceId: 'svc-data-collect', parentId: parent.id });

    const tree = engine.tracker.getTaskTree(parent.id);
    expect(tree).not.toBeNull();
    expect(tree!.process.id).toBe(parent.id);
    expect(tree!.children).toHaveLength(1);
  });

  it('should update metadata via updateTask', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      metadata: { step: 1 },
    });

    engine.tracker.updateTask(task.id, { metadata: { step: 2, extra: 'data' } });

    const result = engine.tracker.getTask(task.id);
    expect(result!.metadata).toEqual({ step: 2, extra: 'data' });
  });
});

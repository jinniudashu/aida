import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
} from '../src/index.js';
import { createBpsTools } from '../src/integration/tools.js';
import { BpsEventBridge } from '../src/integration/event-bridge.js';
import { registerBpsPlugin } from '../src/integration/plugin.js';
import type {
  OpenClawPluginApi,
  OpenClawAgentTool,
  OpenClawEventHandler,
} from '../src/integration/openclaw-types.js';

// ——— Mock OpenClaw Runtime ———

interface MockOpenClawRuntime {
  api: OpenClawPluginApi;
  registeredTools: OpenClawAgentTool[];
  eventHandlers: Map<string, OpenClawEventHandler[]>;
  emittedEvents: Array<{ event: string; payload: Record<string, unknown> }>;
}

function createMockRuntime(): MockOpenClawRuntime {
  const runtime: MockOpenClawRuntime = {
    registeredTools: [],
    eventHandlers: new Map(),
    emittedEvents: [],
    api: null as unknown as OpenClawPluginApi,
  };

  runtime.api = {
    registerTool(tool) {
      runtime.registeredTools.push(tool);
    },
    onEvent(event, handler) {
      const handlers = runtime.eventHandlers.get(event) ?? [];
      handlers.push(handler);
      runtime.eventHandlers.set(event, handlers);
    },
    emitEvent(event, payload) {
      runtime.emittedEvents.push({ event, payload });
    },
  };

  return runtime;
}

// ——— Test Blueprint ———

const TEST_BLUEPRINT = `
version: "1.0"
name: "Integration Test Blueprint"

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
    agentSkills: ["data_collection", "web_scraping"]
    agentPrompt: "采集门店基础数据并验证"

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

// ——————————————————————————————————
// 1. 插件注册
// ——————————————————————————————————

describe('Plugin Registration', () => {
  it('should register 12 tools and subscribe to events', () => {
    const runtime = createMockRuntime();
    const { engine } = registerBpsPlugin(runtime.api);

    expect(runtime.registeredTools).toHaveLength(12);
    expect(runtime.registeredTools.map(t => t.name).sort()).toEqual([
      'bps_complete_task',
      'bps_create_skill',
      'bps_create_task',
      'bps_get_entity',
      'bps_get_task',
      'bps_list_services',
      'bps_next_steps',
      'bps_query_entities',
      'bps_query_tasks',
      'bps_scan_work',
      'bps_update_entity',
      'bps_update_task',
    ]);

    // Should subscribe to subagent.ended
    expect(runtime.eventHandlers.has('subagent.ended')).toBe(true);

    // Engine should be functional
    expect(engine.tracker).toBeDefined();
    expect(engine.processStore).toBeDefined();
  });
});

// ——————————————————————————————————
// 2. BPS Tools
// ——————————————————————————————————

describe('BPS Tools', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);

    const toolList = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
    });
    tools = new Map(toolList.map(t => [t.name, t]));
  });

  it('bps_list_services should return all services', async () => {
    const result = await tools.get('bps_list_services')!.execute('test-call', {}) as any;
    expect(result.count).toBe(3);
  });

  it('bps_list_services should filter by entityType', async () => {
    const result = await tools.get('bps_list_services')!.execute('test-call', {
      entityType: 'store',
    }) as any;
    expect(result.count).toBe(2);
    expect(result.services.every((s: any) => s.entityType === 'store')).toBe(true);
  });

  it('bps_list_services should filter by executorType', async () => {
    const result = await tools.get('bps_list_services')!.execute('test-call', {
      executorType: 'agent',
    }) as any;
    expect(result.count).toBe(2);
  });

  it('bps_create_task should create a task', async () => {
    const result = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      entityType: 'store',
      entityId: 'store-001',
    }) as any;

    expect(result.success).toBe(true);
    expect(result.taskId).toBeDefined();
    expect(result.state).toBe('OPEN');
  });

  it('bps_create_task should return error for invalid service', async () => {
    const result = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'nonexistent',
    }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('bps_get_task should return task and metadata', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      metadata: { testKey: 'testValue' },
    }) as any;

    const result = await tools.get('bps_get_task')!.execute('test-call', {
      taskId: created.taskId,
    }) as any;

    expect(result.process).toBeDefined();
    expect(result.process.serviceId).toBe('svc-geo-publish');
    expect(result.metadata).toBeDefined();
  });

  it('bps_get_task should return error for missing task', async () => {
    const result = await tools.get('bps_get_task')!.execute('test-call', {
      taskId: 'nonexistent',
    }) as any;
    expect(result.error).toContain('not found');
  });

  it('bps_query_tasks should query by state', async () => {
    await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-geo-publish' });
    await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-data-collect' });

    const result = await tools.get('bps_query_tasks')!.execute('test-call', {
      state: 'OPEN',
    }) as any;

    expect(result.count).toBeGreaterThanOrEqual(2);
  });

  it('bps_query_tasks should query by serviceId', async () => {
    await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-geo-publish' });
    await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-data-collect' });

    const result = await tools.get('bps_query_tasks')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    expect(result.tasks.every((p: any) => p.serviceId === 'svc-geo-publish')).toBe(true);
  });

  it('bps_update_task should update state with validation', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    // OPEN → IN_PROGRESS (valid)
    const result = await tools.get('bps_update_task')!.execute('test-call', {
      taskId: created.taskId,
      state: 'IN_PROGRESS',
    }) as any;
    expect(result.success).toBe(true);
    expect(result.currentState).toBe('IN_PROGRESS');

    // IN_PROGRESS → OPEN (invalid)
    const invalid = await tools.get('bps_update_task')!.execute('test-call', {
      taskId: created.taskId,
      state: 'OPEN',
    }) as any;
    expect(invalid.success).toBe(false);
  });

  it('bps_complete_task should auto-advance from OPEN to COMPLETED', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    const result = await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: created.taskId,
      result: { summary: 'All done' },
    }) as any;

    expect(result.success).toBe(true);
    expect(result.finalState).toBe('COMPLETED');
  });

  it('bps_complete_task should handle already-completed task', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    await tools.get('bps_complete_task')!.execute('test-call', { taskId: created.taskId });
    const result = await tools.get('bps_complete_task')!.execute('test-call', { taskId: created.taskId }) as any;
    expect(result.success).toBe(true);
  });

  it('bps_complete_task should return error for nonexistent task', async () => {
    const result = await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: 'nonexistent',
    }) as any;
    expect(result.success).toBe(false);
  });

  it('bps_get_entity should get entity data', async () => {
    const dossier = engine.dossierStore.getOrCreate('store', 'store-001');
    engine.dossierStore.commit(dossier.id, { name: 'Test Store' });

    const result = await tools.get('bps_get_entity')!.execute('test-call', {
      entityType: 'store',
      entityId: 'store-001',
    }) as any;

    expect(result.data.name).toBe('Test Store');
  });

  it('bps_update_entity should commit data', async () => {
    engine.dossierStore.getOrCreate('store', 'store-002');

    const result = await tools.get('bps_update_entity')!.execute('test-call', {
      entityType: 'store',
      entityId: 'store-002',
      data: { name: 'Updated Store' },
    }) as any;

    expect(result.success).toBe(true);
    const entity = engine.dossierStore.get('store', 'store-002');
    expect(entity!.data.name).toBe('Updated Store');
  });

  it('bps_query_entities should search entities', async () => {
    const d = engine.dossierStore.getOrCreate('store', 'store-003');
    engine.dossierStore.commit(d.id, { city: 'Shanghai' });

    const result = await tools.get('bps_query_entities')!.execute('test-call', {
      entityType: 'store',
    }) as any;

    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  // ——— Phase B: bps_scan_work ———

  it('bps_scan_work should return aggregated work landscape', async () => {
    // Create tasks in various states
    const t1 = await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-geo-publish' }) as any;
    const t2 = await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-data-collect' }) as any;
    await tools.get('bps_complete_task')!.execute('test-call', { taskId: t2.taskId });
    await tools.get('bps_update_task')!.execute('test-call', { taskId: t1.taskId, state: 'IN_PROGRESS' });

    // Create an action-plan dossier
    const plan = engine.dossierStore.getOrCreate('action-plan', 'plan-001');
    engine.dossierStore.commit(plan.id, { status: 'active', type: 'finite' });

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    expect(result.inProgressTasks.length).toBeGreaterThanOrEqual(1);
    expect(result.recentlyCompleted.length).toBeGreaterThanOrEqual(1);
    expect(result.activePlans.length).toBeGreaterThanOrEqual(1);
    expect(result.failedTasks).toBeDefined();
    expect(result.openTasks).toBeDefined();
  });

  // ——— Phase B: bps_complete_task reason ———

  it('bps_complete_task should store reason in snapshot', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: created.taskId,
      reason: 'All GEO content published successfully',
    });

    const snapshot = engine.processStore.getLatestSnapshot(created.taskId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.contextData._reason).toBe('All GEO content published successfully');
  });

  // ——— Phase B: bps_update_task reason ———

  it('bps_update_task should store reason in snapshot', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    await tools.get('bps_update_task')!.execute('test-call', {
      taskId: created.taskId,
      state: 'IN_PROGRESS',
      reason: 'Starting data collection phase',
    });

    const snapshot = engine.processStore.getLatestSnapshot(created.taskId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.contextData._reason).toBe('Starting data collection phase');
  });
});

// ——————————————————————————————————
// 2b. bps_create_skill
// ——————————————————————————————————

describe('bps_create_skill', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;
  let tmpDir: string;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bps-skills-'));

    const toolList = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      skillsDir: tmpDir,
    });
    tools = new Map(toolList.map(t => [t.name, t]));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a skill file', async () => {
    const result = await tools.get('bps_create_skill')!.execute('test-call', {
      name: 'weekly-report',
      description: 'Generate a weekly operations report.',
      body: '# Weekly Report\n\nSummarize the week.',
    }) as any;

    expect(result.success).toBe(true);
    expect(result.name).toBe('weekly-report');

    const content = fs.readFileSync(path.join(tmpDir, 'weekly-report', 'SKILL.md'), 'utf-8');
    expect(content).toContain('name: weekly-report');
    expect(content).toContain('description: Generate a weekly operations report.');
    expect(content).toContain('# Weekly Report');
  });

  it('should reject invalid skill name', async () => {
    const result = await tools.get('bps_create_skill')!.execute('test-call', {
      name: 'Invalid Name!',
      description: 'Bad name',
      body: 'content',
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('kebab-case');
  });

  it('should reject duplicate skill name', async () => {
    await tools.get('bps_create_skill')!.execute('test-call', {
      name: 'my-skill',
      description: 'First',
      body: 'content',
    });

    const result = await tools.get('bps_create_skill')!.execute('test-call', {
      name: 'my-skill',
      description: 'Second',
      body: 'content',
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('should reject names starting with number', async () => {
    const result = await tools.get('bps_create_skill')!.execute('test-call', {
      name: '1bad-name',
      description: 'Bad',
      body: 'content',
    }) as any;

    expect(result.success).toBe(false);
  });

  it('should produce valid frontmatter', async () => {
    await tools.get('bps_create_skill')!.execute('test-call', {
      name: 'test-skill',
      description: 'A test skill for validation.',
      body: '# Test\n\nStep 1: do something.',
    });

    const content = fs.readFileSync(path.join(tmpDir, 'test-skill', 'SKILL.md'), 'utf-8');
    const lines = content.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('name: test-skill');
    expect(lines[2]).toBe('description: A test skill for validation.');
    expect(lines[3]).toBe('---');
    expect(lines[4]).toBe('# Test');
  });
});

// ——————————————————————————————————
// 3. bps_next_steps with non-deterministic events
// ——————————————————————————————————

const NEXT_STEPS_BLUEPRINT = `
version: "1.0"
name: "Next Steps Test Blueprint"

services:
  - id: "svc-collect"
    label: "数据采集"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"

  - id: "svc-review"
    label: "人工审核"
    serviceType: "atomic"
    executorType: "manual"
    entityType: "store"

  - id: "svc-optimize"
    label: "GEO优化"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"

events:
  - id: "evt-collect-done"
    label: "采集完成"
    evaluationMode: "deterministic"
    expression: "state == 'COMPLETED'"

  - id: "evt-needs-review"
    label: "需要人工审核"
    name: "内容质量评分低于阈值，需要人工复核确认"
    evaluationMode: "non_deterministic"

instructions:
  - id: "ins-start-review"
    label: "启动审核"
    sysCall: "start_service"

  - id: "ins-start-optimize"
    label: "启动优化"
    sysCall: "start_service"

rules:
  - id: "rule-to-review"
    label: "采集后审核"
    targetServiceId: "svc-collect"
    serviceId: "svc-collect"
    eventId: "evt-collect-done"
    instructionId: "ins-start-review"
    operandServiceId: "svc-review"
    order: 1

  - id: "rule-to-optimize"
    label: "需要优化时启动"
    targetServiceId: "svc-collect"
    serviceId: "svc-collect"
    eventId: "evt-needs-review"
    instructionId: "ins-start-optimize"
    operandServiceId: "svc-optimize"
    order: 2
`;

describe('bps_next_steps with non-deterministic events', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(NEXT_STEPS_BLUEPRINT, engine.blueprintStore);

    const toolList = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
    });
    tools = new Map(toolList.map(t => [t.name, t]));
  });

  it('should return description for non-deterministic event triggers', async () => {
    const result = await tools.get('bps_next_steps')!.execute('test-call', {
      serviceId: 'svc-collect',
    }) as any;

    expect(result.nextSteps).toHaveLength(2);

    // Deterministic event should NOT have description
    const deterministicStep = result.nextSteps.find((s: any) => s.ruleId === 'rule-to-review');
    expect(deterministicStep.trigger.evaluationMode).toBe('deterministic');
    expect(deterministicStep.trigger.description).toBeUndefined();

    // Non-deterministic event SHOULD have description
    const nonDetStep = result.nextSteps.find((s: any) => s.ruleId === 'rule-to-optimize');
    expect(nonDetStep.trigger.evaluationMode).toBe('non_deterministic');
    expect(nonDetStep.trigger.description).toBe('内容质量评分低于阈值，需要人工复核确认');
  });
});

// ——————————————————————————————————
// 4. Event Bridge
// ——————————————————————————————————

describe('BpsEventBridge', () => {
  let engine: BpsEngine;
  let runtime: MockOpenClawRuntime;

  beforeEach(() => {
    runtime = createMockRuntime();
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);

    const eventBridge = new BpsEventBridge(
      runtime.api,
      engine.tracker,
      engine.processStore,
    );
    eventBridge.setup();
  });

  it('should forward task:created to OpenClaw', () => {
    engine.tracker.createTask({ serviceId: 'svc-geo-publish' });

    const created = runtime.emittedEvents.filter(e => e.event === 'bps.task.created');
    expect(created.length).toBeGreaterThanOrEqual(1);
  });

  it('should forward task:updated to OpenClaw', () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.tracker.updateTask(task.id, { state: 'IN_PROGRESS' });

    const changed = runtime.emittedEvents.filter(e => e.event === 'bps.task.updated');
    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.some(e => e.payload['to'] === 'IN_PROGRESS')).toBe(true);
  });

  it('should forward task:completed to OpenClaw', () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.tracker.completeTask(task.id, { done: true });

    const completed = runtime.emittedEvents.filter(e => e.event === 'bps.task.completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle subagent.ended with outcome=ok and auto-complete', async () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.processStore.update(task.id, { agentSessionKey: 'test-session-1' });

    const handlers = runtime.eventHandlers.get('subagent.ended');
    expect(handlers).toBeDefined();
    await handlers![0]({ sessionKey: 'test-session-1', outcome: 'ok' });

    const updated = engine.processStore.get(task.id);
    expect(updated!.state).toBe('COMPLETED');
  });

  it('should skip already-completed task on subagent.ended', async () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.processStore.update(task.id, { agentSessionKey: 'test-session-2' });

    engine.tracker.completeTask(task.id);

    const handlers = runtime.eventHandlers.get('subagent.ended');
    await handlers![0]({ sessionKey: 'test-session-2', outcome: 'ok' });

    const updated = engine.processStore.get(task.id);
    expect(updated!.state).toBe('COMPLETED');
  });

  it('should transition to FAILED on subagent.ended with outcome=error', async () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.processStore.update(task.id, { agentSessionKey: 'test-session-3' });

    const handlers = runtime.eventHandlers.get('subagent.ended');
    await handlers![0]({ sessionKey: 'test-session-3', outcome: 'error' });

    const updated = engine.processStore.get(task.id);
    expect(updated!.state).toBe('FAILED');
  });

  it('should transition to FAILED on subagent.ended with outcome=timeout', async () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.processStore.update(task.id, { agentSessionKey: 'test-session-4' });

    const handlers = runtime.eventHandlers.get('subagent.ended');
    await handlers![0]({ sessionKey: 'test-session-4', outcome: 'timeout' });

    const updated = engine.processStore.get(task.id);
    expect(updated!.state).toBe('FAILED');
  });

  it('should transition to FAILED on subagent.ended with outcome=killed', async () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.processStore.update(task.id, { agentSessionKey: 'test-session-5' });

    const handlers = runtime.eventHandlers.get('subagent.ended');
    await handlers![0]({ sessionKey: 'test-session-5', outcome: 'killed' });

    const updated = engine.processStore.get(task.id);
    expect(updated!.state).toBe('FAILED');
  });

  it('should ignore subagent.ended for unknown session keys', async () => {
    const handlers = runtime.eventHandlers.get('subagent.ended');
    // Should not throw
    await handlers![0]({ sessionKey: 'unknown-session', outcome: 'ok' });
  });
});

// ——————————————————————————————————
// 5. ProcessStore.findBySessionKey
// ——————————————————————————————————

describe('ProcessStore.findBySessionKey', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
  });

  it('should find process by session key', () => {
    const task = engine.tracker.createTask({ serviceId: 'svc-geo-publish' });
    engine.processStore.update(task.id, { agentSessionKey: 'my-session-key' });

    const found = engine.processStore.findBySessionKey('my-session-key');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(task.id);
    expect(found!.agentSessionKey).toBe('my-session-key');
  });

  it('should return null for unknown session key', () => {
    const found = engine.processStore.findBySessionKey('nonexistent');
    expect(found).toBeNull();
  });
});

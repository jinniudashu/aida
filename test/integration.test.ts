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
import { ManagementStore } from '../src/management/management-store.js';
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
  it('should register 13 tools and subscribe to events', () => {
    const runtime = createMockRuntime();
    const { engine } = registerBpsPlugin(runtime.api);

    expect(runtime.registeredTools).toHaveLength(17);
    expect(runtime.registeredTools.map(t => t.name).sort()).toEqual([
      'bps_batch_update',
      'bps_complete_task',
      'bps_create_skill',
      'bps_create_task',
      'bps_get_collaboration_response',
      'bps_get_entity',
      'bps_get_task',
      'bps_list_services',
      'bps_load_blueprint',
      'bps_next_steps',
      'bps_query_entities',
      'bps_query_tasks',
      'bps_register_agent',
      'bps_request_collaboration',
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

    expect(result.inProgressTasks.total).toBeGreaterThanOrEqual(1);
    expect(result.recentlyCompleted.total).toBeGreaterThanOrEqual(1);
    expect(result.activePlans.length).toBeGreaterThanOrEqual(1);
    expect(result.failedTasks).toBeDefined();
    expect(result.openTasks).toBeDefined();
    expect(result.overdueTasks).toBeDefined();
    expect(typeof result.summary).toBe('string');
  });

  // ——— P0-b: Priority + Deadline ———

  it('bps_create_task should accept priority and deadline', async () => {
    const result = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      entityType: 'store',
      entityId: 'store-001',
      priority: 5,
      deadline: '2026-03-15T18:00:00Z',
    }) as any;

    expect(result.success).toBe(true);
    const task = engine.processStore.get(result.taskId)!;
    expect(task.priority).toBe(5);
    expect(task.deadline).toBe('2026-03-15T18:00:00Z');
  });

  it('bps_scan_work should return overdue tasks', async () => {
    // Create a task with past deadline
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      entityType: 'store',
      entityId: 'store-001',
      deadline: '2020-01-01T00:00:00Z',
    });
    // Create a task with future deadline
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-002',
      deadline: '2099-12-31T23:59:59Z',
    });

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    expect(result.overdueTasks.total).toBeGreaterThanOrEqual(1);
    expect(result.overdueTasks.items[0].deadline).toBe('2020-01-01T00:00:00Z');
    // Future deadline should not be in overdue
    expect(result.overdueTasks.items.every((t: any) => t.deadline < new Date().toISOString())).toBe(true);
  });

  it('bps_scan_work should include priority and deadline in task summaries', async () => {
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      priority: 10,
      deadline: '2026-04-01T12:00:00Z',
    });

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    const task = result.openTasks.items.find((t: any) => t.priority === 10);
    expect(task).toBeDefined();
    expect(task.priority).toBe(10);
    expect(task.deadline).toBe('2026-04-01T12:00:00Z');
  });

  it('bps_scan_work should sort tasks by deadline ASC then priority DESC', async () => {
    // Create tasks with different priorities and deadlines
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      priority: 1,
      deadline: '2026-06-01T00:00:00Z',
    });
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-data-collect',
      priority: 10,
      deadline: '2026-03-01T00:00:00Z',
    });
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      priority: 5,
      deadline: '2026-03-01T00:00:00Z',
    });

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    // First should be earliest deadline with highest priority
    expect(result.openTasks.items[0].deadline).toBe('2026-03-01T00:00:00Z');
    expect(result.openTasks.items[0].priority).toBe(10);
    // Second should be same deadline, lower priority
    expect(result.openTasks.items[1].deadline).toBe('2026-03-01T00:00:00Z');
    expect(result.openTasks.items[1].priority).toBe(5);
    // Third should be later deadline
    expect(result.openTasks.items[2].deadline).toBe('2026-06-01T00:00:00Z');
  });

  // ——— P0-c: Structured outcome ———

  it('bps_complete_task should accept structured outcome', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    const result = await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: created.taskId,
      outcome: 'partial',
      reason: 'Only 2 of 3 platforms completed',
    }) as any;

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('partial');

    // Verify outcome stored in snapshot
    const snapshot = engine.processStore.getLatestSnapshot(created.taskId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.contextData._outcome).toBe('partial');
    expect(snapshot!.contextData._reason).toBe('Only 2 of 3 platforms completed');
  });

  it('bps_complete_task should default outcome to success', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    const result = await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: created.taskId,
    }) as any;

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('success');
  });

  it('bps_scan_work should return outcome distribution', async () => {
    // Create and complete tasks with different outcomes
    const t1 = await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-geo-publish' }) as any;
    const t2 = await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-data-collect' }) as any;
    const t3 = await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-geo-publish' }) as any;

    await tools.get('bps_complete_task')!.execute('test-call', { taskId: t1.taskId, outcome: 'success' });
    await tools.get('bps_complete_task')!.execute('test-call', { taskId: t2.taskId, outcome: 'partial' });
    await tools.get('bps_complete_task')!.execute('test-call', { taskId: t3.taskId, outcome: 'failed' });

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    expect(result.outcomeDistribution).toBeDefined();
    expect(result.outcomeDistribution.success).toBeGreaterThanOrEqual(1);
    expect(result.outcomeDistribution.partial).toBeGreaterThanOrEqual(1);
    expect(result.outcomeDistribution.failed).toBeGreaterThanOrEqual(1);
  });

  // ——— P1-b: Information summary layer ———

  it('bps_scan_work should return top-N with total/showing metadata', async () => {
    // Create 7 open tasks — should be capped at top 5
    for (let i = 0; i < 7; i++) {
      await tools.get('bps_create_task')!.execute('test-call', {
        serviceId: 'svc-geo-publish',
        priority: i,
      });
    }

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    // openTasks should have metadata shape
    expect(result.openTasks.total).toBeGreaterThanOrEqual(7);
    expect(result.openTasks.showing).toBeLessThanOrEqual(5);
    expect(result.openTasks.items.length).toBe(result.openTasks.showing);
  });

  it('bps_scan_work should return summary string', async () => {
    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    expect(typeof result.summary).toBe('string');
    expect(result.summary).toContain('open');
    expect(result.summary).toContain('in-progress');
  });

  it('bps_query_entities brief mode should omit data', async () => {
    // Create an entity
    await tools.get('bps_update_entity')!.execute('test-call', {
      entityType: 'store',
      entityId: 'brief-test-store',
      data: { name: 'Test Store', city: 'Guangzhou', largeField: 'x'.repeat(1000) },
    });

    const fullResult = await tools.get('bps_query_entities')!.execute('test-call', {
      entityType: 'store',
      brief: false,
    }) as any;
    const briefResult = await tools.get('bps_query_entities')!.execute('test-call', {
      entityType: 'store',
      brief: true,
    }) as any;

    // Brief mode should have entities
    expect(briefResult.count).toBeGreaterThanOrEqual(1);
    const briefEntity = briefResult.entities.find((e: any) => e.entityId === 'brief-test-store');
    expect(briefEntity).toBeDefined();
    expect(briefEntity.entityType).toBe('store');
    expect(briefEntity.version).toBeDefined();
    expect(briefEntity.updatedAt).toBeDefined();
    // Brief mode should NOT have data or dossierId
    expect(briefEntity.data).toBeUndefined();
    expect(briefEntity.dossierId).toBeUndefined();

    // Full mode should have data
    const fullEntity = fullResult.entities.find((e: any) => e.entityId === 'brief-test-store');
    expect(fullEntity.data).toBeDefined();
    expect(fullEntity.data.name).toBe('Test Store');
  });

  // ——— P2-b: Entity relations ———

  it('bps_update_entity should accept and store relations', async () => {
    // Create two entities
    await tools.get('bps_update_entity')!.execute('test-call', {
      entityType: 'store', entityId: 'store-a',
      data: { name: 'Store A' },
    });
    await tools.get('bps_update_entity')!.execute('test-call', {
      entityType: 'content', entityId: 'content-001',
      data: { title: 'GEO Article' },
      relations: [
        { targetEntityType: 'store', targetEntityId: 'store-a', relationType: 'references' },
      ],
    });

    // Get entity and check relations
    const result = await tools.get('bps_get_entity')!.execute('test-call', {
      entityType: 'content', entityId: 'content-001',
    }) as any;

    expect(result.dossier.relations).toBeDefined();
    expect(result.dossier.relations.length).toBe(1);
    expect(result.dossier.relations[0].targetEntityType).toBe('store');
    expect(result.dossier.relations[0].relationType).toBe('references');
  });

  it('bps_get_entity should return related entity summaries', async () => {
    await tools.get('bps_update_entity')!.execute('test-call', {
      entityType: 'store', entityId: 'rel-store-1',
      data: { name: 'Related Store' },
    });
    await tools.get('bps_update_entity')!.execute('test-call', {
      entityType: 'report', entityId: 'rel-report-1',
      data: { title: 'Monthly Report' },
      relations: [
        { targetEntityType: 'store', targetEntityId: 'rel-store-1', relationType: 'depends_on' },
        { targetEntityType: 'store', targetEntityId: 'nonexistent', relationType: 'references' },
      ],
    });

    const result = await tools.get('bps_get_entity')!.execute('test-call', {
      entityType: 'report', entityId: 'rel-report-1',
    }) as any;

    expect(result.relatedEntities).toBeDefined();
    expect(result.relatedEntities.length).toBe(2);
    // Existing entity should have updatedAt and version
    const existing = result.relatedEntities.find((r: any) => r.targetEntityId === 'rel-store-1');
    expect(existing.updatedAt).toBeDefined();
    expect(existing.version).toBeGreaterThanOrEqual(1);
    // Non-existent entity should have undefined fields
    const missing = result.relatedEntities.find((r: any) => r.targetEntityId === 'nonexistent');
    expect(missing.updatedAt).toBeUndefined();
  });

  it('bps_next_steps should return recommendation field', async () => {
    const result = await tools.get('bps_next_steps')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    // Whether there are steps or not, recommendation should be string or undefined
    if (result.nextSteps && result.nextSteps.length > 0) {
      expect(typeof result.recommendation).toBe('string');
      expect(result.recommendation).toContain('Recommended:');
    } else {
      expect(result.recommendation).toBeUndefined();
    }
  });

  // ——— P2-a: Process groups ———

  it('bps_create_task should accept groupId', async () => {
    const result = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      groupId: 'plan-q1-rollout',
    }) as any;

    expect(result.success).toBe(true);
    const task = engine.processStore.get(result.taskId)!;
    expect(task.groupId).toBe('plan-q1-rollout');
  });

  it('bps_batch_update should update all tasks in a group', async () => {
    // Create 3 tasks in the same group
    const t1 = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish', groupId: 'batch-test',
    }) as any;
    const t2 = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-data-collect', groupId: 'batch-test',
    }) as any;
    const t3 = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish', groupId: 'batch-test',
    }) as any;
    // Create one task NOT in the group
    const t4 = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    const result = await tools.get('bps_batch_update')!.execute('test-call', {
      groupId: 'batch-test',
      state: 'FAILED',
      reason: 'Plan cancelled',
    }) as any;

    expect(result.success).toBe(true);
    expect(result.updated).toBe(3);

    // Verify group tasks are FAILED
    expect(engine.processStore.get(t1.taskId)!.state).toBe('FAILED');
    expect(engine.processStore.get(t2.taskId)!.state).toBe('FAILED');
    expect(engine.processStore.get(t3.taskId)!.state).toBe('FAILED');
    // Non-group task should remain OPEN
    expect(engine.processStore.get(t4.taskId)!.state).toBe('OPEN');
  });

  it('bps_batch_update should respect filterState', async () => {
    const t1 = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish', groupId: 'filter-test',
    }) as any;
    const t2 = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-data-collect', groupId: 'filter-test',
    }) as any;

    // Move t1 to IN_PROGRESS
    await tools.get('bps_update_task')!.execute('test-call', {
      taskId: t1.taskId, state: 'IN_PROGRESS',
    });

    // Batch update only OPEN tasks
    const result = await tools.get('bps_batch_update')!.execute('test-call', {
      groupId: 'filter-test',
      state: 'FAILED',
      filterState: 'OPEN',
    }) as any;

    expect(result.updated).toBe(1);
    // t1 was IN_PROGRESS, should be unchanged
    expect(engine.processStore.get(t1.taskId)!.state).toBe('IN_PROGRESS');
    // t2 was OPEN, should be FAILED
    expect(engine.processStore.get(t2.taskId)!.state).toBe('FAILED');
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

  it('should auto-inject management section when constraints exist', async () => {
    const mgmtStore = new ManagementStore(engine.db);
    mgmtStore.loadConstraints([{
      id: 'c-test',
      policyId: 'p-test',
      label: 'Content publish requires approval',
      scope: { tools: ['bps_update_entity'], entityTypes: ['geo-content'] },
      condition: 'publishReady == 0',
      onViolation: 'REQUIRE_APPROVAL',
      severity: 'HIGH',
      approver: 'admin',
      message: 'Publishing content requires human approval',
    }]);

    const govTools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      skillsDir: tmpDir,
      managementStore: mgmtStore,
    });
    const govToolMap = new Map(govTools.map(t => [t.name, t]));

    await govToolMap.get('bps_create_skill')!.execute('test-call', {
      name: 'gov-test-skill',
      description: 'Test management injection.',
      body: '# Test\n\nStep 1: do something.',
    });

    const content = fs.readFileSync(path.join(tmpDir, 'gov-test-skill', 'SKILL.md'), 'utf-8');
    expect(content).toContain('## Management');
    expect(content).toContain('Content publish requires approval');
    expect(content).toContain('REQUIRE_APPROVAL');
    expect(content).toContain('Always create/update an entity via `bps_update_entity`');
  });

  it('should not inject management section when no constraints exist', async () => {
    const mgmtStore = new ManagementStore(engine.db);

    const govTools = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      skillsDir: tmpDir,
      managementStore: mgmtStore,
    });
    const govToolMap = new Map(govTools.map(t => [t.name, t]));

    await govToolMap.get('bps_create_skill')!.execute('test-call', {
      name: 'no-gov-skill',
      description: 'No management.',
      body: '# Test\n\nStep 1: do something.',
    });

    const content = fs.readFileSync(path.join(tmpDir, 'no-gov-skill', 'SKILL.md'), 'utf-8');
    expect(content).not.toContain('## Management');
  });
});

// ——————————————————————————————————
// 2b2. Skill metrics tracking (P1-c)
// ——————————————————————————————————

describe('Skill metrics tracking', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;
  let tmpDir: string;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bps-skill-metrics-'));

    // Create a fake skill directory matching a service ID
    const skillDir = path.join(tmpDir, 'svc-geo-publish');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: svc-geo-publish\n---\n# GEO Publish');

    const toolList = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      skillsDir: tmpDir,
      skillMetricsStore: engine.skillMetricsStore,
    });
    tools = new Map(toolList.map(t => [t.name, t]));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record skill metric on task completion when serviceId matches skill', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;

    await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: created.taskId,
      outcome: 'success',
    });

    const summaries = engine.skillMetricsStore.getSummaries();
    expect(summaries.length).toBe(1);
    expect(summaries[0].skillName).toBe('svc-geo-publish');
    expect(summaries[0].totalInvocations).toBe(1);
    expect(summaries[0].successCount).toBe(1);
  });

  it('should not record skill metric when serviceId has no matching skill', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-data-collect',
    }) as any;

    await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: created.taskId,
    });

    const summaries = engine.skillMetricsStore.getSummaries();
    expect(summaries.length).toBe(0);
  });

  it('bps_scan_work should report dormant skills', async () => {
    // Create another skill directory (never invoked = dormant)
    const dormantDir = path.join(tmpDir, 'old-unused-skill');
    fs.mkdirSync(dormantDir, { recursive: true });
    fs.writeFileSync(path.join(dormantDir, 'SKILL.md'), '---\nname: old-unused-skill\n---\n# Old');

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    // Both skills are dormant: svc-geo-publish (never invoked) + old-unused-skill (never invoked)
    expect(result.dormantSkills).toBeDefined();
    expect(result.dormantSkills).toContain('old-unused-skill');
    expect(result.dormantSkills).toContain('svc-geo-publish');
  });

  it('bps_scan_work should not report recently used skills as dormant', async () => {
    // Use the svc-geo-publish skill
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;
    await tools.get('bps_complete_task')!.execute('test-call', { taskId: created.taskId });

    // Create a dormant skill
    const dormantDir = path.join(tmpDir, 'old-unused-skill');
    fs.mkdirSync(dormantDir, { recursive: true });
    fs.writeFileSync(path.join(dormantDir, 'SKILL.md'), '---\nname: old-unused-skill\n---\n# Old');

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    // Only old-unused-skill should be dormant, svc-geo-publish was just used
    expect(result.dormantSkills).toBeDefined();
    expect(result.dormantSkills).toContain('old-unused-skill');
    expect(result.dormantSkills).not.toContain('svc-geo-publish');
  });
});

// ——————————————————————————————————
// 2c. bps_register_agent
// ——————————————————————————————————

describe('bps_register_agent', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;
  let tmpDir: string;
  let configPath: string;

  const VALID_INPUT = {
    id: 'store-bot',
    name: '小闲',
    theme: 'Store consultation assistant',
    emoji: '🎤',
    toolsProfile: 'full',
    workspace: {
      identity: 'Name: 小闲\nCreature: AI assistant\nVibe: warm and friendly\nEmoji: 🎤',
      soul: '# Core Truths\n\nYou are a store consultant.',
      agents: '# Boot\n\nGreet warmly.',
    },
  };

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bps-agent-'));

    // Create a minimal openclaw.json
    configPath = path.join(tmpDir, 'openclaw.json');
    fs.writeFileSync(configPath, JSON.stringify({
      agents: {
        list: [{ id: 'main', workspace: '~/.openclaw/workspace' }],
      },
    }, null, 2), 'utf-8');

    // Point OPENCLAW_HOME to tmpDir
    process.env.OPENCLAW_HOME = tmpDir;

    const toolList = createBpsTools({
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
    });
    tools = new Map(toolList.map(t => [t.name, t]));
  });

  afterEach(() => {
    delete process.env.OPENCLAW_HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should register an agent and write workspace files', async () => {
    const result = await tools.get('bps_register_agent')!.execute('test-call', VALID_INPUT) as any;

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('store-bot');
    expect(result.registeredAgents).toBe(2);

    // Verify workspace files
    const wsDir = path.join(tmpDir, 'workspace-store-bot');
    expect(fs.existsSync(path.join(wsDir, 'IDENTITY.md'))).toBe(true);
    expect(fs.existsSync(path.join(wsDir, 'SOUL.md'))).toBe(true);
    expect(fs.existsSync(path.join(wsDir, 'AGENTS.md'))).toBe(true);

    const identity = fs.readFileSync(path.join(wsDir, 'IDENTITY.md'), 'utf-8');
    expect(identity).toContain('小闲');

    // Verify openclaw.json
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.agents.list).toHaveLength(2);
    expect(config.agents.list[1].id).toBe('store-bot');
    expect(config.agents.list[1].tools.profile).toBe('full');
  });

  it('should reject invalid tools.profile', async () => {
    const result = await tools.get('bps_register_agent')!.execute('test-call', {
      ...VALID_INPUT,
      toolsProfile: 'standard',
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid tools.profile');
    expect(result.error).toContain('standard');

    // Verify openclaw.json was NOT modified
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.agents.list).toHaveLength(1);
  });

  it('should reject invalid agent ID', async () => {
    const result = await tools.get('bps_register_agent')!.execute('test-call', {
      ...VALID_INPUT,
      id: 'Invalid Name!',
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('kebab-case');
  });

  it('should reject duplicate agent ID', async () => {
    await tools.get('bps_register_agent')!.execute('test-call', VALID_INPUT);

    const result = await tools.get('bps_register_agent')!.execute('test-call', VALID_INPUT) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('already registered');
  });

  it('should accept all four valid profile values', async () => {
    for (const profile of ['minimal', 'coding', 'messaging', 'full']) {
      // Reset config between iterations
      fs.writeFileSync(configPath, JSON.stringify({
        agents: { list: [{ id: 'main' }] },
      }, null, 2), 'utf-8');

      const result = await tools.get('bps_register_agent')!.execute('test-call', {
        ...VALID_INPUT,
        toolsProfile: profile,
      }) as any;

      expect(result.success).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.agents.list[1].tools.profile).toBe(profile);

      // Clean up workspace for next iteration
      fs.rmSync(path.join(tmpDir, 'workspace-store-bot'), { recursive: true, force: true });
    }
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

// ——————————————————————————————————
// 6. Information Saturation Signal
// ——————————————————————————————————

describe('Information Saturation Signal', () => {
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

  // A1: bps_query_entities _signal.completeness
  it('bps_query_entities should return _signal with FULL completeness when all results fit', async () => {
    engine.dossierStore.getOrCreate('store', 'store-001');
    engine.dossierStore.commit(engine.dossierStore.getOrCreate('store', 'store-001').id, { name: 'A' });

    const result = await tools.get('bps_query_entities')!.execute('test-call', {
      entityType: 'store',
    }) as any;

    expect(result._signal).toBeDefined();
    expect(result._signal.completeness).toBe('FULL');
    expect(result._signal.hint).toContain('proceed to action');
  });

  it('bps_query_entities should return _signal with PARTIAL when results truncated', async () => {
    // Create 3 entities but limit to 2
    for (let i = 0; i < 3; i++) {
      const d = engine.dossierStore.getOrCreate('store', `partial-${i}`);
      engine.dossierStore.commit(d.id, { name: `Store ${i}` });
    }

    const result = await tools.get('bps_query_entities')!.execute('test-call', {
      entityType: 'store',
      limit: 2,
    }) as any;

    expect(result._signal.completeness).toBe('PARTIAL');
    expect(result._signal.hint).toContain('2 of 3');
  });

  // A2: bps_scan_work _signal.readiness
  it('bps_scan_work should return _signal with ACTION_NEEDED when tasks exist', async () => {
    await tools.get('bps_create_task')!.execute('test-call', { serviceId: 'svc-geo-publish' });

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    expect(result._signal).toBeDefined();
    expect(result._signal.readiness).toBe('ACTION_NEEDED');
    expect(result._signal.actionableItems).toBeGreaterThan(0);
    expect(result._signal.hint).toContain('need action');
  });

  it('bps_scan_work should return _signal with ALL_CLEAR when no pending work', async () => {
    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    expect(result._signal.readiness).toBe('ALL_CLEAR');
    expect(result._signal.actionableItems).toBe(0);
  });

  // B1: bps_scan_work suggestedActions
  it('bps_scan_work should return suggestedActions for overdue tasks', async () => {
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
      deadline: '2020-01-01T00:00:00Z',
    });

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    expect(result.suggestedActions).toBeDefined();
    expect(Array.isArray(result.suggestedActions)).toBe(true);
    const overdueSuggestion = result.suggestedActions.find((a: any) => a.reason.includes('overdue'));
    expect(overdueSuggestion).toBeDefined();
    expect(overdueSuggestion.tool).toBe('bps_update_task');
    expect(overdueSuggestion.params.taskId).toBeDefined();
  });

  it('bps_scan_work should return suggestedActions for failed tasks', async () => {
    const created = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-geo-publish',
    }) as any;
    // Fail the task
    engine.tracker.updateTask(created.taskId, { state: 'IN_PROGRESS' });
    engine.tracker.failTask(created.taskId, 'test failure');

    const result = await tools.get('bps_scan_work')!.execute('test-call', {}) as any;

    const retrySuggestion = result.suggestedActions.find((a: any) => a.reason.includes('Retry'));
    expect(retrySuggestion).toBeDefined();
    expect(retrySuggestion.tool).toBe('bps_create_task');
    expect(retrySuggestion.params.serviceId).toBe('svc-geo-publish');
  });

  // B2: bps_next_steps readyToExecute
  it('bps_next_steps should return _signal with readySteps count', async () => {
    const result = await tools.get('bps_next_steps')!.execute('test-call', {
      serviceId: 'svc-onboard',
    }) as any;

    expect(result._signal).toBeDefined();
    expect(typeof result._signal.readySteps).toBe('number');
    expect(typeof result._signal.hint).toBe('string');
  });

  // A3: Consecutive read counter
  it('should inject _readSignal after 5 consecutive read calls', async () => {
    // Make 5 consecutive read calls
    for (let i = 0; i < 4; i++) {
      const result = await tools.get('bps_list_services')!.execute(`call-${i}`, {}) as any;
      expect(result._readSignal).toBeUndefined();
    }

    // 5th consecutive read should trigger signal
    const result5 = await tools.get('bps_list_services')!.execute('call-5', {}) as any;
    expect(result5._readSignal).toBeDefined();
    expect(result5._readSignal.consecutiveReads).toBe(5);
    expect(result5._readSignal.message).toContain('consecutive read calls');
    expect(result5._readSignal.message).toContain('bps_update_entity');
  });

  it('should reset _readSignal counter after a write call', async () => {
    // Make 4 reads
    for (let i = 0; i < 4; i++) {
      await tools.get('bps_list_services')!.execute(`call-${i}`, {});
    }

    // Write call resets counter
    await tools.get('bps_update_entity')!.execute('write-call', {
      entityType: 'test', entityId: 'reset-test', data: { x: 1 },
    });

    // Next 4 reads should NOT trigger signal
    for (let i = 0; i < 4; i++) {
      const result = await tools.get('bps_list_services')!.execute(`post-write-${i}`, {}) as any;
      expect(result._readSignal).toBeUndefined();
    }

    // But the 5th read after reset does trigger
    const result5 = await tools.get('bps_list_services')!.execute('post-write-5', {}) as any;
    expect(result5._readSignal).toBeDefined();
    expect(result5._readSignal.consecutiveReads).toBe(5);
  });

  it('should accumulate _readSignal past threshold', async () => {
    // Make 7 consecutive reads
    for (let i = 0; i < 7; i++) {
      await tools.get('bps_query_entities')!.execute(`call-${i}`, {});
    }

    const result = await tools.get('bps_scan_work')!.execute('call-8', {}) as any;
    expect(result._readSignal).toBeDefined();
    expect(result._readSignal.consecutiveReads).toBe(8);
  });
});

// ——————————————————————————————————
// 7. Tool Observer (after_tool_call Hook)
// ——————————————————————————————————

import { registerToolObserver } from '../src/integration/tool-observer.js';

describe('ToolObserver', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
  });

  function createMockApiWithHook() {
    const hooks = new Map<string, Array<(payload: Record<string, unknown>) => void>>();
    const api: OpenClawPluginApi = {
      registerTool() {},
      onEvent() {},
      emitEvent() {},
      onHook(hookName: string, handler: (p: Record<string, unknown>) => void) {
        const list = hooks.get(hookName) ?? [];
        list.push(handler);
        hooks.set(hookName, list);
      },
    };
    return { api, hooks };
  }

  it('should register successfully when onHook is available', () => {
    const { api } = createMockApiWithHook();
    const result = registerToolObserver({ api, tracker: engine.tracker });
    expect(result).toBe(true);
  });

  it('should return false when no hook registration is available', () => {
    const api: OpenClawPluginApi = {
      registerTool() {},
      onEvent() {},
      emitEvent() {},
    };
    const result = registerToolObserver({ api, tracker: engine.tracker });
    expect(result).toBe(false);
  });

  it('should emit tool:native_call for write tool', () => {
    const { api, hooks } = createMockApiWithHook();
    registerToolObserver({ api, tracker: engine.tracker });

    const events: Array<Record<string, unknown>> = [];
    engine.tracker.on('tool:native_call', (payload: Record<string, unknown>) => {
      events.push(payload);
    });

    const handler = hooks.get('after_tool_call')![0];
    handler({ tool: 'write', input: { file_path: '/tmp/test.txt' }, duration: 42 });

    expect(events).toHaveLength(1);
    expect(events[0].tool).toBe('write');
    expect(events[0].path).toBe('/tmp/test.txt');
    expect(events[0].duration).toBe(42);
  });

  it('should emit tool:native_call for edit tool', () => {
    const { api, hooks } = createMockApiWithHook();
    registerToolObserver({ api, tracker: engine.tracker });

    const events: Array<Record<string, unknown>> = [];
    engine.tracker.on('tool:native_call', (payload: Record<string, unknown>) => {
      events.push(payload);
    });

    const handler = hooks.get('after_tool_call')![0];
    handler({ tool: 'edit', input: { path: '/tmp/edit.txt' } });

    expect(events).toHaveLength(1);
    expect(events[0].tool).toBe('edit');
  });

  it('should NOT emit tool:native_call for BPS tools', () => {
    const { api, hooks } = createMockApiWithHook();
    registerToolObserver({ api, tracker: engine.tracker });

    const events: Array<Record<string, unknown>> = [];
    engine.tracker.on('tool:native_call', (payload: Record<string, unknown>) => {
      events.push(payload);
    });

    const handler = hooks.get('after_tool_call')![0];
    handler({ tool: 'bps_update_entity', input: { entityType: 'store', entityId: 's1' } });

    expect(events).toHaveLength(0);
  });

  it('should emit tool:management_bypass when write targets AIDA data dir', () => {
    const { api, hooks } = createMockApiWithHook();
    registerToolObserver({ api, tracker: engine.tracker });

    const bypasses: Array<Record<string, unknown>> = [];
    engine.tracker.on('tool:management_bypass', (payload: Record<string, unknown>) => {
      bypasses.push(payload);
    });

    const handler = hooks.get('after_tool_call')![0];
    const aidaPath = path.join(os.homedir(), '.aida', 'data', 'something.json');
    handler({ tool: 'write', input: { file_path: aidaPath } });

    expect(bypasses).toHaveLength(1);
    expect(bypasses[0].tool).toBe('write');
    expect(bypasses[0].path).toBe(aidaPath);
    expect(typeof bypasses[0].message).toBe('string');
  });

  it('should NOT emit management_bypass for writes outside AIDA dir', () => {
    const { api, hooks } = createMockApiWithHook();
    registerToolObserver({ api, tracker: engine.tracker });

    const bypasses: Array<Record<string, unknown>> = [];
    engine.tracker.on('tool:management_bypass', (payload: Record<string, unknown>) => {
      bypasses.push(payload);
    });

    const handler = hooks.get('after_tool_call')![0];
    handler({ tool: 'write', input: { file_path: '/tmp/safe.txt' } });

    expect(bypasses).toHaveLength(0);
  });

  it('should detect exec commands writing to AIDA dir', () => {
    const { api, hooks } = createMockApiWithHook();
    registerToolObserver({ api, tracker: engine.tracker });

    const bypasses: Array<Record<string, unknown>> = [];
    engine.tracker.on('tool:management_bypass', (payload: Record<string, unknown>) => {
      bypasses.push(payload);
    });

    const handler = hooks.get('after_tool_call')![0];
    const aidaDir = path.join(os.homedir(), '.aida');
    handler({ tool: 'exec', input: { command: `echo "data" > ${aidaDir}/test.txt` } });

    expect(bypasses).toHaveLength(1);
  });

  it('should NOT flag exec commands that only read AIDA dir', () => {
    const { api, hooks } = createMockApiWithHook();
    registerToolObserver({ api, tracker: engine.tracker });

    const bypasses: Array<Record<string, unknown>> = [];
    engine.tracker.on('tool:management_bypass', (payload: Record<string, unknown>) => {
      bypasses.push(payload);
    });

    const handler = hooks.get('after_tool_call')![0];
    const aidaDir = path.join(os.homedir(), '.aida');
    handler({ tool: 'exec', input: { command: `cat ${aidaDir}/project.yaml` } });

    expect(bypasses).toHaveLength(0);
  });

  it('should fall back to api.on() if onHook is not available', () => {
    const hooks = new Map<string, Array<(payload: Record<string, unknown>) => void>>();
    const api: OpenClawPluginApi = {
      registerTool() {},
      onEvent() {},
      emitEvent() {},
    };
    // Simulate OpenClaw versions that use .on() for hooks
    (api as any).on = (name: string, handler: (p: Record<string, unknown>) => void) => {
      const list = hooks.get(name) ?? [];
      list.push(handler);
      hooks.set(name, list);
    };

    const result = registerToolObserver({ api, tracker: engine.tracker });
    expect(result).toBe(true);
    expect(hooks.has('after_tool_call')).toBe(true);
  });
});

/**
 * Aida 端到端测试
 *
 * 验证从 Agent workspace 部署到 BPS 任务追踪的完整链路。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromYaml,
  loadBlueprintFromString,
} from '../src/index.js';
import { createBpsTools } from '../src/integration/tools.js';
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

// ——— Path helpers ———

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = resolve(__dirname, '../agents');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const GEO_KTV_BLUEPRINT = resolve(FIXTURES_DIR, 'geo-ktv-changsha.yaml');

// ——————————————————————————————————
// 1. Workspace 部署验证
// ——————————————————————————————————

describe('Workspace 部署验证', () => {
  it('Aida workspace 文件存在', () => {
    const identityPath = resolve(AGENTS_DIR, 'aida/IDENTITY.md');
    const soulPath = resolve(AGENTS_DIR, 'aida/SOUL.md');
    const agentsPath = resolve(AGENTS_DIR, 'aida/AGENTS.md');

    expect(existsSync(identityPath)).toBe(true);
    expect(existsSync(soulPath)).toBe(true);
    expect(existsSync(agentsPath)).toBe(true);
  });

  it('Aida Skills 文件存在', () => {
    const skills = ['project-init', 'action-plan', 'dashboard-guide', 'blueprint-modeling', 'agent-create'];
    for (const skill of skills) {
      expect(existsSync(resolve(AGENTS_DIR, `aida/skills/${skill}/SKILL.md`))).toBe(true);
    }
  });

  it('归档 Agent workspace 保留在 _archived/', () => {
    expect(existsSync(resolve(AGENTS_DIR, '_archived/org-architect/SOUL.md'))).toBe(true);
    expect(existsSync(resolve(AGENTS_DIR, '_archived/bps-expert/SOUL.md'))).toBe(true);
  });
});

// ——————————————————————————————————
// 2. BPS 工具链（geo-ktv 蓝图）
// ——————————————————————————————————

describe('BPS 工具链', () => {
  let runtime: MockOpenClawRuntime;
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    runtime = createMockRuntime();
    const result = registerBpsPlugin(runtime.api);
    engine = result.engine;

    loadBlueprintFromYaml(GEO_KTV_BLUEPRINT, engine.blueprintStore);

    tools = new Map(runtime.registeredTools.map(t => [t.name, t]));
  });

  it('应加载全部服务（geo-ktv 蓝图）', async () => {
    const result = await tools.get('bps_list_services')!.execute('test-call', {}) as any;
    expect(result.count).toBeGreaterThanOrEqual(12);
  });

  it('应创建任务、查询、完成', async () => {
    // create task
    const started = await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-changsha-001',
    }) as any;
    expect(started.success).toBe(true);
    expect(started.taskId).toBeDefined();
    expect(started.state).toBe('OPEN');

    // query tasks
    const queried = await tools.get('bps_query_tasks')!.execute('test-call', {
      serviceId: 'svc-data-collect',
    }) as any;
    expect(queried.count).toBeGreaterThanOrEqual(1);
    expect(queried.tasks.some((p: any) => p.id === started.taskId)).toBe(true);

    // complete task
    const completed = await tools.get('bps_complete_task')!.execute('test-call', {
      taskId: started.taskId,
      result: { data: '采集完成' },
    }) as any;
    expect(completed.success).toBe(true);
    expect(completed.finalState).toBe('COMPLETED');
  });

  it('应支持 entity CRUD（通过 engine.dossierStore）', () => {
    const dossier = engine.dossierStore.getOrCreate('store', 'store-changsha-001');
    expect(dossier.id).toBeDefined();

    const ver = engine.dossierStore.commit(dossier.id, {
      name: '长沙新天地自助KTV', city: '长沙', district: '天心区',
    }, { message: 'Initial store data' });
    expect(ver.version).toBe(1);

    const result = engine.dossierStore.get('store', 'store-changsha-001');
    expect(result).not.toBeNull();
    expect(result!.data.name).toBe('长沙新天地自助KTV');

    const entities = engine.dossierStore.search({ entityType: 'store' });
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('应返回 dashboard 概览（通过 engine.dashboardQuery）', async () => {
    await tools.get('bps_create_task')!.execute('test-call', {
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-001',
    });

    const overview = engine.dashboardQuery.getOverview();
    expect(overview.services).toBeDefined();
    expect(overview.services.totalCount).toBeGreaterThanOrEqual(12);
    expect(overview.processes).toBeDefined();
    expect(overview.processes.totalCount).toBeGreaterThanOrEqual(1);
  });
});

// ——————————————————————————————————
// 3. 任务追踪链路
// ——————————————————————————————————

describe('任务追踪链路', () => {
  let runtime: MockOpenClawRuntime;
  let engine: BpsEngine;

  beforeEach(() => {
    runtime = createMockRuntime();
    const result = registerBpsPlugin(runtime.api);
    engine = result.engine;
    loadBlueprintFromYaml(GEO_KTV_BLUEPRINT, engine.blueprintStore);
  });

  it('应创建父子任务并构建任务树', () => {
    const opsTask = engine.tracker.createTask({
      serviceId: 'svc-geo-store-ops',
      entityType: 'store',
      entityId: 'store-changsha-001',
    });

    const collectTask = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-changsha-001',
      parentId: opsTask.id,
    });

    // Task tree should show parent-child relationship
    const tree = engine.tracker.getTaskTree(opsTask.id);
    expect(tree).not.toBeNull();
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].process.serviceId).toBe('svc-data-collect');
  });

  it('应记录任务完成链路', () => {
    const t1 = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-changsha-001',
    });
    engine.tracker.completeTask(t1.id, { verified: true });

    const t2 = engine.tracker.createTask({
      serviceId: 'svc-data-verify',
      entityType: 'store',
      entityId: 'store-changsha-001',
      previousId: t1.id,
    });
    engine.tracker.completeTask(t2.id, { score: 95 });

    // Both tasks completed
    expect(engine.processStore.get(t1.id)!.state).toBe('COMPLETED');
    expect(engine.processStore.get(t2.id)!.state).toBe('COMPLETED');

    // Second task has previousId reference
    expect(engine.processStore.get(t2.id)!.previousId).toBe(t1.id);
  });
});

// ——————————————————————————————————
// 4. 历史数据查询
// ——————————————————————————————————

describe('历史数据查询', () => {
  let runtime: MockOpenClawRuntime;
  let engine: BpsEngine;

  beforeEach(() => {
    runtime = createMockRuntime();
    const result = registerBpsPlugin(runtime.api);
    engine = result.engine;
    loadBlueprintFromYaml(GEO_KTV_BLUEPRINT, engine.blueprintStore);
  });

  it('同一服务多次启动/完成 → 可查询所有完成的任务', () => {
    const taskIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      const task = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: `store-repeat-${i}`,
      });
      taskIds.push(task.id);
      engine.tracker.completeTask(task.id, { iteration: i });
    }

    const completed = engine.processStore.query({
      state: 'COMPLETED',
      serviceId: 'svc-data-collect',
    });

    expect(completed.length).toBeGreaterThanOrEqual(3);
    for (const tid of taskIds) {
      expect(completed.some(p => p.id === tid)).toBe(true);
    }
  });
});

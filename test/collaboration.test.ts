import { describe, it, expect, beforeEach } from 'vitest';
import { createBpsEngine, type BpsEngine } from '../src/index.js';
import { CollaborationStore } from '../src/collaboration/collaboration-store.js';
import { createBpsTools, type BpsToolDeps } from '../src/integration/tools.js';

let engine: BpsEngine;
let store: CollaborationStore;

beforeEach(() => {
  engine = createBpsEngine();
  store = engine.collaborationStore;
});

// ——— CollaborationStore ———

describe('CollaborationStore', () => {
  it('should create a task with defaults', () => {
    const task = store.createTask({
      title: 'Confirm treatment parameters',
      description: 'Please confirm dosage for botox injection',
    });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe('Confirm treatment parameters');
    expect(task.status).toBe('pending');
    expect(task.priority).toBe('normal');
    expect(task.response).toBeNull();
    expect(task.expiresAt).toBeTruthy();
  });

  it('should create a task with custom schema and priority', () => {
    const schema = {
      type: 'object',
      properties: {
        dosage: { type: 'number', description: 'Units of botox' },
        area: { type: 'string', enum: ['forehead', 'glabella', 'crow_feet'] },
      },
      required: ['dosage', 'area'],
    };

    const task = store.createTask({
      title: 'Treatment parameters',
      description: 'Fill in treatment plan',
      inputSchema: schema,
      priority: 'high',
      context: { entityType: 'patient', entityId: 'patient-001' },
      expiresIn: '7d',
    });

    expect(task.inputSchema).toEqual(schema);
    expect(task.priority).toBe('high');
    expect(task.context.entityType).toBe('patient');
  });

  it('should retrieve a task by ID', () => {
    const created = store.createTask({ title: 'Test', description: 'Test task' });
    const retrieved = store.getTask(created.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.title).toBe('Test');
  });

  it('should return null for non-existent task', () => {
    expect(store.getTask('nonexistent')).toBeNull();
  });

  it('should list pending tasks sorted by priority', () => {
    store.createTask({ title: 'Low', description: 'Low priority', priority: 'low' });
    store.createTask({ title: 'Urgent', description: 'Urgent task', priority: 'urgent' });
    store.createTask({ title: 'Normal', description: 'Normal task' });

    const pending = store.getPendingTasks();
    expect(pending).toHaveLength(3);
    expect(pending[0].title).toBe('Urgent');
    expect(pending[1].title).toBe('Normal');
    expect(pending[2].title).toBe('Low');
  });

  it('should respond to a task', () => {
    const task = store.createTask({ title: 'Approval', description: 'Approve this' });

    const responded = store.respond(task.id, { approved: true, reason: 'Looks good' }, 'dr-wang');

    expect(responded.status).toBe('completed');
    expect(responded.response).not.toBeNull();
    expect(responded.response!.data).toEqual({ approved: true, reason: 'Looks good' });
    expect(responded.response!.respondedBy).toBe('dr-wang');
    expect(responded.completedAt).toBeTruthy();
  });

  it('should persist response in database', () => {
    const task = store.createTask({ title: 'Form', description: 'Fill form' });
    store.respond(task.id, { dosage: 80, area: 'forehead' }, 'nurse-li');

    const retrieved = store.getTask(task.id);
    expect(retrieved!.status).toBe('completed');
    expect(retrieved!.response!.data).toEqual({ dosage: 80, area: 'forehead' });
  });

  it('should reject responding to non-pending task', () => {
    const task = store.createTask({ title: 'Test', description: 'Test' });
    store.respond(task.id, { ok: true }, 'user');

    expect(() => store.respond(task.id, { ok: false }, 'user')).toThrow('not pending');
  });

  it('should reject responding to non-existent task', () => {
    expect(() => store.respond('nonexistent', {}, 'user')).toThrow('not found');
  });

  it('should cancel a task', () => {
    const task = store.createTask({ title: 'Cancel me', description: 'Cancel' });
    store.cancelTask(task.id);

    const retrieved = store.getTask(task.id);
    expect(retrieved!.status).toBe('cancelled');
  });

  it('should return status counts', () => {
    store.createTask({ title: 'A', description: 'A' });
    store.createTask({ title: 'B', description: 'B' });
    const c = store.createTask({ title: 'C', description: 'C' });
    store.respond(c.id, { done: true }, 'user');

    const counts = store.getStatusCounts();
    expect(counts.pending).toBe(2);
    expect(counts.completed).toBe(1);
  });

  it('should emit task_created event', () => {
    const events: unknown[] = [];
    store.on('collaboration:task_created', (e) => events.push(e));

    store.createTask({ title: 'Event test', description: 'Test' });

    expect(events).toHaveLength(1);
  });

  it('should emit task_responded event', () => {
    const events: unknown[] = [];
    store.on('collaboration:task_responded', (e) => events.push(e));

    const task = store.createTask({ title: 'Event test', description: 'Test' });
    store.respond(task.id, { ok: true }, 'user');

    expect(events).toHaveLength(1);
  });
});

// ——— BPS Tools ———

describe('Collaboration Tools', () => {
  let tools: ReturnType<typeof createBpsTools>;
  let deps: BpsToolDeps;

  beforeEach(() => {
    deps = {
      tracker: engine.tracker,
      blueprintStore: engine.blueprintStore,
      processStore: engine.processStore,
      dossierStore: engine.dossierStore,
      collaborationStore: store,
    };
    tools = createBpsTools(deps);
  });

  function findTool(name: string) {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool;
  }

  it('should create a collaboration task via bps_request_collaboration', async () => {
    const tool = findTool('bps_request_collaboration');
    const result = await tool.execute('call-1', {
      title: 'Confirm treatment plan',
      description: 'Please review and confirm the treatment parameters',
      inputSchema: {
        type: 'object',
        properties: { dosage: { type: 'number' }, confirmed: { type: 'boolean' } },
        required: ['confirmed'],
      },
      priority: 'high',
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.taskId).toBeTruthy();
    expect(result.status).toBe('pending');

    // Verify task in store
    const task = store.getTask(result.taskId as string);
    expect(task).not.toBeNull();
    expect(task!.priority).toBe('high');
  });

  it('should get pending status via bps_get_collaboration_response', async () => {
    const task = store.createTask({ title: 'Test', description: 'Test' });

    const tool = findTool('bps_get_collaboration_response');
    const result = await tool.execute('call-2', { taskId: task.id }) as Record<string, unknown>;

    expect(result.status).toBe('pending');
    expect(result.hint).toBeTruthy();
  });

  it('should get completed response via bps_get_collaboration_response', async () => {
    const task = store.createTask({ title: 'Test', description: 'Test' });
    store.respond(task.id, { dosage: 80 }, 'dr-wang');

    const tool = findTool('bps_get_collaboration_response');
    const result = await tool.execute('call-3', { taskId: task.id }) as Record<string, unknown>;

    expect(result.status).toBe('completed');
    expect(result.response).toEqual({ dosage: 80 });
    expect(result.respondedBy).toBe('dr-wang');
  });

  it('should return error for non-existent task', async () => {
    const tool = findTool('bps_get_collaboration_response');
    const result = await tool.execute('call-4', { taskId: 'nonexistent' }) as Record<string, unknown>;

    expect(result.error).toBeTruthy();
  });
});

import { ProcessStateMachine } from './state-machine.js';
import { ProcessStore } from '../store/process-store.js';
import type { DossierStore } from '../store/dossier-store.js';
import { now } from '../schema/common.js';
import type { ProcessDef } from '../schema/process.js';
import { EventEmitter } from 'events';

/** BPS 引擎事件（Dashboard SSE 依赖） */
export interface BpsEngineEvents {
  'task:created': { taskId: string; serviceId: string };
  'task:updated': { taskId: string; from: string; to: string };
  'task:completed': { taskId: string; result?: unknown };
  'task:failed': { taskId: string; reason: string };
  'dossier:committed': { dossierId: string; entityType: string; entityId: string; taskId: string };
}

// Legacy aliases for Dashboard/SSE compatibility
export type BpsEngineEventsLegacy = {
  'process:created': BpsEngineEvents['task:created'];
  'process:state_changed': BpsEngineEvents['task:updated'];
  'process:completed': BpsEngineEvents['task:completed'];
  'process:error': BpsEngineEvents['task:failed'];
};

export interface TaskLogEntry {
  taskId: string;
  action: string;
  fromState?: string;
  toState?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * ProcessTracker — Agent 直接调用的任务追踪器
 *
 * 替代原 ProcessManager 的规则驱动执行引擎。
 * Agent 通过 Skill/Code 直接执行业务逻辑，ProcessTracker 仅负责：
 * 1. 任务记录的 CRUD
 * 2. 状态机校验
 * 3. 审计日志
 * 4. 事件发射（Dashboard SSE）
 */
export class ProcessTracker extends EventEmitter {
  private processStore: ProcessStore;
  private dossierStore?: DossierStore;

  constructor(params: {
    processStore: ProcessStore;
    dossierStore?: DossierStore;
  }) {
    super();
    this.processStore = params.processStore;
    this.dossierStore = params.dossierStore;
  }

  /**
   * 创建任务记录
   */
  createTask(params: {
    serviceId: string;
    operatorId?: string;
    entityType?: string;
    entityId?: string;
    parentId?: string;
    previousId?: string;
    programEntrypoint?: string;
    name?: string;
    metadata?: Record<string, unknown>;
  }): ProcessDef {
    const process = this.processStore.create({
      serviceId: params.serviceId,
      state: 'OPEN',
      operatorId: params.operatorId,
      entityType: params.entityType,
      entityId: params.entityId,
      parentId: params.parentId,
      previousId: params.previousId,
      programEntrypoint: params.programEntrypoint,
      name: params.name,
    });

    // Save initial metadata as context snapshot
    if (params.metadata && Object.keys(params.metadata).length > 0) {
      this.processStore.saveContextSnapshot(process.id, params.metadata);
    }

    this.emit('task:created', { taskId: process.id, serviceId: params.serviceId });
    // Legacy event for Dashboard compatibility
    this.emit('process:created', { processId: process.id, serviceId: params.serviceId });

    this.writeLog(process.id, 'created', { toState: 'OPEN', details: params.metadata });

    return this.processStore.get(process.id)!;
  }

  /**
   * 更新任务状态/元数据
   */
  updateTask(taskId: string, update: {
    state?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }): ProcessDef {
    const process = this.processStore.get(taskId);
    if (!process) throw new Error(`Task not found: ${taskId}`);

    if (update.state && update.state !== process.state) {
      ProcessStateMachine.assertTransition(process.state, update.state);
      const from = process.state;
      this.processStore.update(taskId, { state: update.state });
      this.emit('task:updated', { taskId, from, to: update.state });
      // Legacy event for Dashboard compatibility
      this.emit('process:state_changed', { processId: taskId, from, to: update.state });
      this.writeLog(taskId, 'state_changed', { fromState: from, toState: update.state });

      if (update.state === 'IN_PROGRESS') {
        this.processStore.update(taskId, { startTime: now() });
      }
    }

    if (update.metadata) {
      // Merge metadata into existing snapshot
      const existing = this.processStore.getLatestSnapshot(taskId);
      const merged = { ...(existing?.contextData ?? {}), ...update.metadata };
      this.processStore.saveContextSnapshot(taskId, merged);
    }

    return this.processStore.get(taskId)!;
  }

  /**
   * 完成任务
   */
  completeTask(taskId: string, result?: unknown): ProcessDef {
    const process = this.processStore.get(taskId);
    if (!process) throw new Error(`Task not found: ${taskId}`);

    if (ProcessStateMachine.isTerminal(process.state)) {
      return process; // Already done
    }

    // Auto-advance to IN_PROGRESS if still OPEN
    if (process.state === 'OPEN') {
      this.processStore.update(taskId, { state: 'IN_PROGRESS', startTime: now() });
      this.emit('task:updated', { taskId, from: 'OPEN', to: 'IN_PROGRESS' });
      this.emit('process:state_changed', { processId: taskId, from: 'OPEN', to: 'IN_PROGRESS' });
    } else if (process.state === 'BLOCKED') {
      this.processStore.update(taskId, { state: 'IN_PROGRESS' });
      this.emit('task:updated', { taskId, from: 'BLOCKED', to: 'IN_PROGRESS' });
      this.emit('process:state_changed', { processId: taskId, from: 'BLOCKED', to: 'IN_PROGRESS' });
    }

    // Complete
    ProcessStateMachine.assertTransition('IN_PROGRESS', 'COMPLETED');
    this.processStore.update(taskId, { state: 'COMPLETED', endTime: now() });

    // Save result to snapshot
    if (result !== undefined) {
      const existing = this.processStore.getLatestSnapshot(taskId);
      const merged = { ...(existing?.contextData ?? {}), _result: result };
      this.processStore.saveContextSnapshot(taskId, merged);
    }

    // Auto-commit to dossier if entity is bound
    if (result && process.entityType && process.entityId && this.dossierStore) {
      const dossier = this.dossierStore.getOrCreate(process.entityType, process.entityId);
      const data = (typeof result === 'object' && result !== null)
        ? result as Record<string, unknown>
        : { _result: result };
      this.dossierStore.commit(dossier.id, data, {
        committedBy: taskId,
        message: `Task ${process.name ?? taskId} completed`,
      });
      this.emit('dossier:committed', {
        dossierId: dossier.id, entityType: process.entityType,
        entityId: process.entityId, taskId,
      });
    }

    this.emit('task:completed', { taskId, result });
    this.emit('process:completed', { processId: taskId, returnValue: result });
    this.writeLog(taskId, 'completed', { fromState: 'IN_PROGRESS', toState: 'COMPLETED' });

    return this.processStore.get(taskId)!;
  }

  /**
   * 标记任务失败
   */
  failTask(taskId: string, reason: string): ProcessDef {
    const process = this.processStore.get(taskId);
    if (!process) throw new Error(`Task not found: ${taskId}`);

    if (ProcessStateMachine.isTerminal(process.state)) {
      return process;
    }

    const from = process.state;
    ProcessStateMachine.assertTransition(from, 'FAILED');
    this.processStore.update(taskId, { state: 'FAILED', endTime: now() });

    this.emit('task:failed', { taskId, reason });
    this.emit('process:error', { processId: taskId, error: reason });
    this.writeLog(taskId, 'failed', { fromState: from, toState: 'FAILED', details: { reason } });

    return this.processStore.get(taskId)!;
  }

  /**
   * 获取任务及其元数据
   */
  getTask(taskId: string) {
    const process = this.processStore.get(taskId);
    if (!process) return null;
    const snapshot = this.processStore.getLatestSnapshot(taskId);
    return { process, metadata: snapshot?.contextData ?? null };
  }

  /**
   * 查询任务
   */
  queryTasks(filter: {
    state?: string | string[];
    serviceId?: string;
    entityType?: string;
    entityId?: string;
    parentId?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.processStore.query(filter);
  }

  /**
   * 获取任务树
   */
  getTaskTree(rootId: string) {
    return this.processStore.getProcessTree(rootId);
  }

  // ——— Audit log ———

  private writeLog(taskId: string, action: string, opts?: {
    fromState?: string;
    toState?: string;
    details?: Record<string, unknown>;
  }): void {
    this.processStore.writeTaskLog({
      taskId,
      action,
      fromState: opts?.fromState,
      toState: opts?.toState,
      details: opts?.details,
      timestamp: now(),
    });
  }
}

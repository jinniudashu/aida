import type { DatabaseSync, StatementSync, SQLInputValue } from 'node:sqlite';
import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import { now } from '../schema/common.js';
import type { ProcessDef, ProcessContextSnapshot } from '../schema/process.js';

export interface CreateProcessInput {
  serviceId: string;
  state?: string;
  parentId?: string;
  previousId?: string;
  operatorId?: string;
  creatorId?: string;
  entityType?: string;
  entityId?: string;
  programEntrypoint?: string;
  priority?: number;
  name?: string;
}

export interface ProcessQueryFilter {
  state?: string | string[];
  serviceId?: string;
  entityType?: string;
  entityId?: string;
  operatorId?: string;
  parentId?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
}

export interface ProcessTreeNode {
  process: ProcessDef;
  children: ProcessTreeNode[];
}

export interface TaskLogInput {
  taskId: string;
  action: string;
  fromState?: string;
  toState?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export class ProcessStore {
  private nextPidStmt: StatementSync;
  private insertStmt: StatementSync;
  private getStmt: StatementSync;
  private updateStmt: StatementSync;
  private queryByStateStmt: StatementSync;
  private insertSnapshotStmt: StatementSync;
  private getLatestSnapshotStmt: StatementSync;
  private findBySessionKeyStmt: StatementSync;
  private countByStateStmt: StatementSync;
  private getChildrenStmt: StatementSync;
  private insertLogStmt: StatementSync;

  constructor(private db: DatabaseSync) {
    this.nextPidStmt = db.prepare(
      `SELECT COALESCE(MAX(pid), 0) + 1 as next_pid FROM bps_processes`
    );
    this.insertStmt = db.prepare(`
      INSERT INTO bps_processes (id, pid, name, parent_id, previous_id, service_id,
        state, priority, entity_type, entity_id, operator_id, creator_id,
        program_entrypoint, agent_session_key, created_at, updated_at)
      VALUES (@id, @pid, @name, @parentId, @previousId, @serviceId,
        @state, @priority, @entityType, @entityId, @operatorId, @creatorId,
        @programEntrypoint, @agentSessionKey, @createdAt, @updatedAt)
    `);
    this.getStmt = db.prepare(`SELECT * FROM bps_processes WHERE id = ?`);
    this.updateStmt = db.prepare(`
      UPDATE bps_processes SET
        state = COALESCE(@state, state),
        operator_id = COALESCE(@operatorId, operator_id),
        agent_session_key = COALESCE(@agentSessionKey, agent_session_key),
        start_time = COALESCE(@startTime, start_time),
        end_time = COALESCE(@endTime, end_time),
        updated_at = @updatedAt
      WHERE id = @id
    `);
    this.queryByStateStmt = db.prepare(
      `SELECT * FROM bps_processes WHERE state = ? ORDER BY priority DESC, pid ASC`
    );
    this.insertSnapshotStmt = db.prepare(`
      INSERT INTO bps_context_snapshots (id, process_id, version, context_data, context_hash, created_at)
      VALUES (@id, @processId, @version, @contextData, @contextHash, @createdAt)
    `);
    this.getLatestSnapshotStmt = db.prepare(`
      SELECT * FROM bps_context_snapshots
      WHERE process_id = ? ORDER BY version DESC LIMIT 1
    `);
    this.findBySessionKeyStmt = db.prepare(
      `SELECT * FROM bps_processes WHERE agent_session_key = ? LIMIT 1`
    );
    this.countByStateStmt = db.prepare(
      'SELECT state, COUNT(*) as count FROM bps_processes GROUP BY state'
    );
    this.getChildrenStmt = db.prepare(
      'SELECT * FROM bps_processes WHERE parent_id = ? ORDER BY pid ASC'
    );
    this.insertLogStmt = db.prepare(`
      INSERT INTO bps_task_log (id, task_id, action, from_state, to_state, details, timestamp)
      VALUES (@id, @taskId, @action, @fromState, @toState, @details, @timestamp)
    `);
  }

  create(input: CreateProcessInput): ProcessDef {
    const id = uuid();
    const timestamp = now();
    const pid = (this.nextPidStmt.get() as { next_pid: number }).next_pid;

    const row = {
      id,
      pid,
      name: input.name ?? null,
      parentId: input.parentId ?? null,
      previousId: input.previousId ?? null,
      serviceId: input.serviceId,
      state: input.state ?? 'OPEN',
      priority: input.priority ?? 0,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      operatorId: input.operatorId ?? null,
      creatorId: input.creatorId ?? null,
      programEntrypoint: input.programEntrypoint ?? null,
      agentSessionKey: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.insertStmt.run(row);

    return this.get(id)!;
  }

  get(id: string): ProcessDef | null {
    const row = this.getStmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToProcess(row) : null;
  }

  update(id: string, fields: Partial<{
    state: string;
    operatorId: string;
    agentSessionKey: string;
    startTime: string;
    endTime: string;
  }>): void {
    this.updateStmt.run({
      id,
      state: fields.state ?? null,
      operatorId: fields.operatorId ?? null,
      agentSessionKey: fields.agentSessionKey ?? null,
      startTime: fields.startTime ?? null,
      endTime: fields.endTime ?? null,
      updatedAt: now(),
    });
  }

  queryByState(state: string): ProcessDef[] {
    const rows = this.queryByStateStmt.all(state) as Record<string, unknown>[];
    return rows.map(r => this.rowToProcess(r));
  }

  /**
   * Save a metadata snapshot for a task (plain JSON object).
   */
  saveContextSnapshot(processId: string, data: Record<string, unknown>): void {
    const latestRow = this.getLatestSnapshotStmt.get(processId) as
      Record<string, unknown> | undefined;
    const version = latestRow ? (latestRow.version as number) + 1 : 1;

    const json = JSON.stringify(data);
    const hash = createHash('sha256').update(json).digest('hex');

    this.insertSnapshotStmt.run({
      id: uuid(),
      processId,
      version,
      contextData: json,
      contextHash: hash,
      createdAt: now(),
    });
  }

  getLatestSnapshot(processId: string): ProcessContextSnapshot | null {
    const row = this.getLatestSnapshotStmt.get(processId) as
      Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      processId: row.process_id as string,
      version: row.version as number,
      contextData: JSON.parse(row.context_data as string),
      contextHash: row.context_hash as string,
      createdAt: row.created_at as string,
    };
  }

  findBySessionKey(sessionKey: string): ProcessDef | null {
    const row = this.findBySessionKeyStmt.get(sessionKey) as Record<string, unknown> | undefined;
    return row ? this.rowToProcess(row) : null;
  }

  query(filter: ProcessQueryFilter = {}): ProcessDef[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (filter.state !== undefined) {
      if (Array.isArray(filter.state)) {
        if (filter.state.length === 0) return [];
        conditions.push(`state IN (${filter.state.map(() => '?').join(', ')})`);
        params.push(...filter.state);
      } else {
        conditions.push('state = ?');
        params.push(filter.state);
      }
    }
    if (filter.serviceId) {
      conditions.push('service_id = ?');
      params.push(filter.serviceId);
    }
    if (filter.entityType) {
      conditions.push('entity_type = ?');
      params.push(filter.entityType);
    }
    if (filter.entityId) {
      conditions.push('entity_id = ?');
      params.push(filter.entityId);
    }
    if (filter.operatorId) {
      conditions.push('operator_id = ?');
      params.push(filter.operatorId);
    }
    if (filter.parentId) {
      conditions.push('parent_id = ?');
      params.push(filter.parentId);
    }
    if (filter.createdAfter) {
      conditions.push('created_at > ?');
      params.push(filter.createdAfter);
    }
    if (filter.createdBefore) {
      conditions.push('created_at < ?');
      params.push(filter.createdBefore);
    }

    let sql = 'SELECT * FROM bps_processes';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY priority DESC, pid ASC';

    if (filter.limit != null) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    if (filter.offset != null) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.rowToProcess(r));
  }

  getProcessTree(rootId: string): ProcessTreeNode | null {
    const root = this.get(rootId);
    if (!root) return null;
    return this.buildTreeNode(root);
  }

  private buildTreeNode(process: ProcessDef, depth = 0): ProcessTreeNode {
    if (depth > 50) return { process, children: [] };
    const childRows = this.getChildrenStmt.all(process.id) as Record<string, unknown>[];
    const children = childRows.map(row => this.buildTreeNode(this.rowToProcess(row), depth + 1));
    return { process, children };
  }

  countByState(): Record<string, number> {
    const rows = this.countByStateStmt.all() as Array<{ state: string; count: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) result[row.state] = row.count;
    return result;
  }

  /**
   * Write an audit log entry.
   */
  writeTaskLog(input: TaskLogInput): void {
    this.insertLogStmt.run({
      id: uuid(),
      taskId: input.taskId,
      action: input.action,
      fromState: input.fromState ?? null,
      toState: input.toState ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
      timestamp: input.timestamp,
    });
  }

  private rowToProcess(row: Record<string, unknown>): ProcessDef {
    return {
      id: row.id as string,
      pid: row.pid as number,
      name: row.name as string | undefined,
      parentId: row.parent_id as string | undefined,
      previousId: row.previous_id as string | undefined,
      serviceId: row.service_id as string,
      state: row.state as ProcessDef['state'],
      priority: row.priority as number,
      entityType: row.entity_type as string | undefined,
      entityId: row.entity_id as string | undefined,
      operatorId: row.operator_id as string | undefined,
      creatorId: row.creator_id as string | undefined,
      programEntrypoint: row.program_entrypoint as string | undefined,
      scheduledTime: row.scheduled_time as string | undefined,
      startTime: row.start_time as string | undefined,
      endTime: row.end_time as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      agentSessionKey: row.agent_session_key as string | undefined,
    };
  }
}

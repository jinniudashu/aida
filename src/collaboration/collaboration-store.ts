import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { now } from '../schema/common.js';
import type {
  CollaborationTask,
  CollaborationTaskContext,
  CollaborationTaskPriority,
  CollaborationTaskResponse,
  CollaborationTaskStatus,
} from './types.js';

const COLLABORATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS bps_collaboration_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  input_schema TEXT NOT NULL DEFAULT '{}',
  response TEXT,
  responded_by TEXT,
  responded_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_collab_tasks_status
  ON bps_collaboration_tasks(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_expires
  ON bps_collaboration_tasks(expires_at)
  WHERE status = 'pending';
`;

/** Parse a duration string like '24h', '7d', '30m' into milliseconds */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

export class CollaborationStore extends EventEmitter {
  private insertTaskStmt: StatementSync;
  private getTaskStmt: StatementSync;
  private listByStatusStmt: StatementSync;
  private listAllStmt: StatementSync;
  private updateResponseStmt: StatementSync;
  private cancelTaskStmt: StatementSync;
  private countByStatusStmt: StatementSync;

  constructor(private db: DatabaseSync) {
    super();
    db.exec(COLLABORATION_SCHEMA);

    this.insertTaskStmt = db.prepare(`
      INSERT INTO bps_collaboration_tasks
        (id, title, description, context, input_schema, status, priority, created_at, expires_at)
      VALUES (@id, @title, @description, @context, @inputSchema, @status, @priority, @createdAt, @expiresAt)
    `);

    this.getTaskStmt = db.prepare(
      `SELECT * FROM bps_collaboration_tasks WHERE id = ?`
    );

    this.listByStatusStmt = db.prepare(
      `SELECT * FROM bps_collaboration_tasks WHERE status = ? ORDER BY
        CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
        created_at ASC`
    );

    this.listAllStmt = db.prepare(
      `SELECT * FROM bps_collaboration_tasks ORDER BY created_at DESC`
    );

    this.updateResponseStmt = db.prepare(`
      UPDATE bps_collaboration_tasks
      SET response = @response, responded_by = @respondedBy, responded_at = @respondedAt,
          status = 'completed', completed_at = @completedAt
      WHERE id = @id AND status = 'pending'
    `);

    this.cancelTaskStmt = db.prepare(`
      UPDATE bps_collaboration_tasks SET status = 'cancelled', completed_at = @completedAt
      WHERE id = @id AND status = 'pending'
    `);

    this.countByStatusStmt = db.prepare(
      `SELECT status, COUNT(*) as count FROM bps_collaboration_tasks GROUP BY status`
    );
  }

  // ——— Create ———

  createTask(params: {
    title: string;
    description: string;
    context?: CollaborationTaskContext;
    inputSchema?: Record<string, unknown>;
    priority?: CollaborationTaskPriority;
    expiresIn?: string;
  }): CollaborationTask {
    const id = uuid();
    const createdAt = now();
    const expiresAt = new Date(
      Date.now() + parseDuration(params.expiresIn ?? '24h')
    ).toISOString();

    this.insertTaskStmt.run({
      id,
      title: params.title,
      description: params.description,
      context: JSON.stringify(params.context ?? {}),
      inputSchema: JSON.stringify(params.inputSchema ?? {}),
      status: 'pending',
      priority: params.priority ?? 'normal',
      createdAt,
      expiresAt,
    });

    const task: CollaborationTask = {
      id,
      title: params.title,
      description: params.description,
      context: params.context ?? {},
      inputSchema: params.inputSchema ?? {},
      response: null,
      status: 'pending',
      priority: params.priority ?? 'normal',
      createdAt,
      expiresAt,
    };

    this.emit('collaboration:task_created', task);
    return task;
  }

  // ——— Read ———

  getTask(id: string): CollaborationTask | null {
    const row = this.getTaskStmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  listTasks(status?: CollaborationTaskStatus): CollaborationTask[] {
    const rows = status
      ? (this.listByStatusStmt.all(status) as Record<string, unknown>[])
      : (this.listAllStmt.all() as Record<string, unknown>[]);
    return rows.map(r => this.rowToTask(r));
  }

  getPendingTasks(): CollaborationTask[] {
    return this.listTasks('pending');
  }

  getStatusCounts(): Record<string, number> {
    const rows = this.countByStatusStmt.all() as Array<{ status: string; count: number }>;
    const counts: Record<string, number> = { pending: 0, completed: 0, expired: 0, cancelled: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  // ——— Respond ———

  respond(id: string, data: Record<string, unknown>, respondedBy: string): CollaborationTask {
    const task = this.getTask(id);
    if (!task) throw new Error(`Collaboration task not found: ${id}`);
    if (task.status !== 'pending') throw new Error(`Task ${id} is not pending (status: ${task.status})`);

    const respondedAt = now();
    const completedAt = respondedAt;

    this.updateResponseStmt.run({
      id,
      response: JSON.stringify(data),
      respondedBy,
      respondedAt,
      completedAt,
    });

    const response: CollaborationTaskResponse = { data, respondedBy, respondedAt };
    const updated: CollaborationTask = { ...task, response, status: 'completed', completedAt };

    this.emit('collaboration:task_responded', updated);
    return updated;
  }

  // ——— Cancel ———

  cancelTask(id: string): void {
    this.cancelTaskStmt.run({ id, completedAt: now() });
    this.emit('collaboration:task_cancelled', { id });
  }

  // ——— Row mapper ———

  private rowToTask(row: Record<string, unknown>): CollaborationTask {
    const response: CollaborationTaskResponse | null = row.response
      ? {
          data: JSON.parse(row.response as string),
          respondedBy: row.responded_by as string,
          respondedAt: row.responded_at as string,
        }
      : null;

    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      context: JSON.parse(row.context as string),
      inputSchema: JSON.parse(row.input_schema as string),
      response,
      status: row.status as CollaborationTaskStatus,
      priority: row.priority as CollaborationTaskPriority,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string,
      completedAt: row.completed_at as string | undefined,
    };
  }
}

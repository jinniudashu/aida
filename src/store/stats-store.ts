import type { DatabaseSync, StatementSync, SQLInputValue } from 'node:sqlite';
import { v4 as uuid } from 'uuid';
import { now } from '../schema/common.js';

export interface TimeSeriesPoint {
  bucket: string;
  count: number;
  dimensions?: Record<string, unknown>;
}

export interface StatsSnapshot {
  id: string;
  snapshotType: string;
  data: Record<string, unknown>;
  createdAt: string;
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export class StatsStore {
  private upsertStmt: StatementSync;
  private saveSnapshotStmt: StatementSync;
  private getLatestSnapshotStmt: StatementSync;

  constructor(private db: DatabaseSync) {
    this.upsertStmt = db.prepare(`
      INSERT INTO bps_stats_timeseries (id, metric, interval, bucket, dimensions, count)
      VALUES (@id, @metric, @interval, @bucket, @dimensions, 1)
      ON CONFLICT(metric, interval, bucket, dimensions) DO UPDATE SET count = count + 1
    `);
    this.saveSnapshotStmt = db.prepare(`
      INSERT INTO bps_stats_snapshots (id, snapshot_type, data, created_at)
      VALUES (@id, @snapshotType, @data, @createdAt)
    `);
    this.getLatestSnapshotStmt = db.prepare(`
      SELECT * FROM bps_stats_snapshots WHERE snapshot_type = ? ORDER BY created_at DESC LIMIT 1
    `);
  }

  recordEvent(metric: string, dimensions?: Record<string, unknown>): void {
    const timestamp = now();
    // Use empty string instead of null for "no dimensions" so UNIQUE constraint works
    // (SQLite treats NULL != NULL for uniqueness, defeating ON CONFLICT)
    const dimStr = dimensions ? JSON.stringify(dimensions) : '';

    const hourBucket = timestamp.slice(0, 13) + ':00:00Z';
    const dayBucket = timestamp.slice(0, 10);
    const weekBucket = getMonday(timestamp);

    const buckets: Array<{ interval: string; bucket: string }> = [
      { interval: 'hour', bucket: hourBucket },
      { interval: 'day', bucket: dayBucket },
      { interval: 'week', bucket: weekBucket },
    ];

    for (const { interval, bucket } of buckets) {
      this.upsertStmt.run({
        id: uuid(),
        metric,
        interval,
        bucket,
        dimensions: dimStr,
      });
    }
  }

  getTimeSeries(
    metric: string,
    interval: 'hour' | 'day' | 'week',
    from: string,
    to: string,
    dimensions?: Record<string, unknown>,
  ): TimeSeriesPoint[] {
    let sql: string;
    let params: SQLInputValue[];

    if (dimensions) {
      sql = `SELECT bucket, count, dimensions FROM bps_stats_timeseries
        WHERE metric = ? AND interval = ? AND bucket >= ? AND bucket <= ? AND dimensions = ?
        ORDER BY bucket ASC`;
      params = [metric, interval, from, to, JSON.stringify(dimensions)];
    } else {
      sql = `SELECT bucket, count, dimensions FROM bps_stats_timeseries
        WHERE metric = ? AND interval = ? AND bucket >= ? AND bucket <= ? AND dimensions = ?
        ORDER BY bucket ASC`;
      params = [metric, interval, from, to, ''];
    }

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(row => {
      const dim = row.dimensions as string;
      return {
        bucket: row.bucket as string,
        count: row.count as number,
        dimensions: dim && dim !== '' ? JSON.parse(dim) : undefined,
      };
    });
  }

  saveSnapshot(type: string, data: Record<string, unknown>): StatsSnapshot {
    const id = uuid();
    const createdAt = now();
    this.saveSnapshotStmt.run({
      id,
      snapshotType: type,
      data: JSON.stringify(data),
      createdAt,
    });
    return { id, snapshotType: type, data, createdAt };
  }

  getLatestSnapshot(type: string): StatsSnapshot | null {
    const row = this.getLatestSnapshotStmt.get(type) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      snapshotType: row.snapshot_type as string,
      data: JSON.parse(row.data as string),
      createdAt: row.created_at as string,
    };
  }
}

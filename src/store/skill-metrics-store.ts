import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';

export interface SkillMetricRecord {
  id: string;
  skillName: string;
  invokedAt: string;
  outcome: string;
  durationMs?: number;
}

export interface SkillUsageSummary {
  skillName: string;
  totalInvocations: number;
  successCount: number;
  failedCount: number;
  lastInvokedAt: string;
}

export class SkillMetricsStore {
  constructor(private db: DatabaseSync) {}

  /** Record a skill invocation */
  record(skillName: string, outcome: string, durationMs?: number): SkillMetricRecord {
    const id = randomUUID();
    const invokedAt = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO bps_skill_metrics (id, skill_name, invoked_at, outcome, duration_ms) VALUES (?, ?, ?, ?, ?)',
    ).run(id, skillName, invokedAt, outcome, durationMs ?? null);
    return { id, skillName, invokedAt, outcome, durationMs };
  }

  /** Get usage summary per skill */
  getSummaries(): SkillUsageSummary[] {
    const rows = this.db.prepare(`
      SELECT skill_name,
             COUNT(*) as total,
             SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success_count,
             SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END) as failed_count,
             MAX(invoked_at) as last_invoked_at
      FROM bps_skill_metrics
      GROUP BY skill_name
      ORDER BY last_invoked_at DESC
    `).all() as Array<{ skill_name: string; total: number; success_count: number; failed_count: number; last_invoked_at: string }>;

    return rows.map(r => ({
      skillName: r.skill_name,
      totalInvocations: r.total,
      successCount: r.success_count,
      failedCount: r.failed_count,
      lastInvokedAt: r.last_invoked_at,
    }));
  }

  /** Find skills not invoked since a given ISO date */
  getDormantSkillNames(since: string): string[] {
    // Returns skill_names whose last invocation is before `since`
    const rows = this.db.prepare(`
      SELECT skill_name, MAX(invoked_at) as last_invoked
      FROM bps_skill_metrics
      GROUP BY skill_name
      HAVING last_invoked < ?
    `).all(since) as Array<{ skill_name: string }>;
    return rows.map(r => r.skill_name);
  }
}

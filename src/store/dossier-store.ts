import type { DatabaseSync, StatementSync, SQLInputValue } from 'node:sqlite';
import { v4 as uuid } from 'uuid';
import { now } from '../schema/common.js';
import type { DossierDef, DossierVersion, DossierLifecycle, EntityRelation } from '../schema/dossier.js';

export interface DossierSearchOptions {
  entityType?: string;
  lifecycle?: string;
  dataFilter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface DossierSearchResult {
  dossier: DossierDef;
  data: Record<string, unknown>;
}

export interface RecentChange {
  dossier: DossierDef;
  data: Record<string, unknown>;
  patch: Record<string, unknown> | undefined;
  committedBy: string | undefined;
  commitMessage: string | undefined;
  version: number;
  versionCreatedAt: string;
}

export class DossierStore {
  private getByTypeIdStmt: StatementSync;
  private getByIdStmt: StatementSync;
  private insertDossierStmt: StatementSync;
  private updateVersionStmt: StatementSync;
  private updateLifecycleStmt: StatementSync;
  private insertVersionStmt: StatementSync;
  private getLatestVersionStmt: StatementSync;
  private getVersionStmt: StatementSync;
  private listVersionsStmt: StatementSync;
  private queryAllStmt: StatementSync;
  private queryByTypeStmt: StatementSync;
  private queryByLifecycleStmt: StatementSync;
  private queryByTypeAndLifecycleStmt: StatementSync;
  private findByEntityIdStmt: StatementSync;
  private findByCommitterStmt: StatementSync;
  private recentChangesStmt: StatementSync;

  constructor(private db: DatabaseSync) {
    this.getByTypeIdStmt = db.prepare(
      `SELECT * FROM bps_dossiers WHERE entity_type = ? AND entity_id = ?`
    );
    this.getByIdStmt = db.prepare(
      `SELECT * FROM bps_dossiers WHERE id = ?`
    );
    this.insertDossierStmt = db.prepare(`
      INSERT INTO bps_dossiers (id, entity_type, entity_id, lifecycle, current_version, created_at, updated_at)
      VALUES (@id, @entityType, @entityId, @lifecycle, @currentVersion, @createdAt, @updatedAt)
    `);
    this.updateVersionStmt = db.prepare(`
      UPDATE bps_dossiers SET current_version = @currentVersion, updated_at = @updatedAt WHERE id = @id
    `);
    this.updateLifecycleStmt = db.prepare(`
      UPDATE bps_dossiers SET lifecycle = @lifecycle, updated_at = @updatedAt WHERE id = @id
    `);
    this.insertVersionStmt = db.prepare(`
      INSERT INTO bps_dossier_versions (id, dossier_id, version, data, patch, committed_by, commit_message, created_at)
      VALUES (@id, @dossierId, @version, @data, @patch, @committedBy, @commitMessage, @createdAt)
    `);
    this.getLatestVersionStmt = db.prepare(
      `SELECT * FROM bps_dossier_versions WHERE dossier_id = ? ORDER BY version DESC LIMIT 1`
    );
    this.getVersionStmt = db.prepare(
      `SELECT * FROM bps_dossier_versions WHERE dossier_id = ? AND version = ?`
    );
    this.listVersionsStmt = db.prepare(
      `SELECT * FROM bps_dossier_versions WHERE dossier_id = ? ORDER BY version ASC`
    );
    this.queryAllStmt = db.prepare(
      `SELECT * FROM bps_dossiers ORDER BY updated_at DESC`
    );
    this.queryByTypeStmt = db.prepare(
      `SELECT * FROM bps_dossiers WHERE entity_type = ? ORDER BY updated_at DESC`
    );
    this.queryByLifecycleStmt = db.prepare(
      `SELECT * FROM bps_dossiers WHERE lifecycle = ? ORDER BY updated_at DESC`
    );
    this.queryByTypeAndLifecycleStmt = db.prepare(
      `SELECT * FROM bps_dossiers WHERE entity_type = ? AND lifecycle = ? ORDER BY updated_at DESC`
    );
    this.findByEntityIdStmt = db.prepare(
      `SELECT * FROM bps_dossiers WHERE entity_id = ? ORDER BY entity_type ASC`
    );
    this.findByCommitterStmt = db.prepare(`
      SELECT DISTINCT d.* FROM bps_dossiers d
      JOIN bps_dossier_versions v ON v.dossier_id = d.id
      WHERE v.committed_by = ?
      ORDER BY d.updated_at DESC
    `);
    this.recentChangesStmt = db.prepare(`
      SELECT d.*, v.data as _version_data, v.patch as _patch,
             v.committed_by as _committed_by, v.commit_message as _commit_message,
             v.version as _version, v.created_at as _version_created_at
      FROM bps_dossiers d
      JOIN bps_dossier_versions v ON v.dossier_id = d.id AND v.version = d.current_version
      ORDER BY d.updated_at DESC
      LIMIT ?
    `);
  }

  /** 获取或自动创建档案（首次引用时 lazy 创建） */
  getOrCreate(entityType: string, entityId: string): DossierDef {
    const existing = this.getByTypeIdStmt.get(entityType, entityId) as Record<string, unknown> | undefined;
    if (existing) return this.rowToDossier(existing);

    const id = uuid();
    const timestamp = now();
    this.insertDossierStmt.run({
      id,
      entityType,
      entityId,
      lifecycle: 'ACTIVE',
      currentVersion: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return this.rowToDossier(this.getByIdStmt.get(id) as Record<string, unknown>);
  }

  /** 提交新版本（浅合并语义） */
  commit(dossierId: string, data: Record<string, unknown>, opts?: {
    committedBy?: string;
    message?: string;
  }): DossierVersion {
    const dossier = this.getByIdStmt.get(dossierId) as Record<string, unknown> | undefined;
    if (!dossier) throw new Error(`Dossier not found: ${dossierId}`);

    const lifecycle = dossier.lifecycle as string;
    if (lifecycle === 'ARCHIVED') {
      throw new Error(`Cannot commit to ARCHIVED dossier: ${dossierId}`);
    }

    // Get current data for shallow merge
    const currentVersion = dossier.current_version as number;
    let currentData: Record<string, unknown> = {};
    if (currentVersion > 0) {
      const latestRow = this.getLatestVersionStmt.get(dossierId) as Record<string, unknown> | undefined;
      if (latestRow) {
        currentData = JSON.parse(latestRow.data as string);
      }
    }

    // Smart merge: shallow merge with array concatenation
    const merged = smartMerge(currentData, data);
    const newVersion = currentVersion + 1;
    const versionId = uuid();
    const timestamp = now();

    this.insertVersionStmt.run({
      id: versionId,
      dossierId,
      version: newVersion,
      data: JSON.stringify(merged),
      patch: JSON.stringify(data),
      committedBy: opts?.committedBy ?? null,
      commitMessage: opts?.message ?? null,
      createdAt: timestamp,
    });

    this.updateVersionStmt.run({
      id: dossierId,
      currentVersion: newVersion,
      updatedAt: timestamp,
    });

    return this.rowToVersion(this.getVersionStmt.get(dossierId, newVersion) as Record<string, unknown>);
  }

  /** 按 erpsysId (dossier.id) 一步定位档案 + 当前数据 */
  getById(erpsysId: string): { dossier: DossierDef; data: Record<string, unknown> } | null {
    const row = this.getByIdStmt.get(erpsysId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  /** 按 (entityType, entityId) 定位档案 + 当前数据 */
  get(entityType: string, entityId: string): { dossier: DossierDef; data: Record<string, unknown> } | null {
    const row = this.getByTypeIdStmt.get(entityType, entityId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  private hydrate(row: Record<string, unknown>): { dossier: DossierDef; data: Record<string, unknown> } {
    const dossier = this.rowToDossier(row);
    let data: Record<string, unknown> = {};
    if (dossier.currentVersion > 0) {
      const latestRow = this.getLatestVersionStmt.get(dossier.id) as Record<string, unknown> | undefined;
      if (latestRow) {
        data = JSON.parse(latestRow.data as string);
      }
    }
    return { dossier, data };
  }

  /** 读取特定历史版本 */
  getVersion(dossierId: string, version: number): DossierVersion | null {
    const row = this.getVersionStmt.get(dossierId, version) as Record<string, unknown> | undefined;
    return row ? this.rowToVersion(row) : null;
  }

  /** 版本历史列表 */
  listVersions(dossierId: string): DossierVersion[] {
    const rows = this.listVersionsStmt.all(dossierId) as Record<string, unknown>[];
    return rows.map(r => this.rowToVersion(r));
  }

  /** 按条件查询档案 */
  query(filter?: { entityType?: string; lifecycle?: string }): DossierDef[] {
    let rows: Record<string, unknown>[];
    if (filter?.entityType && filter?.lifecycle) {
      rows = this.queryByTypeAndLifecycleStmt.all(filter.entityType, filter.lifecycle) as Record<string, unknown>[];
    } else if (filter?.entityType) {
      rows = this.queryByTypeStmt.all(filter.entityType) as Record<string, unknown>[];
    } else if (filter?.lifecycle) {
      rows = this.queryByLifecycleStmt.all(filter.lifecycle) as Record<string, unknown>[];
    } else {
      rows = this.queryAllStmt.all() as Record<string, unknown>[];
    }
    return rows.map(r => this.rowToDossier(r));
  }

  /**
   * 类别检索：按 entityType/lifecycle 筛选 + 按 data 内字段过滤（json_extract）+ 分页
   * dataFilter 为等值匹配：{ city: 'Shanghai' } → json_extract(v.data, '$.city') = 'Shanghai'
   */
  search(opts: DossierSearchOptions = {}): DossierSearchResult[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (opts.entityType) {
      conditions.push('d.entity_type = ?');
      params.push(opts.entityType);
    }
    if (opts.lifecycle) {
      conditions.push('d.lifecycle = ?');
      params.push(opts.lifecycle);
    }

    const hasDataFilter = opts.dataFilter && Object.keys(opts.dataFilter).length > 0;

    // Always JOIN versions to include data in results; LEFT JOIN so version-0 dossiers still appear
    let sql = `SELECT d.*, v.data as _version_data FROM bps_dossiers d
      LEFT JOIN bps_dossier_versions v ON v.dossier_id = d.id AND v.version = d.current_version`;

    if (hasDataFilter) {
      for (const [field, value] of Object.entries(opts.dataFilter!)) {
        // Sanitize field name: only allow alphanumeric, underscore, dot
        if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field)) {
          throw new Error(`Invalid dataFilter field name: ${field}`);
        }
        conditions.push(`json_extract(v.data, '$.' || ?) = ?`);
        params.push(field);
        // json_extract returns typed values; stringify objects for comparison
        if (typeof value === 'object' && value !== null) {
          params.push(JSON.stringify(value));
        } else {
          params.push(value as SQLInputValue);
        }
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY d.updated_at DESC';

    if (opts.limit != null) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }
    if (opts.offset != null) {
      sql += ' OFFSET ?';
      params.push(opts.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map(row => ({
      dossier: this.rowToDossier(row),
      data: row._version_data ? JSON.parse(row._version_data as string) : {},
    }));
  }

  /** 按 entityId 跨类型查找（同一实体的所有档案） */
  findByEntityId(entityId: string): DossierDef[] {
    const rows = this.findByEntityIdStmt.all(entityId) as Record<string, unknown>[];
    return rows.map(r => this.rowToDossier(r));
  }

  /** 按操作进程反查关联档案 */
  findByCommitter(processId: string): DossierDef[] {
    const rows = this.findByCommitterStmt.all(processId) as Record<string, unknown>[];
    return rows.map(r => this.rowToDossier(r));
  }

  /** 最近变更列表（JOIN current_version 自然排除 version=0 的空档案） */
  getRecentChanges(limit = 10): RecentChange[] {
    const rows = this.recentChangesStmt.all(limit) as Record<string, unknown>[];
    return rows.map(row => ({
      dossier: this.rowToDossier(row),
      data: JSON.parse(row._version_data as string),
      patch: row._patch ? JSON.parse(row._patch as string) : undefined,
      committedBy: row._committed_by as string | undefined,
      commitMessage: row._commit_message as string | undefined,
      version: row._version as number,
      versionCreatedAt: row._version_created_at as string,
    }));
  }

  /** 生命周期迁移 */
  transition(dossierId: string, lifecycle: DossierLifecycle): void {
    const dossier = this.getByIdStmt.get(dossierId) as Record<string, unknown> | undefined;
    if (!dossier) throw new Error(`Dossier not found: ${dossierId}`);

    this.updateLifecycleStmt.run({
      id: dossierId,
      lifecycle,
      updatedAt: now(),
    });
  }

  /** Update relations for a dossier (replaces existing relations) */
  setRelations(dossierId: string, relations: EntityRelation[]): void {
    this.db.prepare(
      'UPDATE bps_dossiers SET relations = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(relations), now(), dossierId);
  }

  private rowToDossier(row: Record<string, unknown>): DossierDef {
    const relationsRaw = row.relations as string | undefined;
    let relations: EntityRelation[] | undefined;
    if (relationsRaw) {
      try {
        const parsed = JSON.parse(relationsRaw);
        if (Array.isArray(parsed) && parsed.length > 0) relations = parsed;
      } catch { /* ignore parse errors */ }
    }
    return {
      id: row.id as string,
      entityType: row.entity_type as string,
      entityId: row.entity_id as string,
      lifecycle: row.lifecycle as DossierLifecycle,
      currentVersion: row.current_version as number,
      relations,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToVersion(row: Record<string, unknown>): DossierVersion {
    return {
      id: row.id as string,
      dossierId: row.dossier_id as string,
      version: row.version as number,
      data: JSON.parse(row.data as string),
      patch: row.patch ? JSON.parse(row.patch as string) : undefined,
      committedBy: row.committed_by as string | undefined,
      commitMessage: row.commit_message as string | undefined,
      createdAt: row.created_at as string,
    };
  }
}

/**
 * Smart merge: shallow merge with array concatenation.
 * - Scalar/object fields: new value replaces old (same as spread)
 * - Array fields: new array items are appended to existing array
 * - New fields: added as-is
 * - Unmentioned fields: preserved from current data
 */
function smartMerge(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value) && Array.isArray(current[key])) {
      result[key] = [...(current[key] as unknown[]), ...value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

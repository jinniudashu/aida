import type { DossierStore } from '../store/dossier-store.js';
import type { KnowledgeEntry, KnowledgeScope } from './types.js';

const ENTITY_TYPE = 'knowledge';

export class KnowledgeStore {
  constructor(private dossierStore: DossierStore) {}

  /**
   * Encode scope:topic as a Dossier entityId.
   */
  static formatEntityId(scope: KnowledgeScope, topic: string): string {
    return `${scope}:${topic}`;
  }

  /**
   * Decode a Dossier entityId back to scope + topic.
   */
  static parseEntityId(entityId: string): { scope: KnowledgeScope; topic: string } {
    const colonIdx = entityId.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(`Invalid knowledge entityId: ${entityId}`);
    }
    const scope = entityId.slice(0, colonIdx) as KnowledgeScope;
    if (scope !== 'system' && scope !== 'project') {
      throw new Error(`Invalid knowledge scope: ${scope}`);
    }
    const topic = entityId.slice(colonIdx + 1);
    if (!topic) {
      throw new Error(`Invalid knowledge entityId (empty topic): ${entityId}`);
    }
    return { scope, topic };
  }

  /**
   * Write or update a knowledge entry.
   */
  put(
    scope: KnowledgeScope,
    topic: string,
    data: Record<string, unknown>,
    opts?: { committedBy?: string; message?: string },
  ): KnowledgeEntry {
    const entityId = KnowledgeStore.formatEntityId(scope, topic);
    const dossier = this.dossierStore.getOrCreate(ENTITY_TYPE, entityId);
    const version = this.dossierStore.commit(dossier.id, data, {
      committedBy: opts?.committedBy,
      message: opts?.message,
    });
    return {
      scope,
      topic,
      dossierId: dossier.id,
      version: version.version,
      data: version.data,
      updatedAt: version.createdAt,
    };
  }

  /**
   * Get a single knowledge entry. Returns null if not found.
   */
  get(scope: KnowledgeScope, topic: string): KnowledgeEntry | null {
    const entityId = KnowledgeStore.formatEntityId(scope, topic);
    const result = this.dossierStore.get(ENTITY_TYPE, entityId);
    if (!result || result.dossier.currentVersion === 0) return null;
    return {
      scope,
      topic,
      dossierId: result.dossier.id,
      version: result.dossier.currentVersion,
      data: result.data,
      updatedAt: result.dossier.updatedAt,
    };
  }

  /**
   * List all ACTIVE knowledge entries, optionally filtered by scope.
   */
  list(scope?: KnowledgeScope): KnowledgeEntry[] {
    const results = this.dossierStore.search({
      entityType: ENTITY_TYPE,
      lifecycle: 'ACTIVE',
    });

    const entries: KnowledgeEntry[] = [];
    for (const result of results) {
      let parsed: { scope: KnowledgeScope; topic: string };
      try {
        parsed = KnowledgeStore.parseEntityId(result.dossier.entityId);
      } catch {
        continue;
      }
      if (scope && parsed.scope !== scope) continue;
      if (result.dossier.currentVersion === 0) continue;

      entries.push({
        scope: parsed.scope,
        topic: parsed.topic,
        dossierId: result.dossier.id,
        version: result.dossier.currentVersion,
        data: result.data,
        updatedAt: result.dossier.updatedAt,
      });
    }
    return entries;
  }

  /**
   * Archive a knowledge entry.
   */
  archive(scope: KnowledgeScope, topic: string): void {
    const entityId = KnowledgeStore.formatEntityId(scope, topic);
    const result = this.dossierStore.get(ENTITY_TYPE, entityId);
    if (!result) throw new Error(`Knowledge entry not found: ${entityId}`);
    this.dossierStore.transition(result.dossier.id, 'ARCHIVED');
  }
}

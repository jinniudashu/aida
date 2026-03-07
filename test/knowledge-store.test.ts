import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
  KnowledgeStore,
  loadSystemKnowledge,
} from '../src/index.js';

const TEST_BLUEPRINT = `
version: "1.0"
name: "Knowledge Test Blueprint"

services:
  - id: "svc-test"
    label: "Test Service"
    serviceType: "atomic"
    executorType: "manual"

events: []
instructions: []
rules: []
`;

describe('KnowledgeStore', () => {
  let engine: BpsEngine;
  let store: KnowledgeStore;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(TEST_BLUEPRINT, engine.blueprintStore);
    store = engine.knowledgeStore;
  });

  describe('Address Encoding', () => {
    it('should roundtrip formatEntityId + parseEntityId', () => {
      const entityId = KnowledgeStore.formatEntityId('system', 'test-topic');
      expect(entityId).toBe('system:test-topic');
      const parsed = KnowledgeStore.parseEntityId(entityId);
      expect(parsed).toEqual({ scope: 'system', topic: 'test-topic' });
    });

    it('should roundtrip project scope', () => {
      const entityId = KnowledgeStore.formatEntityId('project', 'config');
      expect(entityId).toBe('project:config');
      const parsed = KnowledgeStore.parseEntityId(entityId);
      expect(parsed).toEqual({ scope: 'project', topic: 'config' });
    });

    it('should throw on malformed entityId', () => {
      expect(() => KnowledgeStore.parseEntityId('invalid')).toThrow(/Invalid knowledge entityId/);
    });

    it('should throw on invalid scope', () => {
      expect(() => KnowledgeStore.parseEntityId('badscope:topic')).toThrow(/Invalid knowledge scope/);
    });
  });

  describe('CRUD', () => {
    it('should put + get (write then read)', () => {
      const entry = store.put('project', 'pricing', { basePrice: 100, currency: 'CNY' });
      expect(entry.version).toBe(1);
      expect(entry.data).toEqual({ basePrice: 100, currency: 'CNY' });

      const fetched = store.get('project', 'pricing');
      expect(fetched).not.toBeNull();
      expect(fetched!.data).toEqual({ basePrice: 100, currency: 'CNY' });
      expect(fetched!.dossierId).toBe(entry.dossierId);
    });

    it('should shallow-merge on second put (version increments)', () => {
      store.put('project', 'settings', { theme: 'dark', lang: 'zh' });
      const v2 = store.put('project', 'settings', { lang: 'en', fontSize: 14 });
      expect(v2.version).toBe(2);
      expect(v2.data).toEqual({ theme: 'dark', lang: 'en', fontSize: 14 });
    });

    it('should return null for non-existent entry', () => {
      expect(store.get('system', 'nope')).toBeNull();
    });

    it('should record committedBy correctly', () => {
      store.put('system', 'audit', { rule: 'test' }, { committedBy: 'agent:aida', message: 'init' });
      const entityId = KnowledgeStore.formatEntityId('system', 'audit');
      const result = engine.dossierStore.get('knowledge', entityId);
      expect(result).not.toBeNull();
      const versions = engine.dossierStore.listVersions(result!.dossier.id);
      expect(versions[0].committedBy).toBe('agent:aida');
      expect(versions[0].commitMessage).toBe('init');
    });
  });

  describe('List', () => {
    beforeEach(() => {
      store.put('system', 'core', { principle: 'test' });
      store.put('project', 'settings', { theme: 'dark' });
      store.put('project', 'routing', { algo: 'tsp' });
    });

    it('should list all entries', () => {
      const all = store.list();
      expect(all).toHaveLength(3);
    });

    it('should list entries filtered by scope', () => {
      const systemEntries = store.list('system');
      expect(systemEntries).toHaveLength(1);
      expect(systemEntries[0].topic).toBe('core');

      const projectEntries = store.list('project');
      expect(projectEntries).toHaveLength(2);
    });
  });

  describe('Lifecycle', () => {
    it('should not return archived entries in list', () => {
      store.put('project', 'old', { deprecated: true });
      expect(store.list('project')).toHaveLength(1);

      store.archive('project', 'old');
      expect(store.list('project')).toHaveLength(0);
    });
  });

  describe('Isolation', () => {
    it('should not interfere with regular entity dossiers', () => {
      const dossier = engine.dossierStore.getOrCreate('store', 'store-001');
      engine.dossierStore.commit(dossier.id, { name: 'My Store' });

      store.put('project', 'config', { setting: true });

      const stores = engine.dossierStore.search({ entityType: 'store' });
      expect(stores).toHaveLength(1);
      expect(stores[0].dossier.entityType).toBe('store');

      const knowledge = engine.dossierStore.search({ entityType: 'knowledge' });
      expect(knowledge.length).toBeGreaterThanOrEqual(1);
      knowledge.forEach(k => expect(k.dossier.entityType).toBe('knowledge'));
    });
  });
});

describe('System Knowledge', () => {
  it('should load 2 system knowledge entries via loadSystemKnowledge', () => {
    const engine = createBpsEngine();
    const result = loadSystemKnowledge(engine.knowledgeStore);
    expect(result.loaded).toBe(2);
    expect(result.skipped).toBe(0);

    const all = engine.knowledgeStore.list('system');
    expect(all).toHaveLength(2);
    const topics = all.map(e => e.topic).sort();
    expect(topics).toEqual(['project-config', 'task-tracking-sop']);
  });

  it('should be idempotent (loadSystemKnowledge twice)', () => {
    const engine = createBpsEngine();
    loadSystemKnowledge(engine.knowledgeStore);
    const result = loadSystemKnowledge(engine.knowledgeStore);
    expect(result.loaded).toBe(0);
    expect(result.skipped).toBe(2);
  });
});

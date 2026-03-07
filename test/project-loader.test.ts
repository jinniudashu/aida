import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'path';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
} from '../src/index.js';
import { loadProject, loadProjectFromString } from '../src/loader/project-loader.js';

// ——— 路径常量 ———
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');
const BLUEPRINT_BASE = FIXTURES;
const IDLEX_PROJECT = resolve(FIXTURES, 'project.yaml');
const IDLEX_DIR = FIXTURES;

describe('Project Loader', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
  });

  // ============================================================
  // 种子数据加载
  // ============================================================
  describe('Seed Data Loading', () => {
    it('应将种子实体写入 DossierStore 并可查询', () => {
      const result = loadProject(
        IDLEX_PROJECT,
        engine.blueprintStore,
        engine.dossierStore,
        { blueprintBasePath: BLUEPRINT_BASE },
      );

      expect(result.seeds.loaded).toBe(5);
      expect(result.seeds.errors).toEqual([]);

      const stores = engine.dossierStore.query({ entityType: 'store' });
      expect(stores).toHaveLength(5);
    });

    it('应正确设置所有种子实体的 entityType', () => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      const stores = engine.dossierStore.query({ entityType: 'store' });
      for (const store of stores) {
        expect(store.entityType).toBe('store');
      }
    });

    it('应完整保留实体数据字段', () => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      const result = engine.dossierStore.get('store', 'store-ktv-changsha-001');
      expect(result).not.toBeNull();
      expect(result!.data.storeName).toBe('唱吧自助KTV（五一广场店）');
      expect(result!.data.city).toBe('长沙');
      expect(result!.data.district).toBe('天心区');
      expect(result!.data.businessCircle).toBe('五一广场');
      expect(result!.data.lat).toBe(28.1967);
      expect(result!.data.lng).toBe(112.9774);
      expect(result!.data._mock).toBe(true);
      expect(result!.data.roomTypes).toHaveLength(3);
    });

    it('应默认 lifecycle 为 ACTIVE', () => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      const stores = engine.dossierStore.query({ entityType: 'store' });
      for (const store of stores) {
        expect(store.lifecycle).toBe('ACTIVE');
      }
    });

    it('应支持显式设置 DRAFT lifecycle', () => {
      const dossier = engine.dossierStore.getOrCreate('item', 'draft-001');
      engine.dossierStore.transition(dossier.id, 'DRAFT');
      engine.dossierStore.commit(dossier.id, { name: 'Draft Entity' }, {
        committedBy: 'project-loader:draft-test',
      });

      const found = engine.dossierStore.get('item', 'draft-001');
      expect(found!.dossier.lifecycle).toBe('DRAFT');
    });

    it('应记录 committedBy 为 "project-loader:{projectId}"', () => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      const result = engine.dossierStore.get('store', 'store-ktv-changsha-001');
      const versions = engine.dossierStore.listVersions(result!.dossier.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].committedBy).toBe('project-loader:idlex');
    });

    it('应支持多个不同 entityType 的种子文件', () => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      const nonStores = engine.dossierStore.query({ entityType: 'campaign' });
      expect(nonStores).toHaveLength(0);

      const stores = engine.dossierStore.query({ entityType: 'store' });
      expect(stores).toHaveLength(5);
    });

    it('幂等：重复加载更新版本而非重复创建', () => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      const stores = engine.dossierStore.query({ entityType: 'store' });
      expect(stores).toHaveLength(5);

      const result = engine.dossierStore.get('store', 'store-ktv-changsha-001');
      expect(result!.dossier.currentVersion).toBe(2);
    });

    it('应返回正确的加载计数', () => {
      const result = loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      expect(result.projectId).toBe('idlex');
      expect(result.name).toBe('IdleX GEO 长沙自助KTV');
      expect(result.blueprints.loaded).toBe(1);
      expect(result.blueprints.errors).toEqual([]);
      expect(result.seeds.loaded).toBe(5);
      expect(result.seeds.errors).toEqual([]);
    });
  });

  // ============================================================
  // 蓝图加载
  // ============================================================
  describe('Blueprint Loading', () => {
    it('应加载引用的蓝图到 BlueprintStore', () => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });

      const svc = engine.blueprintStore.getService('svc-geo-store-ops');
      expect(svc).not.toBeNull();
      expect(svc!.serviceType).toBe('composite');

      const services = engine.blueprintStore.listServices({ status: 'active' });
      expect(services).toHaveLength(12);
    });

    it('蓝图文件不存在时应收集错误', () => {
      const projectYaml = `
version: "1.0"
name: "Bad Blueprint"
projectId: "bad-bp"
blueprints:
  - "nonexistent-blueprint.yaml"
`;
      const result = loadProjectFromString(
        projectYaml,
        IDLEX_DIR,
        engine.blueprintStore,
        engine.dossierStore,
        { blueprintBasePath: BLUEPRINT_BASE },
      );

      expect(result.blueprints.loaded).toBe(0);
      expect(result.blueprints.errors).toHaveLength(1);
      expect(result.blueprints.errors[0]).toContain('nonexistent-blueprint.yaml');
    });
  });

  describe('Blueprint YAML Warnings', () => {
    it('services-only YAML 应产生缺失 events/instructions/rules 警告', () => {
      const yaml = `
version: "1.0"
name: "services-only"
services:
  - id: "svc-1"
    label: "Service 1"
`;
      const result = loadBlueprintFromString(yaml, engine.blueprintStore);
      expect(result.services).toBe(1);
      expect(result.warnings).toHaveLength(3);
      expect(result.warnings.some(w => w.includes('events'))).toBe(true);
      expect(result.warnings.some(w => w.includes('instructions'))).toBe(true);
      expect(result.warnings.some(w => w.includes('rules'))).toBe(true);
    });

    it('空 YAML 应产生缺失 services 警告', () => {
      const yaml = `
version: "1.0"
name: "empty"
`;
      const result = loadBlueprintFromString(yaml, engine.blueprintStore);
      expect(result.services).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('services');
    });

    it('完整 YAML 不应产生警告', () => {
      const yaml = `
version: "1.0"
name: "complete"
services:
  - id: "svc-1"
    label: "Service 1"
events:
  - id: "evt-1"
    label: "Event 1"
    expression: "process_state == 'NEW'"
instructions:
  - id: "instr-1"
    label: "Start"
    sysCall: "start_service"
rules:
  - id: "rule-1"
    label: "Rule 1"
    targetServiceId: "svc-1"
    serviceId: "svc-1"
    eventId: "evt-1"
    instructionId: "instr-1"
`;
      const result = loadBlueprintFromString(yaml, engine.blueprintStore);
      expect(result.services).toBe(1);
      expect(result.events).toBe(1);
      expect(result.instructions).toBe(1);
      expect(result.rules).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // ============================================================
  // 端到端：IdleX GEO + Mock Data
  // ============================================================
  describe('End-to-End: IdleX GEO + Mock Data', () => {
    beforeEach(() => {
      loadProject(IDLEX_PROJECT, engine.blueprintStore, engine.dossierStore, {
        blueprintBasePath: BLUEPRINT_BASE,
      });
    });

    it('应加载 5 家门店种子数据并可按 entityType 查询', () => {
      const stores = engine.dossierStore.query({ entityType: 'store' });
      expect(stores).toHaveLength(5);

      const store001 = engine.dossierStore.get('store', 'store-ktv-changsha-001');
      expect(store001).not.toBeNull();
      expect(store001!.data.storeName).toBe('唱吧自助KTV（五一广场店）');

      const store005 = engine.dossierStore.get('store', 'store-ktv-changsha-005');
      expect(store005).not.toBeNull();
      expect(store005!.data.storeName).toBe('嗨唱自助KTV（梅溪湖店）');
    });

    it('运行任务后 Dossier 应逐步富化（版本递增）', () => {
      // Create and complete data collection task
      const collectTask = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: 'store-ktv-changsha-001',
      });

      engine.tracker.completeTask(collectTask.id, {
        roomTypes: ['小包', '中包', '大包'],
        priceRange: '39-128元/时',
        photoCount: 15,
      });

      // Dossier version should increment
      const afterCollect = engine.dossierStore.get('store', 'store-ktv-changsha-001');
      expect(afterCollect!.dossier.currentVersion).toBe(2); // v1=seed, v2=task result

      // Task result fields should merge into dossier
      expect(afterCollect!.data.priceRange).toBe('39-128元/时');
      // Seed data fields should be preserved
      expect(afterCollect!.data.storeName).toBe('唱吧自助KTV（五一广场店）');
    });

    it('版本历史应同时包含 seed commit 和 task commit', () => {
      const collectTask = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: 'store-ktv-changsha-001',
      });
      engine.tracker.completeTask(collectTask.id, { verified: true });

      const store = engine.dossierStore.get('store', 'store-ktv-changsha-001');
      const versions = engine.dossierStore.listVersions(store!.dossier.id);

      expect(versions.length).toBeGreaterThanOrEqual(2);

      // v1: seed commit by project-loader
      expect(versions[0].committedBy).toBe('project-loader:idlex');

      // v2: task commit (committedBy = taskId)
      expect(versions[1].committedBy).toBe(collectTask.id);
    });
  });
});

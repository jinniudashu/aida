import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
} from '../src/index.js';

// ——— 加载蓝图 ———
const BLUEPRINT_PATH = resolve(import.meta.dirname!, 'fixtures', 'geo-ktv-changsha.yaml');
const BLUEPRINT_YAML = readFileSync(BLUEPRINT_PATH, 'utf-8');

describe('GEO KTV 长沙门店运营蓝图', () => {
  let engine: BpsEngine;
  let loadResult: ReturnType<typeof loadBlueprintFromString>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadResult = loadBlueprintFromString(BLUEPRINT_YAML, engine.blueprintStore);
  });

  // ============================================================
  // 蓝图加载验证
  // ============================================================
  describe('蓝图加载', () => {
    it('应成功加载全部定义且无错误', () => {
      expect(loadResult.errors).toEqual([]);
      expect(loadResult.services).toBe(12);
      expect(loadResult.events).toBe(3);
      expect(loadResult.instructions).toBe(4);
      expect(loadResult.rules).toBe(11);
    });

    it('应正确解析服务属性', () => {
      const ops = engine.blueprintStore.getService('svc-geo-store-ops');
      expect(ops).not.toBeNull();
      expect(ops!.serviceType).toBe('composite');
      expect(ops!.executorType).toBe('system');
      expect(ops!.entityType).toBe('store');
      expect(ops!.manualStart).toBe(true);

      const collect = engine.blueprintStore.getService('svc-data-collect');
      expect(collect!.executorType).toBe('agent');
      expect(collect!.agentSkills).toContain('data_collection');
      expect(collect!.agentPrompt).toContain('真实');

      const review = engine.blueprintStore.getService('svc-content-review');
      expect(review!.executorType).toBe('manual');
    });

    it('应正确解析事件定义', () => {
      const evtNew = engine.blueprintStore.getEvent('evt-new');
      expect(evtNew!.evaluationMode).toBe('deterministic');
      expect(evtNew!.expression).toBe("process_state == 'NEW'");

      const evtOpt = engine.blueprintStore.getEvent('evt-needs-optimization');
      expect(evtOpt!.evaluationMode).toBe('non_deterministic');
    });

    it('应能查询所有活跃服务', () => {
      const services = engine.blueprintStore.listServices({ status: 'active' });
      expect(services).toHaveLength(12);

      const agentServices = services.filter(s => s.executorType === 'agent');
      expect(agentServices.length).toBe(10);

      const manualServices = services.filter(s => s.executorType === 'manual');
      expect(manualServices.length).toBe(1);
      expect(manualServices[0].id).toBe('svc-content-review');
    });
  });

  // ============================================================
  // 任务创建与完成（使用 ProcessTracker）
  // ============================================================
  describe('任务创建与完成', () => {
    it('应创建门店入驻任务并追踪状态', () => {
      const task = engine.tracker.createTask({
        serviceId: 'svc-geo-store-ops',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
        metadata: {
          storeName: '唱吧自助KTV（五一广场店）',
          city: '长沙',
          district: '天心区',
        },
      });

      expect(task.state).toBe('OPEN');
      expect(task.entityType).toBe('store');
      expect(task.entityId).toBe('store-ktv-wuyi-001');
    });

    it('应完成入驻全链：数据采集 → 核验 → 档案生成', () => {
      // Phase 1: 创建任务并手动链式推进
      const opsTask = engine.tracker.createTask({
        serviceId: 'svc-geo-store-ops',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });

      const collectTask = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
        parentId: opsTask.id,
      });

      // Complete data collection
      engine.tracker.completeTask(collectTask.id, {
        roomTypes: ['小包', '中包', '大包'],
        priceRange: '39-128元/时',
        photos: 12,
      });
      expect(engine.processStore.get(collectTask.id)!.state).toBe('COMPLETED');

      // Data verify
      const verifyTask = engine.tracker.createTask({
        serviceId: 'svc-data-verify',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
        parentId: opsTask.id,
        previousId: collectTask.id,
      });

      engine.tracker.completeTask(verifyTask.id, {
        verificationScore: 95,
        issues: [],
      });
      expect(engine.processStore.get(verifyTask.id)!.state).toBe('COMPLETED');

      // Profile generation
      const profileTask = engine.tracker.createTask({
        serviceId: 'svc-profile-gen',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
        parentId: opsTask.id,
        previousId: verifyTask.id,
      });
      engine.tracker.completeTask(profileTask.id);
      expect(engine.processStore.get(profileTask.id)!.state).toBe('COMPLETED');
    });

    it('应支持并行多渠道发布任务', () => {
      // Create parallel publish tasks
      const doubaoTask = engine.tracker.createTask({
        serviceId: 'svc-publish-doubao',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });
      const qianwenTask = engine.tracker.createTask({
        serviceId: 'svc-publish-qianwen',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });
      const yuanbaoTask = engine.tracker.createTask({
        serviceId: 'svc-publish-yuanbao',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });

      // All should be OPEN
      expect(doubaoTask.state).toBe('OPEN');
      expect(qianwenTask.state).toBe('OPEN');
      expect(yuanbaoTask.state).toBe('OPEN');

      // Complete them in parallel
      engine.tracker.completeTask(doubaoTask.id, { channel: 'doubao', status: 'published' });
      engine.tracker.completeTask(qianwenTask.id, { channel: 'qianwen', status: 'published' });
      engine.tracker.completeTask(yuanbaoTask.id, { channel: 'yuanbao', status: 'published' });

      // All completed
      expect(engine.processStore.get(doubaoTask.id)!.state).toBe('COMPLETED');
      expect(engine.processStore.get(qianwenTask.id)!.state).toBe('COMPLETED');
      expect(engine.processStore.get(yuanbaoTask.id)!.state).toBe('COMPLETED');
    });
  });

  // ============================================================
  // 实体档案集成
  // ============================================================
  describe('实体档案集成', () => {
    it('子任务应继承实体信息', () => {
      const parentTask = engine.tracker.createTask({
        serviceId: 'svc-geo-store-ops',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });

      const childTask = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
        parentId: parentTask.id,
      });

      expect(childTask.entityType).toBe('store');
      expect(childTask.entityId).toBe('store-ktv-wuyi-001');
    });

    it('元数据应保存到上下文快照', () => {
      const task = engine.tracker.createTask({
        serviceId: 'svc-geo-store-ops',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
        metadata: { storeName: '唱吧KTV', city: '长沙', businessCircle: '五一广场' },
      });

      const result = engine.tracker.getTask(task.id);
      expect(result).not.toBeNull();
      expect(result!.metadata!['storeName']).toBe('唱吧KTV');
      expect(result!.metadata!['city']).toBe('长沙');
      expect(result!.metadata!['businessCircle']).toBe('五一广场');
    });

    it('完成任务应自动提交到 Dossier', () => {
      const task = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });

      engine.tracker.completeTask(task.id, {
        roomTypes: ['小包', '中包', '大包'],
        priceRange: '39-128元/时',
      });

      const dossier = engine.dossierStore.get('store', 'store-ktv-wuyi-001');
      expect(dossier).not.toBeNull();
      expect(dossier!.data.roomTypes).toEqual(['小包', '中包', '大包']);
    });

    it('任务应具有递增PID', () => {
      const t1 = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });
      const t2 = engine.tracker.createTask({
        serviceId: 'svc-data-verify',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });

      expect(t2.pid).toBeGreaterThan(t1.pid);
    });
  });

  // ============================================================
  // 审计日志
  // ============================================================
  describe('审计日志', () => {
    it('应记录任务生命周期的所有操作', () => {
      const task = engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      });

      engine.tracker.completeTask(task.id, { data: 'collected' });

      const logs = engine.db.prepare(
        'SELECT * FROM bps_task_log WHERE task_id = ? ORDER BY timestamp ASC'
      ).all(task.id) as Array<Record<string, unknown>>;

      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect(logs[0]['action']).toBe('created');
      expect(logs[logs.length - 1]['action']).toBe('completed');
    });
  });
});

/**
 * 端到端全场景测试 — IdleX GEO 业务运营生命周期
 *
 * 验证 bps-engine 基础设施对 8 个业务场景（场景 0-7）的支撑能力。
 * 模拟 Aida 在各场景中对引擎 API 的典型调用模式。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'path';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromYaml,
  KnowledgeStore,
  loadSystemKnowledge,
} from '../src/index.js';

const FIXTURES = resolve(import.meta.dirname!, 'fixtures');
const GEO_BLUEPRINT = resolve(FIXTURES, 'geo-ktv-changsha.yaml');

// ================================================================
// 场景 0：业务启动（项目初始化）
// ================================================================

describe('场景 0：业务启动', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
  });

  it('引擎启动后所有子系统就绪', () => {
    expect(engine.tracker).toBeDefined();
    expect(engine.processStore).toBeDefined();
    expect(engine.dossierStore).toBeDefined();
    expect(engine.blueprintStore).toBeDefined();
    expect(engine.dashboardQuery).toBeDefined();
  });

  it('系统知识自动加载', () => {
    const ks = new KnowledgeStore(engine.dossierStore);
    const result = loadSystemKnowledge(ks);
    expect(result.loaded).toBe(2);

    const config = ks.get('system', 'project-config');
    expect(config).not.toBeNull();

    const sop = ks.get('system', 'task-tracking-sop');
    expect(sop).not.toBeNull();
  });

  it('蓝图加载后服务目录可查询', () => {
    loadBlueprintFromYaml(GEO_BLUEPRINT, engine.blueprintStore);
    const services = engine.blueprintStore.listServices({ status: 'active' });
    expect(services.length).toBeGreaterThanOrEqual(12);
  });
});

// ================================================================
// 场景 1：确认业务意图
// ================================================================

describe('场景 1：确认业务意图', () => {
  let engine: BpsEngine;
  let ks: KnowledgeStore;

  beforeEach(() => {
    engine = createBpsEngine();
    ks = new KnowledgeStore(engine.dossierStore);
  });

  it('业务意图可结构化存档到 KnowledgeStore', () => {
    ks.put('project', 'business-intent', {
      goal: '将长沙自助KTV门店转化为AI可理解的数字资产',
      scope: '长沙市 5 个主要商圈，首批 50 家门店',
      timeline: '2026 Q2 完成首批入驻',
      successMetrics: ['门店覆盖率 > 80%', 'GEO 内容质量评分 > 85'],
    });

    const intent = ks.get('project', 'business-intent');
    expect(intent).not.toBeNull();
    expect(intent!.data.goal).toContain('数字资产');
    expect(intent!.data.successMetrics).toHaveLength(2);
  });

  it('意图更新保留版本历史', () => {
    ks.put('project', 'business-intent', {
      goal: '50 家门店 GEO 覆盖',
      version: 'v1-initial',
    });

    ks.put('project', 'business-intent', {
      goal: '50 家门店 GEO 覆盖 + 持续优化',
      version: 'v2-refined',
      addedBy: 'user-feedback',
    });

    const latest = ks.get('project', 'business-intent');
    expect(latest!.data.version).toBe('v2-refined');
    expect(latest!.version).toBe(2);
  });

  it('业务背景上下文可通过 DossierStore 持久化', () => {
    const ctx = engine.dossierStore.getOrCreate('context', 'business-background');
    engine.dossierStore.commit(ctx.id, {
      industry: '自助KTV / 共享空间',
      city: '长沙',
      competitors: ['唱吧', '全民K歌', '魔方KTV'],
      marketInsights: '年轻消费群体偏好短时段娱乐',
    });

    const result = engine.dossierStore.get('context', 'business-background');
    expect(result!.data.industry).toContain('自助KTV');
    expect(result!.data.competitors).toHaveLength(3);
  });
});

// ================================================================
// 场景 2：探讨业务策略
// ================================================================

describe('场景 2：探讨业务策略', () => {
  let engine: BpsEngine;
  let ks: KnowledgeStore;

  beforeEach(() => {
    engine = createBpsEngine();
    ks = new KnowledgeStore(engine.dossierStore);
  });

  it('策略研究成果可存档为知识条目', () => {
    ks.put('project', 'geo-strategy', {
      approach: 'GEO 内容矩阵：结构化数据 + 自然语言描述 + 多模型适配',
      channels: ['doubao', 'qianwen', 'yuanbao'],
      contentTypes: ['门店档案', '场景推荐', '价格对比', '用户评价摘要'],
      publishFrequency: 'weekly-per-store',
    });

    const strategy = ks.get('project', 'geo-strategy');
    expect(strategy!.data.channels).toHaveLength(3);
  });

  it('多轮策略迭代体现为知识版本递增', () => {
    ks.put('project', 'geo-strategy', { phase: 'initial', channels: ['doubao'] });
    ks.put('project', 'geo-strategy', { phase: 'expanded', channels: ['doubao', 'qianwen', 'yuanbao'] });
    ks.put('project', 'geo-strategy', { phase: 'optimized', channels: ['doubao', 'qianwen', 'yuanbao'], a_b_test: true });

    const latest = ks.get('project', 'geo-strategy');
    expect(latest!.version).toBe(3);
    expect(latest!.data.a_b_test).toBe(true);
  });

  it('领域知识可独立存档供后续检索', () => {
    ks.put('project', 'domain-ktv-insights', {
      peakHours: '18:00-22:00',
      avgSessionDuration: '2.5h',
      priceRange: '39-128 元/时',
      keySellingPoints: ['隔音效果', '歌曲库大小', '环境卫生'],
    });

    const all = ks.list('project');
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some(e => e.topic === 'domain-ktv-insights')).toBe(true);
  });
});

// ================================================================
// 场景 3：确立行动计划
// ================================================================

describe('场景 3：确立行动计划', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromYaml(GEO_BLUEPRINT, engine.blueprintStore);
  });

  it('行动计划作为 DossierStore 实体存储', () => {
    const plan = engine.dossierStore.getOrCreate('action-plan', 'plan-geo-changsha-001');
    engine.dossierStore.commit(plan.id, {
      status: 'active',
      type: 'finite',
      completionCriteria: '50 家门店完成 GEO 入驻',
      periodicItems: [
        { id: 'collect-weekly', name: '每周门店数据采集', cron: '0 9 * * 1', serviceId: 'svc-data-collect', deadline: '2026-06-30' },
        { id: 'publish-weekly', name: '每周 GEO 内容发布', cron: '0 14 * * 3', serviceId: 'svc-publish-doubao', deadline: '2026-06-30' },
      ],
      oneshotItems: [
        { id: 'initial-50', name: '首批 50 家门店入驻', deadline: '2026-04-15', serviceId: 'svc-geo-store-ops' },
      ],
      observationPoints: [
        { trigger: 'weekly', format: '进度摘要 + 关键指标 + 风险项' },
        { trigger: 'on-milestone', condition: '每完成 10 家门店', format: '里程碑报告' },
      ],
      resources: {
        tokenBudget: 50000,
        externalApis: ['maps.googleapis.com', 'api.doubao.com'],
      },
      agents: [
        { id: 'geo-collector', role: 'GEO 数据采集专员', status: 'planned' },
      ],
    });

    const result = engine.dossierStore.get('action-plan', 'plan-geo-changsha-001');
    expect(result).not.toBeNull();
    expect(result!.data.status).toBe('active');
    expect(result!.data.periodicItems).toHaveLength(2);
    expect(result!.data.oneshotItems).toHaveLength(1);
    expect(result!.data.observationPoints).toHaveLength(2);
  });

  it('计划更新保留完整版本历史', () => {
    const plan = engine.dossierStore.getOrCreate('action-plan', 'plan-geo-001');
    engine.dossierStore.commit(plan.id, { status: 'draft', periodicItems: [] }, { message: '初始草案' });
    engine.dossierStore.commit(plan.id, { status: 'active', periodicItems: [{ id: 'p1' }] }, { message: '用户确认' });

    const versions = engine.dossierStore.listVersions(plan.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].commitMessage).toBe('初始草案');
    expect(versions[1].commitMessage).toBe('用户确认');
  });

  it('有限计划和持续计划可区分', () => {
    const finite = engine.dossierStore.getOrCreate('action-plan', 'plan-finite');
    engine.dossierStore.commit(finite.id, {
      type: 'finite',
      completionCriteria: '50 家门店入驻完成',
    });

    const continuous = engine.dossierStore.getOrCreate('action-plan', 'plan-continuous');
    engine.dossierStore.commit(continuous.id, {
      type: 'continuous',
      completionCriteria: null,
    });

    const plans = engine.dossierStore.search({ entityType: 'action-plan' });
    expect(plans).toHaveLength(2);
    expect(plans.find(p => p.data.type === 'finite')).toBeDefined();
    expect(plans.find(p => p.data.type === 'continuous')).toBeDefined();
  });
});

// ================================================================
// 场景 4：执行计划
// ================================================================

describe('场景 4：执行计划', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromYaml(GEO_BLUEPRINT, engine.blueprintStore);
  });

  it('完整门店入驻任务链：采集 → 核验 → 档案生成', () => {
    // Aida 创建顶层编排任务
    const ops = engine.tracker.createTask({
      serviceId: 'svc-geo-store-ops',
      entityType: 'store',
      entityId: 'store-ktv-wuyi-001',
      metadata: { storeName: '唱吧自助KTV（五一广场店）', city: '长沙' },
    });
    expect(ops.state).toBe('OPEN');

    // 子任务 1：数据采集
    const collect = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-ktv-wuyi-001',
      parentId: ops.id,
    });
    engine.tracker.completeTask(collect.id, {
      roomTypes: ['小包', '中包', '大包'],
      priceRange: '39-128元/时',
      photos: 15,
    });

    // Dossier 应自动富化
    const afterCollect = engine.dossierStore.get('store', 'store-ktv-wuyi-001');
    expect(afterCollect!.data.priceRange).toBe('39-128元/时');
    expect(afterCollect!.dossier.currentVersion).toBe(1);

    // 子任务 2：数据核验
    const verify = engine.tracker.createTask({
      serviceId: 'svc-data-verify',
      entityType: 'store',
      entityId: 'store-ktv-wuyi-001',
      parentId: ops.id,
      previousId: collect.id,
    });
    engine.tracker.completeTask(verify.id, { score: 95, issues: [] });

    // Dossier 版本递增
    const afterVerify = engine.dossierStore.get('store', 'store-ktv-wuyi-001');
    expect(afterVerify!.dossier.currentVersion).toBe(2);

    // 子任务 3：档案生成
    const profile = engine.tracker.createTask({
      serviceId: 'svc-profile-gen',
      entityType: 'store',
      entityId: 'store-ktv-wuyi-001',
      parentId: ops.id,
      previousId: verify.id,
    });
    engine.tracker.completeTask(profile.id);

    // 任务树完整
    const tree = engine.tracker.getTaskTree(ops.id);
    expect(tree).not.toBeNull();
    expect(tree!.children).toHaveLength(3);
  });

  it('并行多渠道发布', () => {
    const channels = ['svc-publish-doubao', 'svc-publish-qianwen', 'svc-publish-yuanbao'];
    const tasks = channels.map(svc =>
      engine.tracker.createTask({
        serviceId: svc,
        entityType: 'store',
        entityId: 'store-ktv-wuyi-001',
      }),
    );

    // 全部并行完成
    for (const t of tasks) {
      engine.tracker.completeTask(t.id, { status: 'published' });
    }

    const completed = engine.processStore.query({ state: 'COMPLETED' });
    expect(completed.length).toBe(3);
  });

  it('Cron 工作循环：查询到期任务 + 创建 + 完成', () => {
    // 模拟 Cron 唤醒后 Aida 的行为：
    // 1. 查询行动计划
    const plan = engine.dossierStore.getOrCreate('action-plan', 'plan-001');
    engine.dossierStore.commit(plan.id, {
      status: 'active',
      periodicItems: [
        { id: 'collect-weekly', serviceId: 'svc-data-collect', cron: '0 9 * * 1' },
      ],
    });

    // 2. 按计划创建本轮任务
    const storeIds = ['store-001', 'store-002', 'store-003'];
    const tasks = storeIds.map(sid =>
      engine.tracker.createTask({
        serviceId: 'svc-data-collect',
        entityType: 'store',
        entityId: sid,
        metadata: { planId: 'plan-001', periodicItemId: 'collect-weekly', cycle: '2026-W10' },
      }),
    );

    // 3. 执行并完成
    for (const t of tasks) {
      engine.tracker.completeTask(t.id, { collected: true });
    }

    // 4. 验证：按 serviceId 查询本轮完成的任务
    const done = engine.processStore.query({
      state: 'COMPLETED',
      serviceId: 'svc-data-collect',
    });
    expect(done.length).toBe(3);

    // 5. 验证：每个门店的 Dossier 已自动富化
    for (const sid of storeIds) {
      const d = engine.dossierStore.get('store', sid);
      expect(d).not.toBeNull();
      expect(d!.data.collected).toBe(true);
    }
  });

  it('任务失败 + 恢复', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-fail-001',
    });

    engine.tracker.failTask(task.id, '外部 API 超时');
    expect(engine.processStore.get(task.id)!.state).toBe('FAILED');

    // 重试：从 FAILED 恢复到 OPEN
    engine.tracker.updateTask(task.id, { state: 'OPEN' });
    expect(engine.processStore.get(task.id)!.state).toBe('OPEN');

    // 重新完成
    engine.tracker.completeTask(task.id, { retried: true });
    expect(engine.processStore.get(task.id)!.state).toBe('COMPLETED');
  });

  it('审计日志完整记录任务生命周期', () => {
    const task = engine.tracker.createTask({
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-audit-001',
    });
    engine.tracker.updateTask(task.id, { state: 'IN_PROGRESS' });
    engine.tracker.completeTask(task.id, { done: true });

    const logs = engine.db.prepare(
      'SELECT * FROM bps_task_log WHERE task_id = ? ORDER BY timestamp ASC',
    ).all(task.id) as Array<Record<string, unknown>>;

    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(logs[0]['action']).toBe('created');
    expect(logs[logs.length - 1]['action']).toBe('completed');
  });
});

// ================================================================
// 场景 5：短周期总结
// ================================================================

describe('场景 5：短周期总结', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromYaml(GEO_BLUEPRINT, engine.blueprintStore);

    // 模拟一周的执行数据
    for (let i = 1; i <= 10; i++) {
      const task = engine.tracker.createTask({
        serviceId: i <= 7 ? 'svc-data-collect' : 'svc-data-verify',
        entityType: 'store',
        entityId: `store-week1-${String(i).padStart(3, '0')}`,
      });
      if (i <= 8) {
        engine.tracker.completeTask(task.id, { score: 80 + i });
      } else if (i === 9) {
        engine.tracker.failTask(task.id, '数据不完整');
      }
      // task 10 stays OPEN
    }
  });

  it('Dashboard 概览提供统计指标', () => {
    const overview = engine.dashboardQuery.getOverview();

    expect(overview.processes.totalCount).toBe(10);
    expect(overview.processes.byState['COMPLETED']).toBe(8);
    expect(overview.processes.byState['FAILED']).toBe(1);
    expect(overview.processes.activeCount).toBe(1); // 1 OPEN
    expect(overview.processes.errorCount).toBe(1);
  });

  it('Kanban 视图展示任务分布', () => {
    const kanban = engine.dashboardQuery.getProcessKanban();
    const states = kanban.map(col => col.state);
    expect(states).toEqual(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BLOCKED']);

    const completedCol = kanban.find(c => c.state === 'COMPLETED')!;
    expect(completedCol.count).toBe(8);

    const failedCol = kanban.find(c => c.state === 'FAILED')!;
    expect(failedCol.count).toBe(1);
  });

  it('实体数据支持总结分析（按 entityType 查询）', () => {
    const stores = engine.dossierStore.search({ entityType: 'store' });
    expect(stores.length).toBe(8); // 8 个成功提交了数据

    const scores = stores
      .map(s => s.data.score as number)
      .filter(s => typeof s === 'number');
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(avgScore).toBeGreaterThan(80);
  });

  it('总结报告可作为 Dossier 存档', () => {
    const report = engine.dossierStore.getOrCreate('report', 'weekly-2026-W10');
    engine.dossierStore.commit(report.id, {
      period: '2026-W10',
      tasksCompleted: 8,
      tasksFailed: 1,
      tasksOpen: 1,
      storesOnboarded: 8,
      avgQualityScore: 84.5,
      issues: ['store-week1-009 数据不完整，需重采'],
      recommendations: ['增加数据采集前的预检步骤'],
    });

    const result = engine.dossierStore.get('report', 'weekly-2026-W10');
    expect(result!.data.tasksCompleted).toBe(8);
    expect(result!.data.recommendations).toHaveLength(1);
  });
});

// ================================================================
// 场景 6：长周期总结
// ================================================================

describe('场景 6：长周期总结', () => {
  let engine: BpsEngine;
  let ks: KnowledgeStore;

  beforeEach(() => {
    engine = createBpsEngine();
    ks = new KnowledgeStore(engine.dossierStore);
  });

  it('目标意向可随时间演进（版本追踪）', () => {
    ks.put('project', 'business-intent', {
      goal: '50 家门店 GEO 覆盖',
      phase: 'Q2-2026',
    });

    ks.put('project', 'business-intent', {
      goal: '长沙全市 200 家门店 + 武汉试点',
      phase: 'Q3-2026',
      reason: 'Q2 目标提前达成，扩大范围',
    });

    const latest = ks.get('project', 'business-intent');
    expect(latest!.data.phase).toBe('Q3-2026');
    expect(latest!.version).toBe(2);
  });

  it('策略有效性可通过历史报告比对', () => {
    // 存储多个周期的报告
    for (const week of ['W10', 'W11', 'W12', 'W13']) {
      const r = engine.dossierStore.getOrCreate('report', `weekly-2026-${week}`);
      engine.dossierStore.commit(r.id, {
        period: `2026-${week}`,
        storesOnboarded: 8 + parseInt(week.slice(1)) - 10,
        avgQualityScore: 80 + parseInt(week.slice(1)) - 10,
      });
    }

    const reports = engine.dossierStore.search({ entityType: 'report' });
    expect(reports).toHaveLength(4);

    // 验证趋势可分析
    const scores = reports.map(r => r.data.avgQualityScore as number).sort();
    expect(scores[scores.length - 1]).toBeGreaterThan(scores[0]);
  });

  it('行动计划可从 active 迁移到 completed', () => {
    const plan = engine.dossierStore.getOrCreate('action-plan', 'plan-finite-001');
    engine.dossierStore.commit(plan.id, { status: 'active', completionCriteria: '50 家门店' });
    engine.dossierStore.commit(plan.id, { status: 'completed', finalCount: 52, completedAt: '2026-04-10' });

    const result = engine.dossierStore.get('action-plan', 'plan-finite-001');
    expect(result!.data.status).toBe('completed');
    expect(result!.dossier.currentVersion).toBe(2);
  });
});

// ================================================================
// 场景 7：日常运营规则维护
// ================================================================

describe('场景 7：日常运营规则维护', () => {
  let engine: BpsEngine;
  let ks: KnowledgeStore;

  beforeEach(() => {
    engine = createBpsEngine();
    ks = new KnowledgeStore(engine.dossierStore);
  });

  it('业务判断标准可存储和更新', () => {
    ks.put('project', 'quality-rules', {
      minQualityScore: 80,
      requiredFields: ['storeName', 'address', 'roomTypes', 'priceRange'],
      autoRejectConditions: ['缺少照片', '地址无法定位'],
    });

    const rules = ks.get('project', 'quality-rules');
    expect(rules!.data.minQualityScore).toBe(80);

    // 运营优化：提高标准
    ks.put('project', 'quality-rules', {
      minQualityScore: 85,
      requiredFields: ['storeName', 'address', 'roomTypes', 'priceRange', 'photos'],
      autoRejectConditions: ['缺少照片', '地址无法定位', '营业时间缺失'],
    });

    const updated = ks.get('project', 'quality-rules');
    expect(updated!.data.minQualityScore).toBe(85);
    expect(updated!.version).toBe(2);
  });

  it('操作 SOP 可存储和检索', () => {
    ks.put('project', 'sop-publish-checklist', {
      name: 'GEO 内容发布前检查清单',
      steps: [
        '确认门店档案数据完整',
        '确认内容质量评分 >= 85',
        '确认照片数量 >= 5',
        '确认多渠道格式适配',
        '确认无敏感词/违规内容',
      ],
    });

    const sop = ks.get('project', 'sop-publish-checklist');
    expect(sop!.data.steps).toHaveLength(5);
  });

  it('规则变更可追溯', () => {
    ks.put('project', 'approval-rules', { maxAutoApprove: 10000 });
    ks.put('project', 'approval-rules', { maxAutoApprove: 50000, reason: '业务量增长，提高自动审批额度' });

    const entry = ks.get('project', 'approval-rules');
    expect(entry!.version).toBe(2);
    expect(entry!.data.reason).toContain('业务量增长');
  });

  it('全部项目知识可列表查看', () => {
    ks.put('project', 'quality-rules', { minScore: 80 });
    ks.put('project', 'sop-publish', { steps: ['a', 'b'] });
    ks.put('project', 'approval-rules', { max: 10000 });

    const all = ks.list('project');
    expect(all.length).toBe(3);
    expect(all.map(e => e.topic).sort()).toEqual([
      'approval-rules', 'quality-rules', 'sop-publish',
    ]);
  });

  it('过时的规则可归档', () => {
    ks.put('project', 'deprecated-rule', { note: '已废弃' });
    ks.archive('project', 'deprecated-rule');

    // 归档后 list 不再包含该条目（list 只返回 ACTIVE）
    const remaining = ks.list('project');
    expect(remaining.find(e => e.topic === 'deprecated-rule')).toBeUndefined();

    // 但 get 仍可读取（用于审计追溯）
    const entry = ks.get('project', 'deprecated-rule');
    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual({ note: '已废弃' });
  });
});

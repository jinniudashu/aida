/**
 * Phase A+B Capability Verification E2E Tests
 *
 * 验证 4 项目标能力：
 * 1. BPS 核心能力 — 流程推进 + 事件驱动感知（flow progression via bps_next_steps）
 * 2. Cron 巡检效率 — bps_scan_work 一次调用替代 5 次
 * 3. 审计痕迹 — reason 字段存入 metadata snapshot
 * 4. 规则评估上下文 — expression + description（非确定性事件）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
} from '../src/index.js';
import { createBpsTools } from '../src/integration/tools.js';
import type { OpenClawAgentTool } from '../src/integration/openclaw-types.js';

// ——— 端到端蓝图：模拟 GEO KTV 门店入驻完整链路 ———
// 包含确定性 + 非确定性事件、多步流程推进

const GEO_ONBOARD_BLUEPRINT = `
version: "1.0"
name: "GEO KTV Onboarding E2E"

services:
  - id: "svc-data-collect"
    label: "门店数据采集"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"
    agentSkills: ["data_collection"]
    agentPrompt: "采集门店基础信息（名称、地址、营业时间）并验证数据完整性"

  - id: "svc-content-gen"
    label: "GEO内容生成"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"
    agentSkills: ["geo_content_gen"]
    agentPrompt: "根据门店数据生成 GEO 优化内容（标题、描述、FAQ）"

  - id: "svc-content-review"
    label: "内容人工审核"
    serviceType: "atomic"
    executorType: "manual"
    entityType: "store"

  - id: "svc-publish"
    label: "内容发布"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"
    agentSkills: ["content_publish"]
    agentPrompt: "将审核通过的内容发布到各平台"

  - id: "svc-optimize"
    label: "效果优化"
    serviceType: "atomic"
    executorType: "agent"
    entityType: "store"
    agentSkills: ["geo_optimize"]
    agentPrompt: "根据效果数据调整内容策略"

events:
  - id: "evt-data-ready"
    label: "数据采集完成"
    evaluationMode: "deterministic"
    expression: "state == 'COMPLETED'"

  - id: "evt-content-ready"
    label: "内容生成完成"
    evaluationMode: "deterministic"
    expression: "state == 'COMPLETED'"

  - id: "evt-review-passed"
    label: "审核通过"
    evaluationMode: "deterministic"
    expression: "review_result == 'approved'"

  - id: "evt-needs-optimization"
    label: "GEO效果不达标需优化"
    name: "GEO效果评分低于60分，AI推荐出现率或转化率不达预期，需要启动内容迭代优化"
    evaluationMode: "non_deterministic"
    parameters:
      threshold: 60
      metrics: ["appearance_rate", "conversion_rate"]

  - id: "evt-quality-concern"
    label: "内容质量存疑"
    name: "AI生成内容可能存在事实错误或不符合品牌调性，需要人工二次审核"
    evaluationMode: "non_deterministic"

instructions:
  - id: "ins-start-content"
    label: "启动内容生成"
    sysCall: "start_service"

  - id: "ins-start-review"
    label: "启动审核"
    sysCall: "start_service"

  - id: "ins-start-publish"
    label: "启动发布"
    sysCall: "start_service"

  - id: "ins-start-optimize"
    label: "启动优化"
    sysCall: "start_service"

rules:
  - id: "rule-collect-to-content"
    label: "采集完成→生成内容"
    targetServiceId: "svc-data-collect"
    serviceId: "svc-data-collect"
    eventId: "evt-data-ready"
    instructionId: "ins-start-content"
    operandServiceId: "svc-content-gen"
    order: 1

  - id: "rule-content-to-review"
    label: "内容完成→人工审核"
    targetServiceId: "svc-content-gen"
    serviceId: "svc-content-gen"
    eventId: "evt-content-ready"
    instructionId: "ins-start-review"
    operandServiceId: "svc-content-review"
    order: 1

  - id: "rule-content-quality-concern"
    label: "内容质量存疑→人工审核"
    targetServiceId: "svc-content-gen"
    serviceId: "svc-content-gen"
    eventId: "evt-quality-concern"
    instructionId: "ins-start-review"
    operandServiceId: "svc-content-review"
    order: 2

  - id: "rule-review-to-publish"
    label: "审核通过→发布"
    targetServiceId: "svc-content-review"
    serviceId: "svc-content-review"
    eventId: "evt-review-passed"
    instructionId: "ins-start-publish"
    operandServiceId: "svc-publish"
    order: 1

  - id: "rule-publish-to-optimize"
    label: "发布后→检查是否需要优化"
    targetServiceId: "svc-publish"
    serviceId: "svc-publish"
    eventId: "evt-needs-optimization"
    instructionId: "ins-start-optimize"
    operandServiceId: "svc-optimize"
    order: 1
`;

// ——————————————————————————————————
// Helper：像 Agent 一样操作 tools
// ——————————————————————————————————

function toolMap(engine: BpsEngine): Map<string, OpenClawAgentTool> {
  const tools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
  });
  return new Map(tools.map(t => [t.name, t]));
}

async function call(tools: Map<string, OpenClawAgentTool>, name: string, input: Record<string, unknown> = {}): Promise<any> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.execute('e2e-call', input);
}

// ============================================================
// 能力 1：BPS 核心能力 — 流程推进 + 事件驱动感知
// ============================================================

describe('Capability 1: Flow Progression + Event-Driven Awareness', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(GEO_ONBOARD_BLUEPRINT, engine.blueprintStore);
    tools = toolMap(engine);
  });

  it('Agent can discover full service chain via bps_next_steps', async () => {
    // Step 1: Agent sees "数据采集" and asks "what's next?"
    const step1 = await call(tools, 'bps_next_steps', { serviceId: 'svc-data-collect' });
    expect(step1.nextSteps).toHaveLength(1);
    expect(step1.nextSteps[0].action.targetServiceId).toBe('svc-content-gen');

    // Step 2: After content generation, two downstream rules
    const step2 = await call(tools, 'bps_next_steps', { serviceId: 'svc-content-gen' });
    expect(step2.nextSteps).toHaveLength(2);
    const ruleIds = step2.nextSteps.map((s: any) => s.ruleId);
    expect(ruleIds).toContain('rule-content-to-review');
    expect(ruleIds).toContain('rule-content-quality-concern');

    // Step 3: After review, publish
    const step3 = await call(tools, 'bps_next_steps', { serviceId: 'svc-content-review' });
    expect(step3.nextSteps).toHaveLength(1);
    expect(step3.nextSteps[0].action.targetServiceId).toBe('svc-publish');

    // Step 4: After publish, conditional optimization
    const step4 = await call(tools, 'bps_next_steps', { serviceId: 'svc-publish' });
    expect(step4.nextSteps).toHaveLength(1);
    expect(step4.nextSteps[0].trigger.evaluationMode).toBe('non_deterministic');
  });

  it('Agent can execute full onboarding chain: create → progress → complete → flow forward', async () => {
    // Create task for data collection
    const created = await call(tools, 'bps_create_task', {
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-e2e-001',
    });
    expect(created.success).toBe(true);
    expect(created.state).toBe('OPEN');

    // Progress to IN_PROGRESS
    const progressed = await call(tools, 'bps_update_task', {
      taskId: created.taskId,
      state: 'IN_PROGRESS',
      reason: 'Starting data collection for 晨光咖啡朝阳门店',
    });
    expect(progressed.success).toBe(true);
    expect(progressed.currentState).toBe('IN_PROGRESS');

    // Complete data collection
    const completed = await call(tools, 'bps_complete_task', {
      taskId: created.taskId,
      result: { storeName: '晨光咖啡朝阳门店', address: '朝阳区建国路88号', verified: true },
      reason: 'Data collection verified complete',
    });
    expect(completed.success).toBe(true);
    expect(completed.finalState).toBe('COMPLETED');

    // Flow forward: check next steps
    const nextSteps = await call(tools, 'bps_next_steps', { serviceId: 'svc-data-collect' });
    expect(nextSteps.nextSteps).toHaveLength(1);
    expect(nextSteps.nextSteps[0].action.targetServiceId).toBe('svc-content-gen');

    // Agent creates next task based on blueprint guidance
    const nextTask = await call(tools, 'bps_create_task', {
      serviceId: 'svc-content-gen',
      entityType: 'store',
      entityId: 'store-e2e-001',
    });
    expect(nextTask.success).toBe(true);

    // Verify the chain is trackable — query both terminal and non-terminal states
    const openTasks = await call(tools, 'bps_query_tasks', { entityId: 'store-e2e-001', state: 'OPEN' });
    const completedTasks = await call(tools, 'bps_query_tasks', { entityId: 'store-e2e-001', state: 'COMPLETED' });
    expect(openTasks.count).toBe(1);
    expect(completedTasks.count).toBe(1);
    expect(openTasks.tasks[0].serviceId).toBe('svc-content-gen');
    expect(completedTasks.tasks[0].serviceId).toBe('svc-data-collect');
  });
});

// ============================================================
// 能力 2：Cron 巡检效率 — bps_scan_work 一次调用替代 5 次
// ============================================================

describe('Capability 2: bps_scan_work Efficiency', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(GEO_ONBOARD_BLUEPRINT, engine.blueprintStore);
    tools = toolMap(engine);
  });

  it('bps_scan_work returns all 5 categories in a single call', async () => {
    // Setup: create tasks in various states
    const t1 = await call(tools, 'bps_create_task', { serviceId: 'svc-data-collect', entityType: 'store', entityId: 'store-scan-1' });
    const t2 = await call(tools, 'bps_create_task', { serviceId: 'svc-content-gen', entityType: 'store', entityId: 'store-scan-2' });
    const t3 = await call(tools, 'bps_create_task', { serviceId: 'svc-publish', entityType: 'store', entityId: 'store-scan-3' });

    // t1: OPEN → IN_PROGRESS
    await call(tools, 'bps_update_task', { taskId: t1.taskId, state: 'IN_PROGRESS' });
    // t2: complete it
    await call(tools, 'bps_complete_task', { taskId: t2.taskId, result: { done: true } });
    // t3: fail it
    await call(tools, 'bps_update_task', { taskId: t3.taskId, state: 'IN_PROGRESS' });
    await call(tools, 'bps_update_task', { taskId: t3.taskId, state: 'FAILED' });

    // Create an active action plan
    engine.dossierStore.getOrCreate('action-plan', 'plan-geo-rollout');
    engine.dossierStore.commit(
      engine.dossierStore.getOrCreate('action-plan', 'plan-geo-rollout').id,
      { status: 'active', type: 'continuous', periodicItems: [{ id: 'daily-standup', cron: '0 9 * * *' }] },
    );

    // ONE call to scan everything
    const scan = await call(tools, 'bps_scan_work');

    // Verify all 5 categories present
    expect(scan.failedTasks).toBeDefined();
    expect(scan.openTasks).toBeDefined();
    expect(scan.inProgressTasks).toBeDefined();
    expect(scan.recentlyCompleted).toBeDefined();
    expect(scan.activePlans).toBeDefined();

    // Verify correct categorization
    expect(scan.failedTasks.total).toBeGreaterThanOrEqual(1);
    expect(scan.failedTasks.items.some((t: any) => t.entityId === 'store-scan-3')).toBe(true);

    expect(scan.inProgressTasks.total).toBeGreaterThanOrEqual(1);
    expect(scan.inProgressTasks.items.some((t: any) => t.entityId === 'store-scan-1')).toBe(true);

    expect(scan.recentlyCompleted.total).toBeGreaterThanOrEqual(1);
    expect(scan.recentlyCompleted.items.some((t: any) => t.entityId === 'store-scan-2')).toBe(true);

    expect(scan.activePlans.length).toBeGreaterThanOrEqual(1);
    expect(scan.activePlans.some((p: any) => p.entityId === 'plan-geo-rollout')).toBe(true);
  });

  it('bps_scan_work replaces 5 separate queries — equivalent data', async () => {
    // Create some tasks
    await call(tools, 'bps_create_task', { serviceId: 'svc-data-collect' });
    const t2 = await call(tools, 'bps_create_task', { serviceId: 'svc-content-gen' });
    await call(tools, 'bps_complete_task', { taskId: t2.taskId });

    // Method A: 5 separate queries (old way)
    const failedSeparate = await call(tools, 'bps_query_tasks', { state: 'FAILED' });
    const openSeparate = await call(tools, 'bps_query_tasks', { state: 'OPEN' });
    const inProgressSeparate = await call(tools, 'bps_query_tasks', { state: 'IN_PROGRESS' });
    const completedSeparate = await call(tools, 'bps_query_tasks', { state: 'COMPLETED' });
    const plansSeparate = await call(tools, 'bps_query_entities', { entityType: 'action-plan' });

    // Method B: 1 call (new way)
    const scanResult = await call(tools, 'bps_scan_work');

    // Verify equivalence (total counts match, items may be capped at top-N)
    expect(scanResult.failedTasks.total).toBe(failedSeparate.count);
    expect(scanResult.openTasks.total).toBe(openSeparate.count);
    expect(scanResult.inProgressTasks.total).toBe(inProgressSeparate.count);
    expect(scanResult.recentlyCompleted.total).toBe(Math.min(completedSeparate.count, 10));
    expect(scanResult.activePlans.length).toBe(plansSeparate.count);
  });
});

// ============================================================
// 能力 3：审计痕迹 — reason 字段 + decision log
// ============================================================

describe('Capability 3: Audit Trail — reason field + decision log', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(GEO_ONBOARD_BLUEPRINT, engine.blueprintStore);
    tools = toolMap(engine);
  });

  it('bps_update_task stores reason in metadata snapshot', async () => {
    const task = await call(tools, 'bps_create_task', {
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-audit-001',
    });

    await call(tools, 'bps_update_task', {
      taskId: task.taskId,
      state: 'IN_PROGRESS',
      reason: 'Agent decided to start collection based on daily standup review',
    });

    // Verify reason persisted in snapshot
    const snapshot = engine.processStore.getLatestSnapshot(task.taskId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.contextData._reason).toBe('Agent decided to start collection based on daily standup review');
  });

  it('bps_complete_task stores reason alongside result', async () => {
    const task = await call(tools, 'bps_create_task', {
      serviceId: 'svc-content-gen',
      entityType: 'store',
      entityId: 'store-audit-002',
    });

    await call(tools, 'bps_complete_task', {
      taskId: task.taskId,
      result: { contentScore: 85, platformsPublished: 3 },
      reason: 'Content quality score 85/100, exceeds threshold of 60',
    });

    // Verify both reason and result in snapshot
    const snapshot = engine.processStore.getLatestSnapshot(task.taskId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.contextData._reason).toBe('Content quality score 85/100, exceeds threshold of 60');
    expect(snapshot!.contextData._result).toBeDefined();
  });

  it('reason field provides continuous decision log across task lifecycle', async () => {
    const task = await call(tools, 'bps_create_task', {
      serviceId: 'svc-data-collect',
      entityType: 'store',
      entityId: 'store-audit-003',
    });

    // Update 1: start with reason
    await call(tools, 'bps_update_task', {
      taskId: task.taskId,
      state: 'IN_PROGRESS',
      reason: 'Heartbeat scan: this is the oldest OPEN task, prioritizing',
    });

    const snap1 = engine.processStore.getLatestSnapshot(task.taskId);
    expect(snap1!.contextData._reason).toBe('Heartbeat scan: this is the oldest OPEN task, prioritizing');

    // Update 2: add progress metadata with new reason
    await call(tools, 'bps_update_task', {
      taskId: task.taskId,
      metadata: { progress: '50%', itemsCollected: 3 },
      reason: 'Halfway done — 3 of 6 data fields collected',
    });

    const snap2 = engine.processStore.getLatestSnapshot(task.taskId);
    expect(snap2!.contextData._reason).toBe('Halfway done — 3 of 6 data fields collected');
    expect(snap2!.contextData.progress).toBe('50%');

    // Complete with final reason
    await call(tools, 'bps_complete_task', {
      taskId: task.taskId,
      result: { allFieldsCollected: true },
      reason: 'All 6 data fields collected and validated',
    });

    const snap3 = engine.processStore.getLatestSnapshot(task.taskId);
    expect(snap3!.contextData._reason).toBe('All 6 data fields collected and validated');
    expect(snap3!.contextData._result).toBeDefined();
  });

  it('bps_update_task preserves existing metadata when adding reason', async () => {
    const task = await call(tools, 'bps_create_task', {
      serviceId: 'svc-data-collect',
      metadata: { source: 'cron-heartbeat', priority: 'high' },
    });

    await call(tools, 'bps_update_task', {
      taskId: task.taskId,
      reason: 'Escalated from heartbeat due to SLA breach',
    });

    const snapshot = engine.processStore.getLatestSnapshot(task.taskId);
    // Original metadata preserved
    expect(snapshot!.contextData.source).toBe('cron-heartbeat');
    expect(snapshot!.contextData.priority).toBe('high');
    // Reason added
    expect(snapshot!.contextData._reason).toBe('Escalated from heartbeat due to SLA breach');
  });
});

// ============================================================
// 能力 4：规则评估上下文 — expression + description
// ============================================================

describe('Capability 4: Rule Evaluation Context — expression + description', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(GEO_ONBOARD_BLUEPRINT, engine.blueprintStore);
    tools = toolMap(engine);
  });

  it('deterministic events have expression but no description', async () => {
    const result = await call(tools, 'bps_next_steps', { serviceId: 'svc-data-collect' });
    const step = result.nextSteps[0];

    expect(step.trigger.evaluationMode).toBe('deterministic');
    expect(step.trigger.expression).toBe("state == 'COMPLETED'");
    expect(step.trigger.description).toBeUndefined();
  });

  it('non-deterministic events have description for LLM evaluation', async () => {
    // After publish → check optimization need (non-deterministic)
    const result = await call(tools, 'bps_next_steps', { serviceId: 'svc-publish' });
    const step = result.nextSteps[0];

    expect(step.trigger.evaluationMode).toBe('non_deterministic');
    expect(step.trigger.description).toBe(
      'GEO效果评分低于60分，AI推荐出现率或转化率不达预期，需要启动内容迭代优化'
    );
  });

  it('mixed rules: deterministic + non-deterministic on same service', async () => {
    // svc-content-gen has two rules: deterministic (content done) + non-deterministic (quality concern)
    const result = await call(tools, 'bps_next_steps', { serviceId: 'svc-content-gen' });
    expect(result.nextSteps).toHaveLength(2);

    const deterministic = result.nextSteps.find(
      (s: any) => s.trigger.evaluationMode === 'deterministic',
    );
    const nonDeterministic = result.nextSteps.find(
      (s: any) => s.trigger.evaluationMode === 'non_deterministic',
    );

    // Deterministic: has expression, no description
    expect(deterministic).toBeDefined();
    expect(deterministic.trigger.expression).toBe("state == 'COMPLETED'");
    expect(deterministic.trigger.description).toBeUndefined();

    // Non-deterministic: has description, used for LLM evaluation
    expect(nonDeterministic).toBeDefined();
    expect(nonDeterministic.trigger.description).toBe(
      'AI生成内容可能存在事实错误或不符合品牌调性，需要人工二次审核'
    );
  });

  it('Agent can use description to make non-deterministic decisions', async () => {
    // This simulates what Agent would do:
    // 1. Complete a task
    // 2. Check next steps
    // 3. Read the description of non-deterministic events
    // 4. Decide whether the condition is met

    const task = await call(tools, 'bps_create_task', {
      serviceId: 'svc-publish',
      entityType: 'store',
      entityId: 'store-ctx-001',
    });
    await call(tools, 'bps_complete_task', {
      taskId: task.taskId,
      result: { geoScore: 45, appearanceRate: 0.12 },
      reason: 'Content published to 3 platforms',
    });

    // Agent checks next steps
    const nextSteps = await call(tools, 'bps_next_steps', { serviceId: 'svc-publish' });
    const optimizeRule = nextSteps.nextSteps[0];

    // Agent reads the description and decides: "GEO score 45 < 60, condition met"
    expect(optimizeRule.trigger.description).toContain('GEO效果评分低于60分');
    expect(optimizeRule.action.targetServiceId).toBe('svc-optimize');

    // Agent creates the downstream task based on its decision
    const optimizeTask = await call(tools, 'bps_create_task', {
      serviceId: 'svc-optimize',
      entityType: 'store',
      entityId: 'store-ctx-001',
      metadata: {
        triggeredBy: optimizeRule.ruleId,
        decisionReason: `GEO score 45 < threshold 60, condition "${optimizeRule.trigger.description}" is met`,
      },
    });
    expect(optimizeTask.success).toBe(true);

    // Verify decision is traceable in metadata
    const taskDetail = await call(tools, 'bps_get_task', { taskId: optimizeTask.taskId });
    expect(taskDetail.metadata.triggeredBy).toBe('rule-publish-to-optimize');
    expect(taskDetail.metadata.decisionReason).toContain('GEO score 45 < threshold 60');
  });
});

// ============================================================
// 综合场景：完整 Heartbeat 巡检周期
// ============================================================

describe('Integration: Full Heartbeat Inspection Cycle', () => {
  let engine: BpsEngine;
  let tools: Map<string, OpenClawAgentTool>;

  beforeEach(() => {
    engine = createBpsEngine();
    loadBlueprintFromString(GEO_ONBOARD_BLUEPRINT, engine.blueprintStore);
    tools = toolMap(engine);
  });

  it('simulates a complete heartbeat cycle: scan → triage → execute → flow forward', async () => {
    // --- Setup: simulate state left by previous sessions ---
    // A failed task from yesterday
    const failedTask = await call(tools, 'bps_create_task', {
      serviceId: 'svc-data-collect', entityType: 'store', entityId: 'store-hb-fail',
    });
    await call(tools, 'bps_update_task', { taskId: failedTask.taskId, state: 'IN_PROGRESS' });
    await call(tools, 'bps_update_task', { taskId: failedTask.taskId, state: 'FAILED', reason: 'API timeout during collection' });

    // An in-progress task
    const ipTask = await call(tools, 'bps_create_task', {
      serviceId: 'svc-content-gen', entityType: 'store', entityId: 'store-hb-ip',
    });
    await call(tools, 'bps_update_task', { taskId: ipTask.taskId, state: 'IN_PROGRESS', reason: 'Content generation started' });

    // A completed task with no follow-up yet
    const completedTask = await call(tools, 'bps_create_task', {
      serviceId: 'svc-data-collect', entityType: 'store', entityId: 'store-hb-done',
    });
    await call(tools, 'bps_complete_task', {
      taskId: completedTask.taskId,
      result: { storeName: '星辰KTV', verified: true },
      reason: 'Data collection complete for 星辰KTV',
    });

    // An action plan
    const plan = engine.dossierStore.getOrCreate('action-plan', 'plan-changsha-geo');
    engine.dossierStore.commit(plan.id, {
      status: 'active', type: 'finite',
      periodicItems: [{ id: 'daily-check', cron: '0 9 * * *', label: 'Daily GEO check' }],
    });

    // --- Heartbeat Step 1: Scan work landscape ---
    const scan = await call(tools, 'bps_scan_work');

    expect(scan.failedTasks.total).toBeGreaterThanOrEqual(1);
    expect(scan.inProgressTasks.total).toBeGreaterThanOrEqual(1);
    expect(scan.recentlyCompleted.total).toBeGreaterThanOrEqual(1);
    expect(scan.activePlans.length).toBeGreaterThanOrEqual(1);

    // --- Heartbeat Step 2: Triage failed tasks ---
    const failedInfo = await call(tools, 'bps_get_task', { taskId: failedTask.taskId });
    expect(failedInfo.metadata._reason).toBe('API timeout during collection');

    // Agent decides to retry → create new task with reason
    const retryTask = await call(tools, 'bps_create_task', {
      serviceId: 'svc-data-collect', entityType: 'store', entityId: 'store-hb-fail',
      metadata: { retryOf: failedTask.taskId, retryReason: 'Previous attempt failed due to API timeout' },
    });
    expect(retryTask.success).toBe(true);

    // --- Heartbeat Step 3: Flow forward completed tasks ---
    const nextSteps = await call(tools, 'bps_next_steps', { serviceId: 'svc-data-collect' });
    expect(nextSteps.nextSteps.length).toBeGreaterThanOrEqual(1);

    // Create downstream task
    const downstream = await call(tools, 'bps_create_task', {
      serviceId: nextSteps.nextSteps[0].action.targetServiceId,
      entityType: 'store',
      entityId: 'store-hb-done',
      metadata: { triggeredBy: nextSteps.nextSteps[0].ruleId },
    });
    expect(downstream.success).toBe(true);

    // --- Verify: complete audit trail exists ---
    // Failed task has reason
    const failedSnap = engine.processStore.getLatestSnapshot(failedTask.taskId);
    expect(failedSnap!.contextData._reason).toBe('API timeout during collection');

    // Completed task has reason
    const completedSnap = engine.processStore.getLatestSnapshot(completedTask.taskId);
    expect(completedSnap!.contextData._reason).toBe('Data collection complete for 星辰KTV');

    // Retry task has provenance
    const retryDetail = await call(tools, 'bps_get_task', { taskId: retryTask.taskId });
    expect(retryDetail.metadata.retryOf).toBe(failedTask.taskId);
  });
});

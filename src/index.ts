// ——— Schema exports ———
export * from './schema/common.js';
export * from './schema/entity.js';
export * from './schema/service.js';
export * from './schema/rule.js';
export * from './schema/role.js';
export * from './schema/process.js';
export * from './schema/resource.js';
export * from './schema/dossier.js';

// ——— Engine exports ———
export { ProcessStateMachine, BpsStateError } from './engine/state-machine.js';
export { ProcessTracker, type BpsEngineEvents, type TaskLogEntry } from './engine/process-tracker.js';

// ——— Store exports ———
export { createDatabase, createMemoryDatabase, initBpsDatabase } from './store/db.js';
export { ProcessStore, type CreateProcessInput, type ProcessQueryFilter, type ProcessTreeNode, type TaskLogInput } from './store/process-store.js';
export { BlueprintStore } from './store/blueprint-store.js';
export { DossierStore, type DossierSearchOptions, type DossierSearchResult, type RecentChange } from './store/dossier-store.js';
export { StatsStore, type TimeSeriesPoint, type StatsSnapshot } from './store/stats-store.js';
export { DashboardQueryService, type DashboardOverview, type ProcessKanbanColumn,
         type EntityDetail, type ProcessDetail } from './store/dashboard-query-service.js';
export { SkillMetricsStore, type SkillMetricRecord, type SkillUsageSummary } from './store/skill-metrics-store.js';

// ——— Knowledge exports ———
export { KnowledgeStore } from './knowledge/knowledge-store.js';
export { loadSystemKnowledge, verifySystemKnowledge } from './knowledge/system-knowledge.js';
export * from './knowledge/types.js';

// ——— System exports ———
export { PROJECT_INIT_STEPS, getProjectInitSteps, type ProjectInitStep } from './system/project-init.js';

// ——— Loader exports ———
export { loadBlueprintFromYaml, loadBlueprintFromString, loadBlueprintObject, type LoadResult } from './loader/yaml-loader.js';
export { compileBlueprint, isSimplifiedFormat, type CompileResult, type CompiledBlueprint } from './loader/blueprint-compiler.js';
export { loadProject, loadProjectFromString, type ProjectLoadResult } from './loader/project-loader.js';
export { loadAidaProject, initAidaProject, getDefaultAidaDir,
         AIDA_DIR_NAME, type AidaProjectResult } from './loader/aida-project.js';

// ——— Management ———
export { ManagementStore } from './management/management-store.js';
export { ActionGate } from './management/action-gate.js';
export { loadManagementFile, loadManagementFromString, type ManagementLoadResult } from './management/management-loader.js';
export { GATED_WRITE_TOOLS, DEFAULT_SCOPE_WRITE_TOOLS } from './management/constants.js';
export * from './management/types.js';

// ——— Collaboration ———
export { CollaborationStore } from './collaboration/collaboration-store.js';
export * from './collaboration/types.js';

// ——— Integration (OpenClaw) ———
export * from './integration/index.js';

// ——— MCP Server ———
export { createIdlexMcpServer, startMcpServer } from './mcp/server.js';

// ——— Convenience: create a fully wired engine ———
import { createMemoryDatabase } from './store/db.js';
import { ProcessStore } from './store/process-store.js';
import { BlueprintStore } from './store/blueprint-store.js';
import { DossierStore } from './store/dossier-store.js';
import { StatsStore } from './store/stats-store.js';
import { DashboardQueryService } from './store/dashboard-query-service.js';
import { ProcessTracker } from './engine/process-tracker.js';
import type { DatabaseSync } from 'node:sqlite';
import { KnowledgeStore } from './knowledge/knowledge-store.js';
import { SkillMetricsStore } from './store/skill-metrics-store.js';
import { CollaborationStore } from './collaboration/collaboration-store.js';

export interface BpsEngineConfig {
  db?: DatabaseSync;
}

export interface BpsEngine {
  db: DatabaseSync;
  processStore: ProcessStore;
  blueprintStore: BlueprintStore;
  dossierStore: DossierStore;
  statsStore: StatsStore;
  dashboardQuery: DashboardQueryService;
  tracker: ProcessTracker;
  knowledgeStore: KnowledgeStore;
  skillMetricsStore: SkillMetricsStore;
  collaborationStore: CollaborationStore;
}

/**
 * 一键创建完整的 BPS 引擎实例
 */
export function createBpsEngine(config: BpsEngineConfig = {}): BpsEngine {
  const db = config.db ?? createMemoryDatabase();
  const processStore = new ProcessStore(db);
  const blueprintStore = new BlueprintStore(db);
  const dossierStore = new DossierStore(db);
  const statsStore = new StatsStore(db);
  const dashboardQuery = new DashboardQueryService(processStore, dossierStore, blueprintStore, statsStore);

  // Knowledge subsystem
  const knowledgeStore = new KnowledgeStore(dossierStore);
  const skillMetricsStore = new SkillMetricsStore(db);

  const collaborationStore = new CollaborationStore(db);

  const tracker = new ProcessTracker({
    processStore,
    dossierStore,
  });

  // Event-driven stats collection
  tracker.on('process:created', (e: { serviceId: string }) => {
    statsStore.recordEvent('process.created', { serviceId: e.serviceId });
  });
  tracker.on('process:completed', () => {
    statsStore.recordEvent('process.completed');
  });
  tracker.on('process:error', () => {
    statsStore.recordEvent('process.error');
  });
  tracker.on('dossier:committed', (e: { entityType: string }) => {
    statsStore.recordEvent('dossier.committed', { entityType: e.entityType });
  });

  return { db, processStore, blueprintStore, dossierStore, statsStore, dashboardQuery, tracker, knowledgeStore, skillMetricsStore, collaborationStore };
}

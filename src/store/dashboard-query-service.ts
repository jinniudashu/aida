import type { ProcessStore, ProcessQueryFilter, ProcessTreeNode } from './process-store.js';
import type { DossierStore, RecentChange } from './dossier-store.js';
import type { BlueprintStore } from './blueprint-store.js';
import type { StatsStore } from './stats-store.js';
import type { ProcessDef } from '../schema/process.js';
import type { DossierDef, DossierVersion } from '../schema/dossier.js';

export interface DashboardOverview {
  entities: {
    totalCount: number;
    byType: Record<string, number>;
    byLifecycle: Record<string, number>;
    recentChanges: RecentChange[];
  };
  processes: {
    totalCount: number;
    byState: Record<string, number>;
    activeCount: number;
    errorCount: number;
  };
  services: {
    totalCount: number;
    byExecutorType: Record<string, number>;
  };
}

export interface ProcessKanbanColumn {
  state: string;
  processes: ProcessDef[];
  count: number;
}

export interface EntityDetail {
  dossier: DossierDef;
  data: Record<string, unknown>;
  versions: DossierVersion[];
  relatedProcesses: ProcessDef[];
}

export interface ProcessDetail {
  process: ProcessDef;
  contextSnapshot: unknown | null;
  tree: ProcessTreeNode | null;
}

const TASK_STATES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BLOCKED'];

export class DashboardQueryService {
  constructor(
    private processStore: ProcessStore,
    private dossierStore: DossierStore,
    private blueprintStore: BlueprintStore,
    private statsStore: StatsStore,
  ) {}

  getOverview(): DashboardOverview {
    // Entities
    const allDossiers = this.dossierStore.query();
    const byType: Record<string, number> = {};
    const byLifecycle: Record<string, number> = {};
    for (const d of allDossiers) {
      byType[d.entityType] = (byType[d.entityType] ?? 0) + 1;
      byLifecycle[d.lifecycle] = (byLifecycle[d.lifecycle] ?? 0) + 1;
    }
    const recentChanges = this.dossierStore.getRecentChanges(5);

    // Processes
    const byState = this.processStore.countByState();
    let totalCount = 0;
    for (const c of Object.values(byState)) totalCount += c;
    const activeCount = (byState['OPEN'] ?? 0) + (byState['IN_PROGRESS'] ?? 0) +
      (byState['BLOCKED'] ?? 0);
    const errorCount = byState['FAILED'] ?? 0;

    // Services
    const allServices = this.blueprintStore.listServices();
    const byExecutorType: Record<string, number> = {};
    for (const s of allServices) {
      byExecutorType[s.executorType] = (byExecutorType[s.executorType] ?? 0) + 1;
    }

    return {
      entities: {
        totalCount: allDossiers.length,
        byType,
        byLifecycle,
        recentChanges,
      },
      processes: {
        totalCount,
        byState,
        activeCount,
        errorCount,
      },
      services: {
        totalCount: allServices.length,
        byExecutorType,
      },
    };
  }

  getProcessKanban(filter?: ProcessQueryFilter): ProcessKanbanColumn[] {
    return TASK_STATES.map(state => {
      const processes = this.processStore.query({ ...filter, state });
      return { state, processes, count: processes.length };
    });
  }

  getEntityDetail(erpsysId: string): EntityDetail | null {
    const result = this.dossierStore.getById(erpsysId);
    if (!result) return null;

    const { dossier, data } = result;
    const versions = this.dossierStore.listVersions(dossier.id);
    const relatedProcesses = this.processStore.query({
      entityType: dossier.entityType,
      entityId: dossier.entityId,
    });

    return { dossier, data, versions, relatedProcesses };
  }

  getProcessDetail(processId: string): ProcessDetail | null {
    const process = this.processStore.get(processId);
    if (!process) return null;

    const snapshot = this.processStore.getLatestSnapshot(processId);
    const contextSnapshot = snapshot?.contextData ?? null;

    // Find root by walking parent chain
    let rootId = process.id;
    let current = process;
    const visited = new Set<string>();
    while (current.parentId && current.parentId !== current.id && !visited.has(current.parentId)) {
      visited.add(current.id);
      const parent = this.processStore.get(current.parentId);
      if (!parent) break;
      rootId = parent.id;
      current = parent;
    }

    const tree = this.processStore.getProcessTree(rootId);

    return { process, contextSnapshot, tree };
  }
}

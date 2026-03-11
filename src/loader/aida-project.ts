import { homedir } from 'os';
import path from 'path';
import fs from 'fs';
import { createDatabase } from '../store/db.js';
import { createBpsEngine, type BpsEngine, type BpsEngineConfig } from '../index.js';
import { loadProject, type ProjectLoadResult } from './project-loader.js';
import { loadSystemKnowledge } from '../knowledge/system-knowledge.js';
import { ManagementStore } from '../management/management-store.js';
import { ActionGate } from '../management/action-gate.js';
import { loadManagementFile } from '../management/management-loader.js';

export const AIDA_DIR_NAME = '.aida';

/** 获取默认 ~/.aida/ 路径 */
export function getDefaultAidaDir(): string {
  return path.join(homedir(), AIDA_DIR_NAME);
}

/** 初始化 ~/.aida/ 目录结构（幂等） */
export function initAidaProject(aidaDir?: string): string {
  const dir = aidaDir ?? getDefaultAidaDir();
  const subdirs = ['blueprints', 'data', 'context'];
  for (const sub of subdirs) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

export interface AidaProjectResult {
  engine: BpsEngine;
  project: ProjectLoadResult | null;
  aidaDir: string;
  systemKnowledge: { loaded: number; skipped: number };
  management: {
    constraintCount: number;
    store: ManagementStore;
    gate: ActionGate;
  } | null;
}

/** 一键装载 AIDA 项目：创建引擎 + 加载系统知识 + 加载项目 + 加载治理层 */
export function loadAidaProject(options?: {
  aidaDir?: string;
  engineConfig?: BpsEngineConfig;
}): AidaProjectResult {
  const aidaDir = initAidaProject(options?.aidaDir);
  const dbPath = path.join(aidaDir, 'data', 'bps.db');
  const db = createDatabase(dbPath);

  const engine = createBpsEngine({ db, ...options?.engineConfig });

  // 加载系统知识
  const systemKnowledge = loadSystemKnowledge(engine.knowledgeStore);

  // 尝试加载项目清单
  const projectYamlPath = path.join(aidaDir, 'project.yaml');
  let project: ProjectLoadResult | null = null;
  if (fs.existsSync(projectYamlPath)) {
    project = loadProject(
      projectYamlPath,
      engine.blueprintStore,
      engine.dossierStore,
      { blueprintBasePath: path.join(aidaDir, 'blueprints') },
    );
  }

  // 尝试加载治理层
  let management: AidaProjectResult['management'] = null;
  const managementYamlPath = path.join(aidaDir, 'management.yaml');
  const mgmtStore = new ManagementStore(db);
  const gate = new ActionGate(mgmtStore);
  if (fs.existsSync(managementYamlPath)) {
    const result = loadManagementFile(managementYamlPath);
    if (result.errors.length === 0) {
      const count = mgmtStore.loadConstraints(result.constraints);
      if (result.circuitBreaker) {
        management = {
          constraintCount: count,
          store: mgmtStore,
          gate: new ActionGate(mgmtStore, result.circuitBreaker),
        };
      } else {
        management = { constraintCount: count, store: mgmtStore, gate };
      }
    } else {
      // Management file exists but has errors — still provide store/gate (no constraints loaded)
      management = { constraintCount: 0, store: mgmtStore, gate };
    }
  } else {
    // No management file — still provide store/gate for programmatic use
    management = { constraintCount: 0, store: mgmtStore, gate };
  }

  return { engine, project, aidaDir, systemKnowledge, management };
}

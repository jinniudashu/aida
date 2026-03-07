import { homedir } from 'os';
import path from 'path';
import fs from 'fs';
import { createDatabase } from '../store/db.js';
import { createBpsEngine, type BpsEngine, type BpsEngineConfig } from '../index.js';
import { loadProject, type ProjectLoadResult } from './project-loader.js';
import { loadSystemKnowledge } from '../knowledge/system-knowledge.js';
import { GovernanceStore } from '../governance/governance-store.js';
import { ActionGate } from '../governance/action-gate.js';
import { loadGovernanceFile } from '../governance/governance-loader.js';

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
  governance: {
    constraintCount: number;
    store: GovernanceStore;
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
  let governance: AidaProjectResult['governance'] = null;
  const governanceYamlPath = path.join(aidaDir, 'governance.yaml');
  const govStore = new GovernanceStore(db);
  const gate = new ActionGate(govStore);
  if (fs.existsSync(governanceYamlPath)) {
    const result = loadGovernanceFile(governanceYamlPath);
    if (result.errors.length === 0) {
      const count = govStore.loadConstraints(result.constraints);
      if (result.circuitBreaker) {
        governance = {
          constraintCount: count,
          store: govStore,
          gate: new ActionGate(govStore, result.circuitBreaker),
        };
      } else {
        governance = { constraintCount: count, store: govStore, gate };
      }
    } else {
      // Governance file exists but has errors — still provide store/gate (no constraints loaded)
      governance = { constraintCount: 0, store: govStore, gate };
    }
  } else {
    // No governance file — still provide store/gate for programmatic use
    governance = { constraintCount: 0, store: govStore, gate };
  }

  return { engine, project, aidaDir, systemKnowledge, governance };
}

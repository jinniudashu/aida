import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { BlueprintStore } from '../store/blueprint-store.js';
import { DossierStore } from '../store/dossier-store.js';
import { loadBlueprintFromYaml } from './yaml-loader.js';
import type { DossierLifecycle } from '../schema/dossier.js';
import type { KnowledgeStore } from '../knowledge/knowledge-store.js';
import type { KnowledgeScope } from '../knowledge/types.js';

// ——— YAML interfaces ———

interface ProjectYaml {
  version: string;
  name: string;
  projectId: string;
  blueprints?: string[];
  context?: string[];
  seeds?: SeedReferenceYaml[];
  knowledge?: KnowledgeSeedYaml[];
}

interface SeedReferenceYaml {
  file: string;
  entityType: string;
  source?: 'mock' | 'import' | 'api';
  description?: string;
}

interface KnowledgeSeedYaml {
  file: string;
  description?: string;
}

interface KnowledgeSeedFileYaml {
  entries: Array<{
    scope: KnowledgeScope;
    topic: string;
    data: Record<string, unknown>;
  }>;
}

interface SeedFileYaml {
  entities: SeedEntityYaml[];
}

interface SeedEntityYaml {
  entityId: string;
  lifecycle?: DossierLifecycle;
  data: Record<string, unknown>;
}

// ——— Result interface ———

export interface ProjectLoadResult {
  projectId: string;
  name: string;
  blueprints: { loaded: number; errors: string[]; warnings: string[] };
  seeds: { loaded: number; skipped: number; errors: string[] };
  knowledge: { loaded: number; skipped: number; errors: string[] };
}

// ——— Public API ———

/**
 * 从文件系统加载项目清单，装载蓝图和种子数据
 */
export function loadProject(
  projectPath: string,
  blueprintStore: BlueprintStore,
  dossierStore: DossierStore,
  options?: { blueprintBasePath?: string; knowledgeStore?: KnowledgeStore },
): ProjectLoadResult {
  const content = readFileSync(projectPath, 'utf-8');
  const projectDir = dirname(resolve(projectPath));
  return loadProjectFromString(content, projectDir, blueprintStore, dossierStore, options);
}

/**
 * 从 YAML 字符串加载项目（测试用）
 */
export function loadProjectFromString(
  yamlContent: string,
  projectDir: string,
  blueprintStore: BlueprintStore,
  dossierStore: DossierStore,
  options?: { blueprintBasePath?: string; knowledgeStore?: KnowledgeStore },
): ProjectLoadResult {
  const project = parseYaml(yamlContent) as ProjectYaml;

  const result: ProjectLoadResult = {
    projectId: project.projectId,
    name: project.name,
    blueprints: { loaded: 0, errors: [], warnings: [] },
    seeds: { loaded: 0, skipped: 0, errors: [] },
    knowledge: { loaded: 0, skipped: 0, errors: [] },
  };

  // 1. Load blueprints
  const blueprintBasePath = options?.blueprintBasePath;
  for (const bp of project.blueprints ?? []) {
    try {
      const bpPath = blueprintBasePath ? resolve(blueprintBasePath, bp) : resolve(projectDir, bp);
      const loadResult = loadBlueprintFromYaml(bpPath, blueprintStore);
      result.blueprints.loaded++;
      if (loadResult.warnings.length > 0) {
        result.blueprints.warnings.push(...loadResult.warnings.map(w => `${bp}: ${w}`));
      }
      if (loadResult.errors.length > 0) {
        result.blueprints.errors.push(...loadResult.errors.map(e => `${bp}: ${e}`));
      }
    } catch (e) {
      result.blueprints.errors.push(`Blueprint "${bp}": ${e}`);
    }
  }

  // 2. Load seed data
  for (const seedRef of project.seeds ?? []) {
    try {
      const seedPath = resolve(projectDir, seedRef.file);
      const seedContent = readFileSync(seedPath, 'utf-8');
      const seedFile = parseYaml(seedContent) as SeedFileYaml;

      for (const entity of seedFile.entities ?? []) {
        try {
          const dossier = dossierStore.getOrCreate(seedRef.entityType, entity.entityId);

          // Set lifecycle if explicitly specified and different from default ACTIVE
          if (entity.lifecycle && entity.lifecycle !== 'ACTIVE') {
            dossierStore.transition(dossier.id, entity.lifecycle);
          }

          dossierStore.commit(dossier.id, entity.data, {
            committedBy: `project-loader:${project.projectId}`,
            message: `Seed data from ${seedRef.file}`,
          });
          result.seeds.loaded++;
        } catch (e) {
          result.seeds.errors.push(`Entity "${entity.entityId}" in "${seedRef.file}": ${e}`);
        }
      }
    } catch (e) {
      result.seeds.errors.push(`Seed file "${seedRef.file}": ${e}`);
    }
  }

  // 3. Load knowledge seeds
  const knowledgeStore = options?.knowledgeStore;
  if (knowledgeStore && project.knowledge) {
    for (const knRef of project.knowledge) {
      try {
        const knPath = resolve(projectDir, knRef.file);
        const knContent = readFileSync(knPath, 'utf-8');
        const knFile = parseYaml(knContent) as KnowledgeSeedFileYaml;

        for (const entry of knFile.entries ?? []) {
          try {
            const existing = knowledgeStore.get(entry.scope, entry.topic);
            if (existing) {
              result.knowledge.skipped++;
              continue;
            }
            knowledgeStore.put(entry.scope, entry.topic, entry.data, {
              committedBy: `project-loader:${project.projectId}`,
              message: `Knowledge seed from ${knRef.file}`,
            });
            result.knowledge.loaded++;
          } catch (e) {
            result.knowledge.errors.push(`Knowledge "${entry.topic}" in "${knRef.file}": ${e}`);
          }
        }
      } catch (e) {
        result.knowledge.errors.push(`Knowledge file "${knRef.file}": ${e}`);
      }
    }
  }

  return result;
}

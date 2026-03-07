import type { KnowledgeStore } from './knowledge-store.js';
import { SYSTEM_TOPICS, type KnowledgeScope } from './types.js';

const SYSTEM_KNOWLEDGE: Array<{
  scope: KnowledgeScope;
  topic: string;
  data: Record<string, unknown>;
}> = [
  {
    scope: 'system',
    topic: SYSTEM_TOPICS.PROJECT_CONFIG,
    data: {
      dataDir: '~/.aida/data',
      blueprintDir: '~/.aida/blueprints',
      contextDir: '~/.aida/context',
    },
  },
  {
    scope: 'system',
    topic: SYSTEM_TOPICS.TASK_TRACKING_SOP,
    data: {
      states: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BLOCKED'],
      principle: 'Agent executes business logic directly via Skills/Code. ProcessTracker records task state and audit log.',
    },
  },
];

/**
 * Load system-reserved knowledge entries (idempotent).
 */
export function loadSystemKnowledge(
  knowledgeStore: KnowledgeStore,
): { loaded: number; skipped: number } {
  let loaded = 0;
  let skipped = 0;

  for (const item of SYSTEM_KNOWLEDGE) {
    const existing = knowledgeStore.get(item.scope, item.topic);
    if (existing) {
      skipped++;
      continue;
    }
    knowledgeStore.put(item.scope, item.topic, item.data, {
      committedBy: 'system:init',
      message: `System knowledge: ${item.topic}`,
    });
    loaded++;
  }

  return { loaded, skipped };
}

/**
 * Verify that all system knowledge entries exist.
 */
export function verifySystemKnowledge(knowledgeStore: KnowledgeStore): string[] {
  const missing: string[] = [];
  for (const item of SYSTEM_KNOWLEDGE) {
    const existing = knowledgeStore.get(item.scope, item.topic);
    if (!existing) {
      missing.push(item.topic);
    }
  }
  return missing;
}

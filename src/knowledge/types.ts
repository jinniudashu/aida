export type KnowledgeScope = 'system' | 'project';

export interface KnowledgeEntry {
  scope: KnowledgeScope;
  topic: string;
  dossierId: string;
  version: number;
  data: Record<string, unknown>;
  updatedAt: string;
}

export const SYSTEM_TOPICS = {
  PROJECT_CONFIG: 'project-config',
  TASK_TRACKING_SOP: 'task-tracking-sop',
} as const;

/** Collaboration input mechanism — external collaborator tasks (HITL/AITL) */

export type CollaborationTaskStatus = 'pending' | 'completed' | 'expired' | 'cancelled';
export type CollaborationTaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CollaborationTaskContext {
  entityType?: string;
  entityId?: string;
  processId?: string;
  metadata?: Record<string, unknown>;
}

export interface CollaborationTaskResponse {
  data: Record<string, unknown>;
  respondedBy: string;
  respondedAt: string;
}

export interface CollaborationTask {
  id: string;
  title: string;
  description: string;

  /** Context for display and decision reference */
  context: CollaborationTaskContext;

  /**
   * JSON Schema defining the expected input structure.
   * All collaboration tasks use form-based input — approval, choice, and text
   * are simply forms with different schemas.
   */
  inputSchema: Record<string, unknown>;

  /** Collaborator response (null while pending) */
  response: CollaborationTaskResponse | null;

  status: CollaborationTaskStatus;
  priority: CollaborationTaskPriority;

  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

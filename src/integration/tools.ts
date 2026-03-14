import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from '@sinclair/typebox';
import { stringify as stringifyYaml } from 'yaml';
import { loadBlueprintFromString, type LoadResult } from '../loader/yaml-loader.js';
import { isSimplifiedFormat, compileBlueprint, type CompileResult } from '../loader/blueprint-compiler.js';
import { loadManagementFile, loadManagementFromString } from '../management/management-loader.js';
import { parse as parseYaml } from 'yaml';
import type { ProcessTracker } from '../engine/process-tracker.js';
import type { BlueprintStore } from '../store/blueprint-store.js';
import type { ProcessStore } from '../store/process-store.js';
import type { DossierStore } from '../store/dossier-store.js';
import type { OpenClawAgentTool, OpenClawLogger } from './openclaw-types.js';
import type { ActionGate } from '../management/action-gate.js';
import type { ManagementStore } from '../management/management-store.js';
import type { SkillMetricsStore } from '../store/skill-metrics-store.js';

export interface BpsToolDeps {
  tracker: ProcessTracker;
  blueprintStore: BlueprintStore;
  processStore: ProcessStore;
  dossierStore: DossierStore;
  logger?: OpenClawLogger;
  skillsDir?: string;
  managementGate?: ActionGate;
  managementStore?: ManagementStore;
  skillMetricsStore?: SkillMetricsStore;
}

// ——— 1. bps_list_services ———

const ListServicesInput = Type.Object({
  entityType: Type.Optional(Type.String({ description: 'Filter by entity type' })),
  executorType: Type.Optional(Type.String({ description: 'Filter by executor type: manual|agent|system' })),
  status: Type.Optional(Type.String({ description: 'Filter by status: draft|active|archived' })),
});

function createListServicesTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_list_services',
    description: 'List BPS services (task type catalog), optionally filtered.',
    parameters: ListServicesInput,
    async execute(_callId: string, input: unknown) {
      const params = input as { entityType?: string; executorType?: string; status?: string };
      let services = deps.blueprintStore.listServices({
        entityType: params.entityType,
        status: params.status,
      });
      if (params.executorType) {
        services = services.filter(s => s.executorType === params.executorType);
      }
      const result: Record<string, unknown> = {
        count: services.length,
        services: services.map(s => ({
          id: s.id,
          label: s.label,
          serviceType: s.serviceType,
          executorType: s.executorType,
          entityType: s.entityType,
          status: s.status,
          agentSkills: s.agentSkills,
          agentPrompt: s.agentPrompt,
        })),
      };
      if (services.length === 0) {
        result.hint = 'No services loaded. Use bps_load_blueprint to load a blueprint (simplified format: services[] + flow[] is auto-compiled).';
      }
      return result;
    },
  };
}

// ——— 2. bps_create_task ———

const CreateTaskInput = Type.Object({
  serviceId: Type.String({ description: 'The service ID (task type) to create a task for' }),
  entityType: Type.Optional(Type.String({ description: 'Entity type for the task' })),
  entityId: Type.Optional(Type.String({ description: 'Entity ID for the task' })),
  operatorId: Type.Optional(Type.String({ description: 'Operator ID' })),
  priority: Type.Optional(Type.Integer({ description: 'Task priority (higher = more urgent, default 0)', default: 0 })),
  deadline: Type.Optional(Type.String({ description: 'ISO 8601 deadline for the task (e.g. "2026-03-15T18:00:00Z")' })),
  groupId: Type.Optional(Type.String({ description: 'Group ID for batch operations (e.g. action-plan ID)' })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Initial metadata for the task',
  })),
});

function createCreateTaskTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_create_task',
    description: 'Create a new BPS task record for tracking.',
    parameters: CreateTaskInput,
    async execute(_callId: string, input: unknown) {
      const params = input as {
        serviceId: string;
        entityType?: string;
        entityId?: string;
        operatorId?: string;
        priority?: number;
        deadline?: string;
        groupId?: string;
        metadata?: Record<string, unknown>;
      };

      try {
        // Validate service exists
        const service = deps.blueprintStore.getService(params.serviceId);
        if (!service) {
          return { success: false, error: `Service not found: ${params.serviceId}` };
        }

        const task = deps.tracker.createTask({
          serviceId: params.serviceId,
          entityType: params.entityType,
          entityId: params.entityId,
          operatorId: params.operatorId,
          priority: params.priority,
          deadline: params.deadline,
          groupId: params.groupId,
          metadata: params.metadata,
        });
        return {
          success: true,
          taskId: task.id,
          pid: task.pid,
          state: task.state,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ——— 3. bps_get_task ———

const GetTaskInput = Type.Object({
  taskId: Type.String({ description: 'The task ID to retrieve' }),
});

function createGetTaskTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_get_task',
    description: 'Get a BPS task and its metadata.',
    parameters: GetTaskInput,
    async execute(_callId: string, input: unknown) {
      const { taskId } = input as { taskId: string };
      const result = deps.tracker.getTask(taskId);
      if (!result) {
        return { error: `Task not found: ${taskId}` };
      }
      return {
        process: result.process,
        metadata: result.metadata,
      };
    },
  };
}

// ——— 4. bps_query_tasks ———

const QueryTasksInput = Type.Object({
  state: Type.Optional(Type.String({ description: 'Filter by task state: OPEN|IN_PROGRESS|COMPLETED|FAILED|BLOCKED' })),
  serviceId: Type.Optional(Type.String({ description: 'Filter by service ID' })),
  entityType: Type.Optional(Type.String({ description: 'Filter by entity type' })),
  entityId: Type.Optional(Type.String({ description: 'Filter by entity ID' })),
});

function createQueryTasksTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_query_tasks',
    description: 'Query BPS tasks by state, serviceId, entityType, or entityId.',
    parameters: QueryTasksInput,
    async execute(_callId: string, input: unknown) {
      const params = input as {
        state?: string; serviceId?: string;
        entityType?: string; entityId?: string;
      };

      const tasks = deps.tracker.queryTasks({
        state: params.state ?? ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'FAILED'],
        serviceId: params.serviceId,
        entityType: params.entityType,
        entityId: params.entityId,
      });

      return {
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          pid: t.pid,
          serviceId: t.serviceId,
          state: t.state,
          entityType: t.entityType,
          entityId: t.entityId,
          priority: t.priority,
          deadline: t.deadline,
          groupId: t.groupId,
          createdAt: t.createdAt,
        })),
      };
    },
  };
}

// ——— 5. bps_update_task ———

const UpdateTaskInput = Type.Object({
  taskId: Type.String({ description: 'The task ID to update' }),
  state: Type.Optional(Type.String({ description: 'New state: OPEN|IN_PROGRESS|COMPLETED|FAILED|BLOCKED' })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Metadata to merge into the task',
  })),
  reason: Type.Optional(Type.String({ description: 'Why this update is being made (stored in metadata snapshot)' })),
});

function createUpdateTaskTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_update_task',
    description: 'Update a BPS task state or metadata. Validates state machine transitions.',
    parameters: UpdateTaskInput,
    async execute(_callId: string, input: unknown) {
      const { taskId, state, metadata, reason } = input as {
        taskId: string; state?: string; metadata?: Record<string, unknown>; reason?: string;
      };

      try {
        const mergedMeta = reason
          ? { ...(metadata ?? {}), _reason: reason }
          : metadata;
        const updated = deps.tracker.updateTask(taskId, { state, metadata: mergedMeta });
        return {
          success: true,
          taskId,
          currentState: updated.state,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          taskId,
        };
      }
    },
  };
}

// ——— 6. bps_complete_task ———

const CompleteTaskInput = Type.Object({
  taskId: Type.String({ description: 'The task ID to complete' }),
  result: Type.Optional(Type.Unknown({ description: 'Result / summary of the work done' })),
  outcome: Type.Optional(Type.Union([
    Type.Literal('success'),
    Type.Literal('partial'),
    Type.Literal('failed'),
  ], { description: 'Structured outcome: success (fully done), partial (good enough), failed (gave up). Default: success' })),
  reason: Type.Optional(Type.String({ description: 'Why this task was completed (stored in metadata snapshot)' })),
});

function createCompleteTaskTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_complete_task',
    description: 'Complete a BPS task. Auto-advances through intermediate states.',
    parameters: CompleteTaskInput,
    async execute(_callId: string, input: unknown) {
      const { taskId, result, outcome, reason } = input as {
        taskId: string;
        result?: unknown;
        outcome?: 'success' | 'partial' | 'failed';
        reason?: string;
      };

      const process = deps.processStore.get(taskId);
      if (!process) {
        return { success: false, error: `Task not found: ${taskId}` };
      }

      try {
        // Store outcome + reason in metadata snapshot before completing
        const snapshotData: Record<string, unknown> = {};
        if (reason) snapshotData._reason = reason;
        if (outcome) snapshotData._outcome = outcome;
        if (Object.keys(snapshotData).length > 0) {
          const existing = deps.processStore.getLatestSnapshot(taskId);
          const merged = { ...(existing?.contextData ?? {}), ...snapshotData };
          deps.processStore.saveContextSnapshot(taskId, merged);
        }

        // Include outcome in result if structured result not provided
        const finalResult = result ?? (outcome ? { outcome } : undefined);
        const completed = deps.tracker.completeTask(taskId, finalResult);
        deps.logger?.info('Task completed', { taskId, outcome: outcome ?? 'success', reason });

        // Record skill metrics if serviceId maps to a known skill
        if (deps.skillMetricsStore && deps.skillsDir) {
          const skillDir = path.join(deps.skillsDir, process.serviceId);
          if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
            deps.skillMetricsStore.record(process.serviceId, outcome ?? 'success');
          }
        }

        return { success: true, taskId, finalState: completed.state, outcome: outcome ?? 'success' };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          taskId,
        };
      }
    },
  };
}

// ——— 7. bps_get_entity ———

const GetEntityInput = Type.Object({
  entityType: Type.String({ description: 'Entity type' }),
  entityId: Type.String({ description: 'Entity ID' }),
});

function createGetEntityTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_get_entity',
    description: 'Get an entity dossier by type and ID. Includes relation summaries if relations are declared.',
    parameters: GetEntityInput,
    async execute(_callId: string, input: unknown) {
      const { entityType, entityId } = input as { entityType: string; entityId: string };
      const result = deps.dossierStore.get(entityType, entityId);
      if (!result) {
        return { error: `Entity not found: ${entityType}/${entityId}` };
      }

      // Resolve relations to summaries
      let relatedEntities: Array<{
        targetEntityType: string;
        targetEntityId: string;
        relationType: string;
        updatedAt?: string;
        version?: number;
      }> | undefined;

      if (result.dossier.relations && result.dossier.relations.length > 0) {
        relatedEntities = result.dossier.relations.map(r => {
          const related = deps.dossierStore.get(r.targetEntityType, r.targetEntityId);
          return {
            targetEntityType: r.targetEntityType,
            targetEntityId: r.targetEntityId,
            relationType: r.relationType,
            updatedAt: related?.dossier.updatedAt,
            version: related?.dossier.currentVersion,
          };
        });
      }

      return {
        dossier: result.dossier,
        data: result.data,
        ...(relatedEntities ? { relatedEntities } : {}),
      };
    },
  };
}

// ——— 8. bps_update_entity ———

const UpdateEntityInput = Type.Object({
  entityType: Type.String({ description: 'Entity type' }),
  entityId: Type.String({ description: 'Entity ID' }),
  data: Type.Record(Type.String(), Type.Unknown(), { description: 'Data to merge into the entity' }),
  message: Type.Optional(Type.String({ description: 'Commit message' })),
  relations: Type.Optional(Type.Array(Type.Object({
    targetEntityType: Type.String(),
    targetEntityId: Type.String(),
    relationType: Type.Union([Type.Literal('depends_on'), Type.Literal('part_of'), Type.Literal('references')]),
  }), { description: 'Declarative relations to other entities. Replaces existing relations.' })),
});

function createUpdateEntityTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_update_entity',
    description: 'Update an entity dossier (shallow merge). Creates if not exists. Optionally set relations to other entities.',
    parameters: UpdateEntityInput,
    async execute(_callId: string, input: unknown) {
      const { entityType, entityId, data, message, relations } = input as {
        entityType: string; entityId: string;
        data: Record<string, unknown>; message?: string;
        relations?: Array<{ targetEntityType: string; targetEntityId: string; relationType: string }>;
      };

      const dossier = deps.dossierStore.getOrCreate(entityType, entityId);
      const version = deps.dossierStore.commit(dossier.id, data, { message });

      if (relations) {
        deps.dossierStore.setRelations(dossier.id, relations as any);
      }

      return {
        success: true,
        dossierId: dossier.id,
        version: version.version,
      };
    },
  };
}

// ——— 9. bps_query_entities ———

const QueryEntitiesInput = Type.Object({
  entityType: Type.Optional(Type.String({ description: 'Filter by entity type' })),
  limit: Type.Optional(Type.Integer({ description: 'Max results', default: 50 })),
  brief: Type.Optional(Type.Boolean({ description: 'If true, returns only entityType + entityId + version + updatedAt (no full data). Saves context tokens.', default: false })),
});

function createQueryEntitiesTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_query_entities',
    description: 'Query entity dossiers, optionally filtered by type. Use brief=true to get a compact listing without full data.',
    parameters: QueryEntitiesInput,
    async execute(_callId: string, input: unknown) {
      const { entityType, limit, brief } = input as { entityType?: string; limit?: number; brief?: boolean };
      const results = deps.dossierStore.search({
        entityType,
        lifecycle: 'ACTIVE',
      });
      const limited = results.slice(0, limit ?? 50);
      const isComplete = limited.length >= results.length;
      return {
        count: limited.length,
        totalCount: results.length,
        entities: limited.map(r => brief
          ? {
              entityType: r.dossier.entityType,
              entityId: r.dossier.entityId,
              version: r.dossier.currentVersion,
              updatedAt: r.dossier.updatedAt,
            }
          : {
              dossierId: r.dossier.id,
              entityType: r.dossier.entityType,
              entityId: r.dossier.entityId,
              version: r.dossier.currentVersion,
              data: r.data,
            }
        ),
        _signal: {
          completeness: isComplete ? 'FULL' as const : 'PARTIAL' as const,
          hint: isComplete
            ? 'All matching entities returned. You have complete visibility — proceed to action.'
            : `Showing ${limited.length} of ${results.length}. Use filters to narrow, or proceed with current data if sufficient.`,
        },
      };
    },
  };
}

// ——— 10. bps_next_steps ———

const NextStepsInput = Type.Object({
  serviceId: Type.String({ description: 'The service ID that just completed. Returns downstream services triggered by rules.' }),
  entityType: Type.Optional(Type.String({ description: 'Entity type of the completed task. When provided with entityId, includes currentValues for deterministic rule evaluation.' })),
  entityId: Type.Optional(Type.String({ description: 'Entity ID of the completed task. Used with entityType to look up current entity state.' })),
});

function createNextStepsTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_next_steps',
    description: 'Get recommended next steps after a service completes. Queries blueprint rules to find downstream services. When entityType/entityId are provided, includes currentValues for deterministic trigger evaluation.',
    parameters: NextStepsInput,
    async execute(_callId: string, input: unknown) {
      const { serviceId, entityType, entityId } = input as {
        serviceId: string; entityType?: string; entityId?: string;
      };

      const service = deps.blueprintStore.getService(serviceId);
      if (!service) {
        return { error: `Service not found: ${serviceId}` };
      }

      // Look up entity data for deterministic rule evaluation
      let currentValues: Record<string, unknown> | undefined;
      if (entityType && entityId) {
        const entity = deps.dossierStore.get(entityType, entityId);
        if (entity) {
          currentValues = entity.data;
        }
      }

      const steps = deps.blueprintStore.getNextSteps(serviceId);

      // Build recommendation: pick the first deterministic step with start_service, or first step overall
      let recommendation: string | undefined;
      if (steps.length > 0) {
        const startSteps = steps.filter(s => s.instructionSysCall === 'start_service');
        const deterministicStarts = startSteps.filter(s => s.evaluationMode === 'deterministic');
        const pick = deterministicStarts[0] ?? startSteps[0] ?? steps[0];
        recommendation = `Recommended: ${pick.instructionSysCall} → ${pick.operandServiceLabel || pick.operandServiceId}`;
        if (pick.evaluationMode === 'non_deterministic') {
          recommendation += ' (evaluate trigger condition first)';
        }
      }

      const mappedSteps = steps.map(s => {
        // Determine readyToExecute: deterministic with start_service and currentValues available
        let readyToExecute: boolean | undefined;
        if (s.instructionSysCall === 'start_service' && s.evaluationMode === 'deterministic') {
          readyToExecute = currentValues !== undefined; // values available = ready to trigger
        }
        return {
          ruleId: s.ruleId,
          ruleLabel: s.ruleLabel,
          trigger: {
            eventId: s.eventId,
            eventLabel: s.eventLabel,
            expression: s.eventExpression,
            evaluationMode: s.evaluationMode,
            ...(s.evaluationMode === 'non_deterministic' ? {
              description: s.eventName || s.eventLabel,
            } : {}),
            ...(s.evaluationMode === 'deterministic' && currentValues ? {
              currentValues,
            } : {}),
          },
          action: {
            sysCall: s.instructionSysCall,
            targetServiceId: s.operandServiceId,
            targetServiceLabel: s.operandServiceLabel,
          },
          readyToExecute,
          order: s.order,
        };
      });

      const readyCount = mappedSteps.filter(s => s.readyToExecute === true).length;

      return {
        completedService: { id: service.id, label: service.label },
        nextSteps: mappedSteps,
        recommendation,
        _signal: {
          readySteps: readyCount,
          hint: readyCount > 0
            ? `${readyCount} step(s) ready to execute. Call bps_create_task to start them.`
            : steps.length === 0
              ? 'No downstream rules found. This may be a terminal service.'
              : 'Review trigger conditions before proceeding.',
        },
        hint: steps.length === 0
          ? 'No downstream rules found. This may be a terminal service or rules are not yet defined.'
          : `Found ${steps.length} downstream rule(s). Review triggers and decide which to execute.`,
      };
    },
  };
}

// ——— 11. bps_scan_work ———

/** Map task to scan_work response shape (includes priority + deadline + groupId) */
function taskSummary(t: { id: string; pid: number; serviceId: string; entityType?: string; entityId?: string; priority: number; deadline?: string; groupId?: string; createdAt: string }) {
  return { id: t.id, pid: t.pid, serviceId: t.serviceId, entityType: t.entityType, entityId: t.entityId, priority: t.priority, deadline: t.deadline, groupId: t.groupId, createdAt: t.createdAt };
}

/** Sort tasks: deadline ASC (nulls last), then priority DESC */
function sortByUrgency<T extends { priority: number; deadline?: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    // Deadline ASC (nulls last)
    if (a.deadline && b.deadline) {
      const cmp = a.deadline.localeCompare(b.deadline);
      if (cmp !== 0) return cmp;
    } else if (a.deadline && !b.deadline) return -1;
    else if (!a.deadline && b.deadline) return 1;
    // Priority DESC
    return b.priority - a.priority;
  });
}

/** Truncate an array to top-N and return with total/showing metadata */
function topN<T>(items: T[], n: number): { items: T[]; total: number; showing: number } {
  return { items: items.slice(0, n), total: items.length, showing: Math.min(items.length, n) };
}

const SCAN_WORK_TOP_N = 5;

function createScanWorkTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_scan_work',
    description: 'Scan the full work landscape in one call. Returns overdue, failed, open, in-progress tasks (top-5 each, sorted by deadline/priority), active action-plans, outcome distribution, and a one-line summary. Ideal for heartbeat runs.',
    parameters: Type.Object({}),
    async execute() {
      const nowIso = new Date().toISOString();
      const failedTasks = sortByUrgency(deps.processStore.query({ state: 'FAILED' }));
      const openTasks = sortByUrgency(deps.processStore.query({ state: 'OPEN' }));
      const inProgressTasks = sortByUrgency(deps.processStore.query({ state: 'IN_PROGRESS' }));
      const recentlyCompleted = deps.processStore.query({ state: 'COMPLETED', limit: 10 });
      const activePlans = deps.dossierStore.search({ entityType: 'action-plan', lifecycle: 'ACTIVE' });

      // Overdue: tasks with deadline in the past that are not completed/failed
      const activeTasks = [...openTasks, ...inProgressTasks];
      const overdueTasks = sortByUrgency(activeTasks.filter(t => t.deadline && t.deadline < nowIso));

      // Outcome distribution from recently completed tasks
      const outcomeDistribution: Record<string, number> = { success: 0, partial: 0, failed: 0 };
      for (const t of recentlyCompleted) {
        const snap = deps.processStore.getLatestSnapshot(t.id);
        const outcome = (snap?.contextData?._outcome as string) ?? 'success';
        outcomeDistribution[outcome] = (outcomeDistribution[outcome] ?? 0) + 1;
      }

      // Build one-line summary
      const parts: string[] = [];
      if (overdueTasks.length > 0) parts.push(`${overdueTasks.length} overdue`);
      if (failedTasks.length > 0) parts.push(`${failedTasks.length} failed`);
      parts.push(`${openTasks.length} open`);
      parts.push(`${inProgressTasks.length} in-progress`);
      const summary = parts.join(', ');

      // Suggested actions: concrete tool calls the Agent can execute immediately
      const suggestedActions: Array<{ tool: string; reason: string; params: Record<string, unknown> }> = [];
      for (const t of overdueTasks.slice(0, 3)) {
        suggestedActions.push({
          tool: 'bps_update_task',
          reason: `Task #${t.pid} is overdue (deadline: ${t.deadline})`,
          params: { taskId: t.id, state: 'IN_PROGRESS' },
        });
      }
      for (const t of failedTasks.slice(0, 2)) {
        suggestedActions.push({
          tool: 'bps_create_task',
          reason: `Retry failed task #${t.pid} (${t.serviceId})`,
          params: { serviceId: t.serviceId, entityType: t.entityType, entityId: t.entityId },
        });
      }
      for (const plan of activePlans) {
        const items = (plan.data as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined;
        if (items) {
          const dueItems = items.filter(item =>
            item.status !== 'done' && item.dueDate && (item.dueDate as string) <= nowIso
          );
          if (dueItems.length > 0) {
            suggestedActions.push({
              tool: 'bps_create_task',
              reason: `Action plan "${plan.dossier.entityId}" has ${dueItems.length} due item(s)`,
              params: { serviceId: 'action-plan-item', entityId: plan.dossier.entityId },
            });
          }
        }
      }

      const actionableCount = overdueTasks.length + failedTasks.length + openTasks.length;

      // Dormant skills: skills in workspace with no invocation in 90 days
      let dormantSkills: string[] | undefined;
      if (deps.skillMetricsStore && deps.skillsDir && fs.existsSync(deps.skillsDir)) {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const dormantFromMetrics = new Set(deps.skillMetricsStore.getDormantSkillNames(ninetyDaysAgo));
        const metricsSkills = new Set(deps.skillMetricsStore.getSummaries().map(s => s.skillName));

        // List all skills in the workspace directory
        try {
          const skillDirs = fs.readdirSync(deps.skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && fs.existsSync(path.join(deps.skillsDir!, d.name, 'SKILL.md')))
            .map(d => d.name);
          // Dormant = never invoked OR last invoked > 90 days ago
          dormantSkills = skillDirs.filter(s => !metricsSkills.has(s) || dormantFromMetrics.has(s));
        } catch { /* ignore fs errors */ }
      }

      return {
        summary,
        _signal: {
          actionableItems: actionableCount,
          readiness: actionableCount > 0 ? 'ACTION_NEEDED' as const : 'ALL_CLEAR' as const,
          hint: actionableCount > 0
            ? `${actionableCount} items need action. Start with overdue/failed tasks, then open tasks by priority.`
            : 'No pending work. Check action plans for upcoming items.',
        },
        suggestedActions: suggestedActions.slice(0, 5),
        overdueTasks: topN(overdueTasks.map(taskSummary), SCAN_WORK_TOP_N),
        failedTasks: topN(failedTasks.map(taskSummary), SCAN_WORK_TOP_N),
        openTasks: topN(openTasks.map(taskSummary), SCAN_WORK_TOP_N),
        inProgressTasks: topN(inProgressTasks.map(taskSummary), SCAN_WORK_TOP_N),
        recentlyCompleted: topN(recentlyCompleted.map(taskSummary), SCAN_WORK_TOP_N),
        outcomeDistribution,
        activePlans: activePlans.map(r => ({ dossierId: r.dossier.id, entityId: r.dossier.entityId, data: r.data })),
        ...(dormantSkills && dormantSkills.length > 0 ? { dormantSkills } : {}),
      };
    },
  };
}

// ——— 12. bps_create_skill ———

const CreateSkillInput = Type.Object({
  name: Type.String({ description: 'Skill name in kebab-case (e.g. "weekly-report"). Used as directory name.' }),
  description: Type.String({ description: 'One-line description of what this skill does.' }),
  body: Type.String({ description: 'Markdown body of the SKILL.md file (without frontmatter — added automatically).' }),
});

function createCreateSkillTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_create_skill',
    description: 'Create a new Skill file in the agent workspace. The skill becomes available in future sessions. Use when crystallizing a recognized repetitive pattern into a reusable skill.',
    parameters: CreateSkillInput,
    async execute(_callId: string, input: unknown) {
      const { name, description, body } = input as {
        name: string; description: string; body: string;
      };

      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
        return { success: false, error: 'Skill name must be kebab-case (e.g. "weekly-report").' };
      }

      const skillsDir = deps.skillsDir ?? path.join(os.homedir(), '.openclaw', 'workspace', 'skills');
      const skillDir = path.join(skillsDir, name);
      const skillPath = path.join(skillDir, 'SKILL.md');

      if (fs.existsSync(skillPath)) {
        return { success: false, error: `Skill "${name}" already exists at ${skillPath}.` };
      }

      // Auto-inject management section from active constraints
      let managementSection = '';
      if (deps.managementStore) {
        const constraints = deps.managementStore.listConstraints();
        if (constraints.length > 0) {
          const lines = constraints.map(c =>
            `- **${c.label}** [${c.severity}]: ${c.message} (action: ${c.onViolation})`
          );
          managementSection = [
            '',
            '## Management',
            '',
            'This Skill operates under the following project management constraints.',
            'All write operations (`bps_update_entity`, `bps_create_task`, etc.) are automatically checked.',
            '**Always create/update an entity via `bps_update_entity` before writing output files** — this triggers management review.',
            '',
            ...lines,
          ].join('\n');
        }
      }

      const content = [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        '---',
        body,
        managementSection,
      ].join('\n');

      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillPath, content, 'utf-8');

      deps.logger?.info(`Skill created: ${name}`, { skillPath });

      return { success: true, name, path: skillPath };
    },
  };
}

// ——— 13. bps_load_blueprint ———

const LoadBlueprintInput = Type.Object({
  yaml: Type.String({ description: 'Blueprint YAML content. Simplified format (services + flow) is auto-compiled into full schema. Full format (services + events + instructions + rules) is loaded directly.' }),
  persist: Type.Optional(Type.Boolean({ description: 'Save to ~/.aida/blueprints/ for persistence across restarts. Default: true' })),
});

function createLoadBlueprintTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_load_blueprint',
    description: 'Load a blueprint into the BPS engine. Accepts simplified format (services[] + flow[]) which is auto-compiled, or full format. Returns load results with health status.',
    parameters: LoadBlueprintInput,
    async execute(_callId: string, input: unknown) {
      const { yaml, persist } = input as { yaml: string; persist?: boolean };

      // Load (auto-compiles simplified format internally)
      const loadResult = loadBlueprintFromString(yaml, deps.blueprintStore);

      // Check if it was compiled
      const raw = parseYaml(yaml) as Record<string, unknown>;
      const wasCompiled = isSimplifiedFormat(raw);

      // Determine health
      const health = (loadResult.services > 0 && loadResult.events > 0 && loadResult.rules > 0)
        ? 'complete'
        : (loadResult.services > 0) ? 'partial' : 'empty';

      // Persist to ~/.aida/blueprints/ if requested (default: true)
      let persistedTo: string | undefined;
      if (persist !== false && loadResult.errors.length === 0 && loadResult.services > 0) {
        try {
          const blueprintName = String(raw.name ?? 'blueprint').replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '-').toLowerCase();
          const fileName = `${blueprintName}.yaml`;
          const blueprintDir = path.join(os.homedir(), '.aida', 'blueprints');
          fs.mkdirSync(blueprintDir, { recursive: true });
          const filePath = path.join(blueprintDir, fileName);
          fs.writeFileSync(filePath, yaml, 'utf-8');
          persistedTo = filePath;
        } catch (e) {
          loadResult.warnings.push(`Failed to persist blueprint: ${e}`);
        }
      }

      return {
        success: loadResult.errors.length === 0,
        compiled: wasCompiled,
        health,
        loaded: {
          services: loadResult.services,
          events: loadResult.events,
          instructions: loadResult.instructions,
          rules: loadResult.rules,
        },
        errors: loadResult.errors,
        warnings: loadResult.warnings,
        ...(persistedTo ? { persistedTo } : {}),
        ...(health !== 'complete' ? {
          hint: health === 'partial'
            ? 'Blueprint is partial — services loaded but missing events/instructions/rules. Use simplified format (services + flow) for auto-compilation.'
            : 'Blueprint is empty — no services loaded. Check YAML syntax.',
        } : {}),
      };
    },
  };
}

// ——— 14. bps_management_status ———

function createManagementStatusTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_management_status',
    description: 'Query the current management status: circuit breaker state, recent violations, active constraints, and pending approvals.',
    parameters: Type.Object({}),
    async execute() {
      if (!deps.managementStore) {
        return { error: 'Management layer not configured' };
      }
      const cbState = deps.managementStore.getCircuitBreakerState();
      const violations = deps.managementStore.getRecentViolations(10);
      const constraints = deps.managementStore.listConstraints();
      const pendingApprovals = deps.managementStore.getPendingApprovals();

      return {
        circuitBreakerState: cbState.state,
        lastStateChange: cbState.lastStateChange,
        activeConstraints: constraints.length,
        pendingApprovals: pendingApprovals.length,
        recentViolations: violations.map(v => ({
          constraintId: v.constraintId,
          severity: v.severity,
          tool: v.tool,
          message: v.message,
          createdAt: v.createdAt,
        })),
        constraintEffectiveness: deps.managementStore.getConstraintEffectiveness(),
      };
    },
  };
}

// ——— 15. bps_load_management ———

const LoadManagementInput = Type.Object({
  yaml: Type.Optional(Type.String({ description: 'Management YAML content. Supports both policies[] format and flat constraints[] format. If omitted, reloads from ~/.aida/management.yaml.' })),
});

function createLoadManagementTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_load_management',
    description: 'Load or reload management constraints into the running engine. Accepts YAML content directly or reloads from ~/.aida/management.yaml. Use after writing management.yaml mid-session to activate constraints.',
    parameters: LoadManagementInput,
    async execute(_callId: string, input: unknown) {
      if (!deps.managementStore || !deps.managementGate) {
        return { error: 'Management layer not configured. Cannot load management without ManagementStore and ActionGate.' };
      }

      const { yaml } = input as { yaml?: string };

      // Load from YAML string or from default file path
      const result = yaml
        ? loadManagementFromString(yaml)
        : loadManagementFile(path.join(os.homedir(), '.aida', 'management.yaml'));

      if (result.errors.length > 0) {
        return {
          success: false,
          errors: result.errors,
          hint: 'Check management YAML format. Supports "policies[].constraints[]" or flat "constraints[]" at top level.',
        };
      }

      // Reload constraints into the store (idempotent: clears existing, inserts new)
      const count = deps.managementStore.loadConstraints(result.constraints);

      deps.logger?.info(`Management reloaded: ${count} constraints`, {
        constraints: result.constraints.map(c => c.id),
      });

      return {
        success: true,
        constraintsLoaded: count,
        constraints: result.constraints.map(c => ({
          id: c.id,
          severity: c.severity,
          onViolation: c.onViolation,
          scope: c.scope,
        })),
      };
    },
  };
}

// ——— 16. bps_register_agent ———

const VALID_TOOL_PROFILES = ['minimal', 'coding', 'messaging', 'full'] as const;

const RegisterAgentInput = Type.Object({
  id: Type.String({ description: 'Agent ID in kebab-case (e.g. "store-bot"). Used as directory suffix for workspace.' }),
  name: Type.String({ description: 'Display name (e.g. "小闲").' }),
  theme: Type.String({ description: 'One-line description of the agent.' }),
  emoji: Type.String({ description: 'Single emoji for the agent.' }),
  toolsProfile: Type.Union(
    VALID_TOOL_PROFILES.map(v => Type.Literal(v)),
    { description: 'Tool permission level. Must be one of: minimal, coding, messaging, full.' },
  ),
  toolsAllow: Type.Optional(Type.Array(Type.String(), { description: 'Additional tool allow-list entries (e.g. ["bps"]).' })),
  workspace: Type.Object({
    identity: Type.String({ description: 'Content of IDENTITY.md' }),
    soul: Type.String({ description: 'Content of SOUL.md' }),
    agents: Type.String({ description: 'Content of AGENTS.md' }),
  }, { description: 'Workspace file contents.' }),
});

function createRegisterAgentTool(_deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_register_agent',
    description: 'Create a new OpenClaw agent: writes workspace files and registers the agent in openclaw.json with validated config. Use this instead of manually editing openclaw.json — it validates tools.profile to prevent config corruption.',
    parameters: RegisterAgentInput,
    async execute(_callId: string, input: unknown) {
      const { id, name, theme, emoji, toolsProfile, toolsAllow, workspace } = input as {
        id: string; name: string; theme: string; emoji: string;
        toolsProfile: string; toolsAllow?: string[];
        workspace: { identity: string; soul: string; agents: string };
      };

      // Validate agent ID
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) {
        return { success: false, error: 'Agent ID must be kebab-case (e.g. "store-bot").' };
      }

      // Validate tools.profile (defense in depth — TypeBox schema also validates)
      if (!(VALID_TOOL_PROFILES as readonly string[]).includes(toolsProfile)) {
        return {
          success: false,
          error: `Invalid tools.profile "${toolsProfile}". Must be one of: ${VALID_TOOL_PROFILES.join(', ')}.`,
        };
      }

      const openclawHome = process.env.OPENCLAW_HOME ?? path.join(os.homedir(), '.openclaw');
      const configPath = path.join(openclawHome, 'openclaw.json');

      // Read existing config
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        return { success: false, error: `Cannot read ${configPath}. Is OpenClaw installed?` };
      }

      // Ensure agents.list exists
      if (!config.agents || typeof config.agents !== 'object') {
        (config as any).agents = { list: [] };
      }
      const agentsList: Array<Record<string, unknown>> = (config as any).agents.list ?? [];

      // Check for duplicate ID
      if (agentsList.some(a => a.id === id)) {
        return { success: false, error: `Agent "${id}" already registered in openclaw.json.` };
      }

      // Write workspace files
      const wsDir = path.join(openclawHome, `workspace-${id}`);
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'IDENTITY.md'), workspace.identity, 'utf-8');
      fs.writeFileSync(path.join(wsDir, 'SOUL.md'), workspace.soul, 'utf-8');
      fs.writeFileSync(path.join(wsDir, 'AGENTS.md'), workspace.agents, 'utf-8');

      // Build agent entry
      const agentEntry: Record<string, unknown> = {
        id,
        workspace: `~/.openclaw/workspace-${id}`,
        identity: { name, theme, emoji },
        tools: {
          profile: toolsProfile,
          ...(toolsAllow?.length ? { allow: toolsAllow } : {}),
        },
      };

      // Append and write back
      agentsList.push(agentEntry);
      (config as any).agents.list = agentsList;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

      return {
        success: true,
        agentId: id,
        workspacePath: wsDir,
        configPath,
        registeredAgents: agentsList.length,
      };
    },
  };
}

// ——— Management wrapper ———

/** Wrap a write-operation tool with management checks.
 *
 * BLOCK and REQUIRE_APPROVAL verdicts throw an Error so that the agent
 * framework surfaces them as tool failures — LLMs reliably interpret
 * thrown errors as "the operation did not happen", whereas they often
 * ignore `{success: false}` buried in a JSON return value.
 */
function wrapWithManagement(
  tool: OpenClawAgentTool,
  gate: ActionGate,
): OpenClawAgentTool {
  return {
    ...tool,
    async execute(callId: string, input: unknown) {
      const inputObj = (input ?? {}) as Record<string, unknown>;
      const result = gate.check(tool.name, inputObj);

      if (result.verdict === 'BLOCK') {
        const violations = result.checks.filter(c => !c.passed);
        const details = violations.map(c => `[${c.severity}] ${c.message}`).join('; ');
        throw new Error(
          `MANAGEMENT BLOCKED: ${tool.name} was blocked by management policy. ` +
          `Circuit breaker: ${result.circuitBreakerState}. ` +
          `Violations: ${details}. ` +
          `The operation was NOT executed. Do NOT tell the user it succeeded.`
        );
      }

      if (result.verdict === 'REQUIRE_APPROVAL') {
        const approvalId = gate.createApprovalRequest(tool.name, inputObj, result);
        const constraints = result.checks.filter(c => !c.passed);
        const details = constraints.map(c => `[${c.severity}] ${c.message}`).join('; ');
        throw new Error(
          `MANAGEMENT APPROVAL REQUIRED: ${tool.name} requires human approval before execution. ` +
          `Approval ID: ${approvalId}. ` +
          `Constraints triggered: ${details}. ` +
          `The operation was NOT executed. Tell the user this action needs approval in the Dashboard.`
        );
      }

      // PASS — execute normally
      return tool.execute(callId, input);
    },
  };
}

// ——— 17. bps_batch_update ———

const BatchUpdateInput = Type.Object({
  groupId: Type.String({ description: 'The group ID to batch-update tasks for' }),
  state: Type.Union([
    Type.Literal('OPEN'),
    Type.Literal('IN_PROGRESS'),
    Type.Literal('COMPLETED'),
    Type.Literal('FAILED'),
    Type.Literal('BLOCKED'),
  ], { description: 'Target state for all matching tasks' }),
  filterState: Type.Optional(Type.Union([
    Type.Literal('OPEN'),
    Type.Literal('IN_PROGRESS'),
    Type.Literal('BLOCKED'),
  ], { description: 'Only update tasks currently in this state. Default: all non-terminal tasks (OPEN + IN_PROGRESS + BLOCKED)' })),
  reason: Type.Optional(Type.String({ description: 'Reason for the batch update' })),
});

function createBatchUpdateTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_batch_update',
    description: 'Batch-update all tasks in a group (by groupId). Useful for cancelling or completing all tasks under an action plan.',
    parameters: BatchUpdateInput,
    async execute(_callId: string, input: unknown) {
      const { groupId, state, filterState, reason } = input as {
        groupId: string;
        state: string;
        filterState?: string;
        reason?: string;
      };

      // Find all tasks in the group
      const stateFilter = filterState
        ? [filterState]
        : ['OPEN', 'IN_PROGRESS', 'BLOCKED'];

      const tasks = deps.processStore.query({ groupId, state: stateFilter });

      if (tasks.length === 0) {
        return { success: true, updated: 0, message: `No matching tasks in group "${groupId}"` };
      }

      let updated = 0;
      const errors: Array<{ taskId: string; error: string }> = [];

      for (const task of tasks) {
        try {
          if (state === 'COMPLETED') {
            deps.tracker.completeTask(task.id);
          } else if (state === 'FAILED') {
            deps.tracker.failTask(task.id, reason ?? 'Batch update');
          } else {
            deps.tracker.updateTask(task.id, { state });
          }
          if (reason) {
            const existing = deps.processStore.getLatestSnapshot(task.id);
            deps.processStore.saveContextSnapshot(task.id, {
              ...(existing?.contextData ?? {}),
              _batchReason: reason,
            });
          }
          updated++;
        } catch (err) {
          errors.push({ taskId: task.id, error: err instanceof Error ? err.message : String(err) });
        }
      }

      return {
        success: errors.length === 0,
        updated,
        total: tasks.length,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}

/** Tools that should be wrapped with management */
import { GATED_WRITE_TOOLS } from '../management/constants.js';
const WRITE_TOOLS = new Set<string>(GATED_WRITE_TOOLS);

// ——— Read counter for saturation signal ———

const READ_TOOL_NAMES = new Set([
  'bps_list_services', 'bps_get_task', 'bps_query_tasks',
  'bps_get_entity', 'bps_query_entities', 'bps_next_steps',
  'bps_scan_work', 'bps_management_status',
]);
const CONSECUTIVE_READ_THRESHOLD = 5;

/** Wrap a tool to track consecutive read-only calls and inject _readSignal when threshold exceeded */
function wrapWithReadCounter(
  tool: OpenClawAgentTool,
  counter: { value: number },
): OpenClawAgentTool {
  const isRead = READ_TOOL_NAMES.has(tool.name);
  if (!isRead) {
    // Write tools reset the counter
    const originalExecute = tool.execute.bind(tool);
    return {
      ...tool,
      async execute(callId: string, input: unknown) {
        counter.value = 0;
        return originalExecute(callId, input);
      },
    };
  }

  // Read tools increment counter and inject signal when over threshold
  const originalExecute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(callId: string, input: unknown) {
      const result = await originalExecute(callId, input);
      counter.value++;
      if (counter.value >= CONSECUTIVE_READ_THRESHOLD && typeof result === 'object' && result !== null) {
        (result as Record<string, unknown>)._readSignal = {
          consecutiveReads: counter.value,
          message: `You have made ${counter.value} consecutive read calls without any write action. `
            + `If you have enough information, proceed to execute. `
            + `Describe → bps_update_entity. Plan → bps_create_task. Complete → bps_complete_task.`,
        };
      }
      return result;
    },
  };
}

// ——— 导出：创建所有工具 ———

export function createBpsTools(deps: BpsToolDeps): OpenClawAgentTool[] {
  let tools: OpenClawAgentTool[] = [
    createListServicesTool(deps),
    createCreateTaskTool(deps),
    createGetTaskTool(deps),
    createQueryTasksTool(deps),
    createUpdateTaskTool(deps),
    createCompleteTaskTool(deps),
    createGetEntityTool(deps),
    createUpdateEntityTool(deps),
    createQueryEntitiesTool(deps),
    createNextStepsTool(deps),
    createScanWorkTool(deps),
    createCreateSkillTool(deps),
    createLoadBlueprintTool(deps),
    createRegisterAgentTool(deps),
    createBatchUpdateTool(deps),
  ];

  // Add management tools if management is configured
  if (deps.managementStore) {
    tools.push(createManagementStatusTool(deps));
    tools.push(createLoadManagementTool(deps));
  }

  // Wrap write-operation tools with management if gate is provided
  if (deps.managementGate) {
    tools = tools.map(tool =>
      WRITE_TOOLS.has(tool.name)
        ? wrapWithManagement(tool, deps.managementGate!)
        : tool
    );
  }

  // Wrap ALL tools with read counter for saturation signal
  const readCounter = { value: 0 };
  tools = tools.map(tool => wrapWithReadCounter(tool, readCounter));

  return tools;
}

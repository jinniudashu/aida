import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from '@sinclair/typebox';
import { stringify as stringifyYaml } from 'yaml';
import { loadBlueprintFromString, type LoadResult } from '../loader/yaml-loader.js';
import { isSimplifiedFormat, compileBlueprint, type CompileResult } from '../loader/blueprint-compiler.js';
import { parse as parseYaml } from 'yaml';
import type { ProcessTracker } from '../engine/process-tracker.js';
import type { BlueprintStore } from '../store/blueprint-store.js';
import type { ProcessStore } from '../store/process-store.js';
import type { DossierStore } from '../store/dossier-store.js';
import type { OpenClawAgentTool, OpenClawLogger } from './openclaw-types.js';
import type { ActionGate } from '../governance/action-gate.js';
import type { GovernanceStore } from '../governance/governance-store.js';

export interface BpsToolDeps {
  tracker: ProcessTracker;
  blueprintStore: BlueprintStore;
  processStore: ProcessStore;
  dossierStore: DossierStore;
  logger?: OpenClawLogger;
  skillsDir?: string;
  governanceGate?: ActionGate;
  governanceStore?: GovernanceStore;
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
  reason: Type.Optional(Type.String({ description: 'Why this task was completed (stored in metadata snapshot)' })),
});

function createCompleteTaskTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_complete_task',
    description: 'Complete a BPS task. Auto-advances through intermediate states.',
    parameters: CompleteTaskInput,
    async execute(_callId: string, input: unknown) {
      const { taskId, result, reason } = input as {
        taskId: string;
        result?: unknown;
        reason?: string;
      };

      const process = deps.processStore.get(taskId);
      if (!process) {
        return { success: false, error: `Task not found: ${taskId}` };
      }

      try {
        // Store reason in metadata snapshot before completing
        if (reason) {
          const existing = deps.processStore.getLatestSnapshot(taskId);
          const merged = { ...(existing?.contextData ?? {}), _reason: reason };
          deps.processStore.saveContextSnapshot(taskId, merged);
        }

        const completed = deps.tracker.completeTask(taskId, result);
        deps.logger?.info('Task completed', { taskId, reason });
        return { success: true, taskId, finalState: completed.state };
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
    description: 'Get an entity dossier by type and ID.',
    parameters: GetEntityInput,
    async execute(_callId: string, input: unknown) {
      const { entityType, entityId } = input as { entityType: string; entityId: string };
      const result = deps.dossierStore.get(entityType, entityId);
      if (!result) {
        return { error: `Entity not found: ${entityType}/${entityId}` };
      }
      return {
        dossier: result.dossier,
        data: result.data,
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
});

function createUpdateEntityTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_update_entity',
    description: 'Update an entity dossier (shallow merge). Creates if not exists.',
    parameters: UpdateEntityInput,
    async execute(_callId: string, input: unknown) {
      const { entityType, entityId, data, message } = input as {
        entityType: string; entityId: string;
        data: Record<string, unknown>; message?: string;
      };

      const dossier = deps.dossierStore.getOrCreate(entityType, entityId);
      const version = deps.dossierStore.commit(dossier.id, data, { message });
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
});

function createQueryEntitiesTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_query_entities',
    description: 'Query entity dossiers, optionally filtered by type.',
    parameters: QueryEntitiesInput,
    async execute(_callId: string, input: unknown) {
      const { entityType, limit } = input as { entityType?: string; limit?: number };
      const results = deps.dossierStore.search({
        entityType,
        lifecycle: 'ACTIVE',
      });
      const limited = results.slice(0, limit ?? 50);
      return {
        count: limited.length,
        totalCount: results.length,
        entities: limited.map(r => ({
          dossierId: r.dossier.id,
          entityType: r.dossier.entityType,
          entityId: r.dossier.entityId,
          version: r.dossier.currentVersion,
          data: r.data,
        })),
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

      return {
        completedService: { id: service.id, label: service.label },
        nextSteps: steps.map(s => ({
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
          order: s.order,
        })),
        hint: steps.length === 0
          ? 'No downstream rules found. This may be a terminal service or rules are not yet defined.'
          : `Found ${steps.length} downstream rule(s). Review triggers and decide which to execute.`,
      };
    },
  };
}

// ——— 11. bps_scan_work ———

function createScanWorkTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_scan_work',
    description: 'Scan the full work landscape in one call. Returns failed, open, in-progress tasks, active action-plans, and recently completed tasks. Ideal for heartbeat runs.',
    parameters: Type.Object({}),
    async execute() {
      const failedTasks = deps.processStore.query({ state: 'FAILED' });
      const openTasks = deps.processStore.query({ state: 'OPEN' });
      const inProgressTasks = deps.processStore.query({ state: 'IN_PROGRESS' });
      const recentlyCompleted = deps.processStore.query({ state: 'COMPLETED', limit: 10 });
      const activePlans = deps.dossierStore.search({ entityType: 'action-plan', lifecycle: 'ACTIVE' });

      return {
        failedTasks: failedTasks.map(t => ({ id: t.id, pid: t.pid, serviceId: t.serviceId, entityType: t.entityType, entityId: t.entityId, createdAt: t.createdAt })),
        openTasks: openTasks.map(t => ({ id: t.id, pid: t.pid, serviceId: t.serviceId, entityType: t.entityType, entityId: t.entityId, createdAt: t.createdAt })),
        inProgressTasks: inProgressTasks.map(t => ({ id: t.id, pid: t.pid, serviceId: t.serviceId, entityType: t.entityType, entityId: t.entityId, createdAt: t.createdAt })),
        recentlyCompleted: recentlyCompleted.map(t => ({ id: t.id, pid: t.pid, serviceId: t.serviceId, entityType: t.entityType, entityId: t.entityId, createdAt: t.createdAt })),
        activePlans: activePlans.map(r => ({ dossierId: r.dossier.id, entityId: r.dossier.entityId, data: r.data })),
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

      // Auto-inject governance section from active constraints
      let governanceSection = '';
      if (deps.governanceStore) {
        const constraints = deps.governanceStore.listConstraints();
        if (constraints.length > 0) {
          const lines = constraints.map(c =>
            `- **${c.label}** [${c.severity}]: ${c.message} (action: ${c.onViolation})`
          );
          governanceSection = [
            '',
            '## Governance',
            '',
            'This Skill operates under the following project governance constraints.',
            'All write operations (`bps_update_entity`, `bps_create_task`, etc.) are automatically checked.',
            '**Always create/update an entity via `bps_update_entity` before writing output files** — this triggers governance review.',
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
        governanceSection,
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

// ——— 14. bps_governance_status ———

function createGovernanceStatusTool(deps: BpsToolDeps): OpenClawAgentTool {
  return {
    name: 'bps_governance_status',
    description: 'Query the current governance status: circuit breaker state, recent violations, active constraints, and pending approvals.',
    parameters: Type.Object({}),
    async execute() {
      if (!deps.governanceStore) {
        return { error: 'Governance layer not configured' };
      }
      const cbState = deps.governanceStore.getCircuitBreakerState();
      const violations = deps.governanceStore.getRecentViolations(10);
      const constraints = deps.governanceStore.listConstraints();
      const pendingApprovals = deps.governanceStore.getPendingApprovals();

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
      };
    },
  };
}

// ——— Governance wrapper ———

/** Wrap a write-operation tool with governance checks.
 *
 * BLOCK and REQUIRE_APPROVAL verdicts throw an Error so that the agent
 * framework surfaces them as tool failures — LLMs reliably interpret
 * thrown errors as "the operation did not happen", whereas they often
 * ignore `{success: false}` buried in a JSON return value.
 */
function wrapWithGovernance(
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
          `GOVERNANCE BLOCKED: ${tool.name} was blocked by governance policy. ` +
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
          `GOVERNANCE APPROVAL REQUIRED: ${tool.name} requires human approval before execution. ` +
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

/** Tools that should be wrapped with governance */
const WRITE_TOOLS = new Set([
  'bps_update_entity',
  'bps_create_task',
  'bps_update_task',
  'bps_complete_task',
  'bps_create_skill',
]);

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
  ];

  // Add governance status tool if governance is configured
  if (deps.governanceStore) {
    tools.push(createGovernanceStatusTool(deps));
  }

  // Wrap write-operation tools with governance if gate is provided
  if (deps.governanceGate) {
    tools = tools.map(tool =>
      WRITE_TOOLS.has(tool.name)
        ? wrapWithGovernance(tool, deps.governanceGate!)
        : tool
    );
  }

  return tools;
}

import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'fs';
import { BlueprintStore } from '../store/blueprint-store.js';
import { now } from '../schema/common.js';
import type { ServiceDef } from '../schema/service.js';
import type { EventDef, InstructionDef, ServiceRuleDef } from '../schema/rule.js';

/** YAML 蓝图文件的顶层结构 */
interface BlueprintYaml {
  version: string;
  name: string;
  entities?: EntityYaml[];
  services?: ServiceYaml[];
  events?: EventYaml[];
  instructions?: InstructionYaml[];
  rules?: RuleYaml[];
  roles?: RoleYaml[];
  operators?: OperatorYaml[];
}

interface EntityYaml {
  id: string;
  label: string;
  name?: string;
  fieldType?: string;
  implementType?: string;
  businessType?: string;
  affiliatedTo?: string;
  fields?: Array<{ fieldId: string; order?: number; defaultValue?: unknown }>;
  initContent?: unknown;
}

interface ServiceYaml {
  id: string;
  label: string;
  name?: string;
  serviceType?: string;
  executorType?: string;
  entityType?: string;
  subjectEntity?: string;
  manualStart?: boolean;
  agentSkills?: string[];
  agentPrompt?: string;
  resources?: Array<{ resourceId: string; resourceType: string; quantity?: number }>;
  subServices?: Array<{ serviceId: string; quantity?: number }>;
  price?: number;
}

interface EventYaml {
  id: string;
  label: string;
  name?: string;
  expression?: string;
  evaluationMode?: string;
  isTimer?: boolean;
  timerConfig?: { cron?: string; intervalMs?: number };
}

interface InstructionYaml {
  id: string;
  label: string;
  name?: string;
  sysCall: string;
  parameters?: Record<string, unknown>;
}

interface RuleYaml {
  id: string;
  label: string;
  name?: string;
  targetServiceId: string;
  order?: number;
  serviceId: string;
  eventId: string;
  instructionId: string;
  operandServiceId?: string;
  parameters?: Record<string, unknown>;
}

interface RoleYaml {
  id: string;
  label: string;
  roleType?: string;
  serviceIds?: string[];
}

interface OperatorYaml {
  id: string;
  label: string;
  roleIds?: string[];
  agentId?: string;
}

/**
 * 从 YAML 文件加载业务蓝图到 BlueprintStore
 */
export function loadBlueprintFromYaml(filePath: string, store: BlueprintStore): LoadResult {
  const content = readFileSync(filePath, 'utf-8');
  return loadBlueprintFromString(content, store);
}

export function loadBlueprintFromString(yamlContent: string, store: BlueprintStore): LoadResult {
  const blueprint = parseYaml(yamlContent) as BlueprintYaml;
  const result: LoadResult = { services: 0, events: 0, instructions: 0, rules: 0, errors: [], warnings: [] };
  const timestamp = now();

  // Structural diagnostics — help agents understand what's missing
  if (!blueprint.services?.length) {
    result.warnings.push('No "services" array found. Blueprint must define services[] with id, label, serviceType, executorType.');
  }
  if (blueprint.services?.length && !blueprint.events?.length) {
    result.warnings.push('No "events" array found. Blueprint needs events[] (e.g., evt-new, evt-terminated) for rule wiring.');
  }
  if (blueprint.services?.length && !blueprint.instructions?.length) {
    result.warnings.push('No "instructions" array found. Blueprint needs instructions[] with sysCall (e.g., start_service).');
  }
  if (blueprint.services?.length && !blueprint.rules?.length) {
    result.warnings.push('No "rules" array found. Without rules[], the process engine cannot orchestrate service execution.');
  }

  // Services
  for (const svc of blueprint.services ?? []) {
    try {
      store.upsertService({
        id: svc.id,
        label: svc.label,
        name: svc.name,
        status: 'active',
        serviceType: (svc.serviceType ?? 'atomic') as ServiceDef['serviceType'],
        executorType: (svc.executorType ?? 'manual') as ServiceDef['executorType'],
        entityType: svc.entityType,
        subjectEntity: svc.subjectEntity,
        manualStart: svc.manualStart ?? false,
        resources: (svc.resources ?? []) as ServiceDef['resources'],
        subServices: (svc.subServices ?? []) as ServiceDef['subServices'],
        price: svc.price,
        agentSkills: svc.agentSkills,
        agentPrompt: svc.agentPrompt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      result.services++;
    } catch (e) {
      result.errors.push(`Service "${svc.id}": ${e}`);
    }
  }

  // Events
  for (const evt of blueprint.events ?? []) {
    try {
      store.upsertEvent({
        id: evt.id,
        label: evt.label,
        name: evt.name,
        status: 'active',
        expression: evt.expression,
        evaluationMode: (evt.evaluationMode ?? 'deterministic') as EventDef['evaluationMode'],
        isTimer: evt.isTimer ?? false,
        timerConfig: evt.timerConfig,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      result.events++;
    } catch (e) {
      result.errors.push(`Event "${evt.id}": ${e}`);
    }
  }

  // Instructions
  for (const instr of blueprint.instructions ?? []) {
    try {
      store.upsertInstruction({
        id: instr.id,
        label: instr.label,
        name: instr.name,
        status: 'active',
        sysCall: instr.sysCall as InstructionDef['sysCall'],
        parameters: instr.parameters,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      result.instructions++;
    } catch (e) {
      result.errors.push(`Instruction "${instr.id}": ${e}`);
    }
  }

  // Rules
  for (const rule of blueprint.rules ?? []) {
    try {
      store.upsertServiceRule({
        id: rule.id,
        label: rule.label,
        name: rule.name,
        status: 'active',
        targetServiceId: rule.targetServiceId,
        order: rule.order ?? 0,
        serviceId: rule.serviceId,
        eventId: rule.eventId,
        instructionId: rule.instructionId,
        operandServiceId: rule.operandServiceId,
        parameters: rule.parameters,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      result.rules++;
    } catch (e) {
      result.errors.push(`Rule "${rule.id}": ${e}`);
    }
  }

  return result;
}

export interface LoadResult {
  services: number;
  events: number;
  instructions: number;
  rules: number;
  errors: string[];
  warnings: string[];
}

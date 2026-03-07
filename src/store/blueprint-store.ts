import type { DatabaseSync } from 'node:sqlite';
import { now } from '../schema/common.js';
import type { ServiceDef } from '../schema/service.js';
import type { EventDef, InstructionDef, ServiceRuleDef } from '../schema/rule.js';

/** Rule + Event pair for Dashboard topology visualization */
export interface RuleWithEvent {
  rule: ServiceRuleDef;
  event: EventDef;
}

/**
 * 业务蓝图存储：Entity / Service / Event / Instruction / ServiceRule / Role / Operator
 * 统一管理所有设计态数据的 CRUD
 */
export class BlueprintStore {
  constructor(private db: DatabaseSync) {}

  // ——— Service ———

  upsertService(svc: ServiceDef): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO bps_services
        (id, label, name, status, service_type, executor_type, entity_type,
         subject_entity, manual_start, resources, sub_services, route_to,
         price, agent_skills, agent_prompt, metadata, created_at, updated_at)
      VALUES
        (@id, @label, @name, @status, @serviceType, @executorType, @entityType,
         @subjectEntity, @manualStart, @resources, @subServices, @routeTo,
         @price, @agentSkills, @agentPrompt, @metadata, @createdAt, @updatedAt)
    `).run({
      id: svc.id,
      label: svc.label,
      name: svc.name ?? null,
      status: svc.status,
      serviceType: svc.serviceType,
      executorType: svc.executorType,
      entityType: svc.entityType ?? null,
      subjectEntity: svc.subjectEntity ?? null,
      manualStart: svc.manualStart ? 1 : 0,
      resources: JSON.stringify(svc.resources),
      subServices: JSON.stringify(svc.subServices),
      routeTo: svc.routeTo ?? null,
      price: svc.price ?? null,
      agentSkills: svc.agentSkills ? JSON.stringify(svc.agentSkills) : null,
      agentPrompt: svc.agentPrompt ?? null,
      metadata: svc.metadata ? JSON.stringify(svc.metadata) : null,
      createdAt: svc.createdAt,
      updatedAt: svc.updatedAt,
    });
  }

  getService(id: string): ServiceDef | null {
    const row = this.db.prepare(`SELECT * FROM bps_services WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? this.rowToService(row) : null;
  }

  listServices(filter?: { entityType?: string; status?: string }): ServiceDef[] {
    let sql = `SELECT * FROM bps_services WHERE 1=1`;
    const params: string[] = [];
    if (filter?.entityType) { sql += ` AND entity_type = ?`; params.push(filter.entityType); }
    if (filter?.status) { sql += ` AND status = ?`; params.push(filter.status); }
    sql += ` ORDER BY label`;
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[])
      .map(r => this.rowToService(r));
  }

  // ——— Event ———

  upsertEvent(evt: EventDef): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO bps_events
        (id, label, name, status, expression, evaluation_mode, is_timer,
         timer_config, parameters, metadata, created_at, updated_at)
      VALUES
        (@id, @label, @name, @status, @expression, @evaluationMode, @isTimer,
         @timerConfig, @parameters, @metadata, @createdAt, @updatedAt)
    `).run({
      id: evt.id,
      label: evt.label,
      name: evt.name ?? null,
      status: evt.status,
      expression: evt.expression ?? null,
      evaluationMode: evt.evaluationMode,
      isTimer: evt.isTimer ? 1 : 0,
      timerConfig: evt.timerConfig ? JSON.stringify(evt.timerConfig) : null,
      parameters: evt.parameters ? JSON.stringify(evt.parameters) : null,
      metadata: evt.metadata ? JSON.stringify(evt.metadata) : null,
      createdAt: evt.createdAt,
      updatedAt: evt.updatedAt,
    });
  }

  getEvent(id: string): EventDef | null {
    const row = this.db.prepare(`SELECT * FROM bps_events WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      label: row.label as string,
      name: row.name as string | undefined,
      status: row.status as EventDef['status'],
      expression: row.expression as string | undefined,
      evaluationMode: row.evaluation_mode as EventDef['evaluationMode'],
      isTimer: Boolean(row.is_timer),
      timerConfig: row.timer_config ? JSON.parse(row.timer_config as string) : undefined,
      parameters: row.parameters ? JSON.parse(row.parameters as string) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ——— Instruction ———

  upsertInstruction(instr: InstructionDef): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO bps_instructions
        (id, label, name, status, sys_call, parameters, metadata, created_at, updated_at)
      VALUES
        (@id, @label, @name, @status, @sysCall, @parameters, @metadata, @createdAt, @updatedAt)
    `).run({
      id: instr.id,
      label: instr.label,
      name: instr.name ?? null,
      status: instr.status,
      sysCall: instr.sysCall,
      parameters: instr.parameters ? JSON.stringify(instr.parameters) : null,
      metadata: instr.metadata ? JSON.stringify(instr.metadata) : null,
      createdAt: instr.createdAt,
      updatedAt: instr.updatedAt,
    });
  }

  getInstruction(id: string): InstructionDef | null {
    const row = this.db.prepare(`SELECT * FROM bps_instructions WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      label: row.label as string,
      name: row.name as string | undefined,
      status: row.status as InstructionDef['status'],
      sysCall: row.sys_call as InstructionDef['sysCall'],
      parameters: row.parameters ? JSON.parse(row.parameters as string) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ——— ServiceRule ———

  getServiceRule(id: string): ServiceRuleDef | null {
    const row = this.db.prepare(`SELECT * FROM bps_service_rules WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      label: row.label as string,
      name: row.name as string | undefined,
      status: row.status as ServiceRuleDef['status'],
      targetServiceId: row.target_service_id as string,
      order: row.order as number,
      serviceId: row.service_id as string,
      eventId: row.event_id as string,
      instructionId: row.instruction_id as string,
      operandServiceId: row.operand_service_id as string | undefined,
      parameters: row.parameters ? JSON.parse(row.parameters as string) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  upsertServiceRule(rule: ServiceRuleDef): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO bps_service_rules
        (id, label, name, status, target_service_id, "order", service_id,
         event_id, instruction_id, operand_service_id, parameters, metadata,
         created_at, updated_at)
      VALUES
        (@id, @label, @name, @status, @targetServiceId, @order, @serviceId,
         @eventId, @instructionId, @operandServiceId, @parameters, @metadata,
         @createdAt, @updatedAt)
    `).run({
      id: rule.id,
      label: rule.label,
      name: rule.name ?? null,
      status: rule.status,
      targetServiceId: rule.targetServiceId,
      order: rule.order,
      serviceId: rule.serviceId,
      eventId: rule.eventId,
      instructionId: rule.instructionId,
      operandServiceId: rule.operandServiceId ?? null,
      parameters: rule.parameters ? JSON.stringify(rule.parameters) : null,
      metadata: rule.metadata ? JSON.stringify(rule.metadata) : null,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    });
  }

  /**
   * 查询当某个 service 完成时应该触发的下游 service（供 next-step advisor 使用）
   * 查找所有 rules where service_id = completedServiceId，返回 operandServiceId + 关联事件
   */
  getNextSteps(completedServiceId: string): Array<{
    ruleId: string;
    ruleLabel: string;
    eventId: string;
    eventLabel: string;
    eventExpression?: string;
    evaluationMode: string;
    eventName?: string;
    eventParameters?: Record<string, unknown>;
    operandServiceId?: string;
    operandServiceLabel?: string;
    instructionSysCall: string;
    order: number;
  }> {
    const rows = this.db.prepare(`
      SELECT r.id as rule_id, r.label as rule_label, r."order",
             r.operand_service_id, r.instruction_id,
             e.id as event_id, e.label as event_label,
             e.name as event_name, e.expression, e.evaluation_mode,
             e.parameters as event_parameters,
             i.sys_call,
             os.label as operand_label
      FROM bps_service_rules r
      JOIN bps_events e ON r.event_id = e.id
      JOIN bps_instructions i ON r.instruction_id = i.id
      LEFT JOIN bps_services os ON r.operand_service_id = os.id
      WHERE r.service_id = ? AND r.status = 'active'
      ORDER BY r."order" ASC
    `).all(completedServiceId) as Record<string, unknown>[];

    return rows.map(row => ({
      ruleId: row.rule_id as string,
      ruleLabel: row.rule_label as string,
      eventId: row.event_id as string,
      eventLabel: row.event_label as string,
      eventExpression: row.expression as string | undefined,
      evaluationMode: row.evaluation_mode as string,
      eventName: row.event_name as string | undefined,
      eventParameters: row.event_parameters ? JSON.parse(row.event_parameters as string) : undefined,
      operandServiceId: row.operand_service_id as string | undefined,
      operandServiceLabel: row.operand_label as string | undefined,
      instructionSysCall: row.sys_call as string,
      order: row.order as number,
    }));
  }

  /**
   * 获取服务关联的规则+事件对（供 Dashboard 拓扑图使用）
   * 对应 Django: ServiceRule.objects.filter(target_service=sp, service=process.service)
   */
  getRulesForProcess(programEntrypoint: string, serviceId: string): RuleWithEvent[] {
    const rows = this.db.prepare(`
      SELECT r.*, e.label as event_label, e.expression, e.evaluation_mode,
             e.is_timer, e.timer_config, e.parameters as event_params,
             e.status as event_status, e.name as event_name,
             e.created_at as event_created_at, e.updated_at as event_updated_at,
             e.metadata as event_metadata
      FROM bps_service_rules r
      JOIN bps_events e ON r.event_id = e.id
      WHERE r.target_service_id = ? AND r.service_id = ? AND r.status = 'active'
      ORDER BY r."order" ASC
    `).all(programEntrypoint, serviceId) as Record<string, unknown>[];

    return rows.map(row => ({
      rule: {
        id: row.id as string,
        label: row.label as string,
        name: row.name as string | undefined,
        status: row.status as ServiceRuleDef['status'],
        targetServiceId: row.target_service_id as string,
        order: row.order as number,
        serviceId: row.service_id as string,
        eventId: row.event_id as string,
        instructionId: row.instruction_id as string,
        operandServiceId: row.operand_service_id as string | undefined,
        parameters: row.parameters ? JSON.parse(row.parameters as string) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      },
      event: {
        id: row.event_id as string,
        label: row.event_label as string,
        name: row.event_name as string | undefined,
        status: row.event_status as EventDef['status'],
        expression: row.expression as string | undefined,
        evaluationMode: row.evaluation_mode as EventDef['evaluationMode'],
        isTimer: Boolean(row.is_timer),
        timerConfig: row.timer_config ? JSON.parse(row.timer_config as string) : undefined,
        parameters: row.event_params ? JSON.parse(row.event_params as string) : undefined,
        metadata: row.event_metadata ? JSON.parse(row.event_metadata as string) : undefined,
        createdAt: row.event_created_at as string,
        updatedAt: row.event_updated_at as string,
      },
    }));
  }

  private rowToService(row: Record<string, unknown>): ServiceDef {
    return {
      id: row.id as string,
      label: row.label as string,
      name: row.name as string | undefined,
      status: row.status as ServiceDef['status'],
      serviceType: row.service_type as ServiceDef['serviceType'],
      executorType: row.executor_type as ServiceDef['executorType'],
      entityType: row.entity_type as string | undefined,
      subjectEntity: row.subject_entity as string | undefined,
      manualStart: Boolean(row.manual_start),
      resources: JSON.parse((row.resources as string) || '[]'),
      subServices: JSON.parse((row.sub_services as string) || '[]'),
      routeTo: row.route_to as string | undefined,
      price: row.price as number | undefined,
      agentSkills: row.agent_skills ? JSON.parse(row.agent_skills as string) : undefined,
      agentPrompt: row.agent_prompt as string | undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

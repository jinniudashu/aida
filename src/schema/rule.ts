import { Type, type Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common.js';

export const EvaluationMode = Type.Union([
  Type.Literal('deterministic'),
  Type.Literal('non_deterministic'),
]);
export type EvaluationMode = Static<typeof EvaluationMode>;

export const EventDef = Type.Composite([
  BpsBase,
  Type.Object({
    expression: Type.Optional(Type.String()),
    evaluationMode: EvaluationMode,
    isTimer: Type.Boolean({ default: false }),
    timerConfig: Type.Optional(Type.Object({
      cron: Type.Optional(Type.String()),
      intervalMs: Type.Optional(Type.Integer()),
    })),
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
]);
export type EventDef = Static<typeof EventDef>;

export const SysCallName = Type.Union([
  Type.Literal('start_service'),
  Type.Literal('call_sub_service'),
  Type.Literal('calling_return'),
  Type.Literal('start_iteration_service'),
  Type.Literal('start_parallel_service'),
  Type.Literal('retry_process'),
  Type.Literal('terminate_process'),
  Type.Literal('escalate_process'),
  Type.Literal('rollback_process'),
]);
export type SysCallName = Static<typeof SysCallName>;

export const InstructionDef = Type.Composite([
  BpsBase,
  Type.Object({
    sysCall: SysCallName,
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
]);
export type InstructionDef = Static<typeof InstructionDef>;

export const ServiceRuleDef = Type.Composite([
  BpsBase,
  Type.Object({
    targetServiceId: BpsId,
    order: Type.Integer({ default: 0 }),
    serviceId: BpsId,
    eventId: BpsId,
    instructionId: BpsId,
    operandServiceId: Type.Optional(BpsId),
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
]);
export type ServiceRuleDef = Static<typeof ServiceRuleDef>;

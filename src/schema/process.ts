import { Type, type Static } from '@sinclair/typebox';
import { BpsId } from './common.js';

export const TaskState = Type.Union([
  Type.Literal('OPEN'),
  Type.Literal('IN_PROGRESS'),
  Type.Literal('COMPLETED'),
  Type.Literal('FAILED'),
  Type.Literal('BLOCKED'),
]);
export type TaskState = Static<typeof TaskState>;

/** 合法状态迁移表 */
export const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  OPEN:        ['IN_PROGRESS', 'BLOCKED', 'FAILED'],
  IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'FAILED'],
  BLOCKED:     ['OPEN', 'IN_PROGRESS', 'FAILED'],
  COMPLETED:   [],
  FAILED:      ['OPEN'],
};

// Legacy alias for backward compatibility with ProcessStore/Dashboard
export type ProcessState = TaskState;
export const ProcessState = TaskState;

export const ProcessDef = Type.Object({
  id: BpsId,
  pid: Type.Integer(),
  name: Type.Optional(Type.String()),
  parentId: Type.Optional(BpsId),
  previousId: Type.Optional(BpsId),
  serviceId: BpsId,
  state: TaskState,
  priority: Type.Integer({ default: 0 }),
  entityType: Type.Optional(Type.String()),
  entityId: Type.Optional(Type.String()),
  operatorId: Type.Optional(BpsId),
  creatorId: Type.Optional(BpsId),
  programEntrypoint: Type.Optional(BpsId),
  scheduledTime: Type.Optional(Type.String()),
  startTime: Type.Optional(Type.String()),
  endTime: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  agentSessionKey: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
  result: Type.Optional(Type.Unknown()),
});
export type ProcessDef = Static<typeof ProcessDef>;

export const ProcessContextSnapshot = Type.Object({
  id: BpsId,
  processId: BpsId,
  version: Type.Integer({ minimum: 1 }),
  contextData: Type.Record(Type.String(), Type.Unknown()),
  contextHash: Type.String(),
  createdAt: Type.String(),
});
export type ProcessContextSnapshot = Static<typeof ProcessContextSnapshot>;

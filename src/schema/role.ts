import { Type, type Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common.js';

export const RoleType = Type.Union([
  Type.Literal('user_defined'),
  Type.Literal('agent'),
  Type.Literal('system'),
]);
export type RoleType = Static<typeof RoleType>;

export const RoleDef = Type.Composite([
  BpsBase,
  Type.Object({
    roleType: RoleType,
    serviceIds: Type.Array(BpsId, { default: [] }),
  }),
]);
export type RoleDef = Static<typeof RoleDef>;

export const OperatorDef = Type.Composite([
  BpsBase,
  Type.Object({
    active: Type.Boolean({ default: true }),
    roleIds: Type.Array(BpsId, { default: [] }),
    organizationId: Type.Optional(BpsId),
    agentSessionKey: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
  }),
]);
export type OperatorDef = Static<typeof OperatorDef>;

import { Type, type Static } from '@sinclair/typebox';
import { BpsId } from './common.js';

export const DossierLifecycle = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('ACTIVE'),
  Type.Literal('ARCHIVED'),
]);
export type DossierLifecycle = Static<typeof DossierLifecycle>;

/**
 * 实体档案定义
 * id 即 erpsysId —— 业务空间全局唯一标识，可跨 entityType 一步定位
 */
export const DossierDef = Type.Object({
  id: BpsId,
  entityType: Type.String(),
  entityId: Type.String(),
  lifecycle: DossierLifecycle,
  currentVersion: Type.Integer({ minimum: 0 }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type DossierDef = Static<typeof DossierDef>;

export const DossierVersion = Type.Object({
  id: BpsId,
  dossierId: BpsId,
  version: Type.Integer({ minimum: 1 }),
  data: Type.Record(Type.String(), Type.Unknown()),
  patch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  committedBy: Type.Optional(Type.String()),
  commitMessage: Type.Optional(Type.String()),
  createdAt: Type.String(),
});
export type DossierVersion = Static<typeof DossierVersion>;

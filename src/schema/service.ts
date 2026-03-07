import { Type, type Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common.js';

export const ServiceType = Type.Union([
  Type.Literal('atomic'),
  Type.Literal('composite'),
]);
export type ServiceType = Static<typeof ServiceType>;

export const ExecutorType = Type.Union([
  Type.Literal('manual'),
  Type.Literal('agent'),
  Type.Literal('system'),
]);
export type ExecutorType = Static<typeof ExecutorType>;

export const ResourceRequirement = Type.Object({
  resourceId: BpsId,
  resourceType: Type.Union([
    Type.Literal('material'),
    Type.Literal('equipment'),
    Type.Literal('device'),
    Type.Literal('capital'),
    Type.Literal('knowledge'),
  ]),
  quantity: Type.Integer({ minimum: 1, default: 1 }),
});
export type ResourceRequirement = Static<typeof ResourceRequirement>;

export const ServiceDef = Type.Composite([
  BpsBase,
  Type.Object({
    serviceType: ServiceType,
    executorType: ExecutorType,
    entityType: Type.Optional(Type.String()),
    subjectEntity: Type.Optional(BpsId),
    manualStart: Type.Boolean({ default: false }),
    resources: Type.Array(ResourceRequirement, { default: [] }),
    subServices: Type.Array(Type.Object({
      serviceId: BpsId,
      quantity: Type.Integer({ default: 1 }),
    }), { default: [] }),
    routeTo: Type.Optional(BpsId),
    price: Type.Optional(Type.Number()),
    agentSkills: Type.Optional(Type.Array(Type.String())),
    agentPrompt: Type.Optional(Type.String()),
  }),
]);
export type ServiceDef = Static<typeof ServiceDef>;

import { Type, type Static } from '@sinclair/typebox';
import { BpsBase } from './common.js';

export const ResourceType = Type.Union([
  Type.Literal('material'),
  Type.Literal('equipment'),
  Type.Literal('device'),
  Type.Literal('capital'),
  Type.Literal('knowledge'),
]);
export type ResourceType = Static<typeof ResourceType>;

export const ResourceDef = Type.Composite([
  BpsBase,
  Type.Object({
    resourceType: ResourceType,
    capacity: Type.Integer({ minimum: 1, default: 1 }),
    content: Type.Optional(Type.String()),
  }),
]);
export type ResourceDef = Static<typeof ResourceDef>;

import { Type, type Static } from '@sinclair/typebox';
import { BpsBase, BpsId } from './common.js';

export const FieldType = Type.Union([
  Type.Literal('string'),
  Type.Literal('text'),
  Type.Literal('integer'),
  Type.Literal('decimal'),
  Type.Literal('boolean'),
  Type.Literal('datetime'),
  Type.Literal('date'),
  Type.Literal('time'),
  Type.Literal('json'),
  Type.Literal('file'),
  Type.Literal('reference'),
  Type.Literal('computed'),
]);
export type FieldType = Static<typeof FieldType>;

export const ImplementType = Type.Union([
  Type.Literal('field'),
  Type.Literal('enum'),
  Type.Literal('data_table'),
  Type.Literal('system_table'),
  Type.Literal('log'),
  Type.Literal('view'),
  Type.Literal('ui_component'),
]);
export type ImplementType = Static<typeof ImplementType>;

export const EntityField = Type.Object({
  fieldId: BpsId,
  order: Type.Integer({ minimum: 0, default: 10 }),
  defaultValue: Type.Optional(Type.Unknown()),
});
export type EntityField = Static<typeof EntityField>;

export const EntityDef = Type.Composite([
  BpsBase,
  Type.Object({
    fieldType: FieldType,
    implementType: ImplementType,
    businessType: Type.Optional(BpsId),
    affiliatedTo: Type.Optional(BpsId),
    fields: Type.Array(EntityField, { default: [] }),
    isMultivalued: Type.Boolean({ default: false }),
    dependencyOrder: Type.Integer({ default: 0 }),
    computedLogic: Type.Optional(Type.String()),
    initContent: Type.Optional(Type.Unknown()),
  }),
]);
export type EntityDef = Static<typeof EntityDef>;

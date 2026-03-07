import { Type, type Static } from '@sinclair/typebox';

/** BPS 全局唯一标识 */
export const BpsId = Type.String({ minLength: 1 });
export type BpsId = Static<typeof BpsId>;

/** 对象生命周期状态（替代 Design/Kernel 双轨制） */
export const LifecycleStatus = Type.Union([
  Type.Literal('draft'),
  Type.Literal('active'),
  Type.Literal('archived'),
]);
export type LifecycleStatus = Static<typeof LifecycleStatus>;

/** 所有 BPS 对象的基础字段（对应 Django ERPSysBase） */
export const BpsBase = Type.Object({
  id: BpsId,
  label: Type.String(),
  name: Type.Optional(Type.String()),
  status: LifecycleStatus,
  createdAt: Type.String(),
  updatedAt: Type.String(),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type BpsBase = Static<typeof BpsBase>;

/** 时间戳工具 */
export function now(): string {
  return new Date().toISOString();
}

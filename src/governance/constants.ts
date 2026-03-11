/**
 * Single source of truth for BPS write-operation tool names.
 * Used by action-gate.ts, tools.ts, and governance-loader.ts.
 */

/** All BPS tools that perform write operations and are subject to governance gating. */
export const GATED_WRITE_TOOLS = [
  'bps_update_entity',
  'bps_create_task',
  'bps_update_task',
  'bps_complete_task',
  'bps_create_skill',
  'bps_load_blueprint',
  'bps_register_agent',
  'bps_load_governance',
  'bps_batch_update',
] as const;

/**
 * Default scope.tools for flat-format governance constraints that omit scope.tools.
 * Excludes bps_load_governance — meta-governance should be explicitly scoped.
 */
export const DEFAULT_SCOPE_WRITE_TOOLS = GATED_WRITE_TOOLS.filter(
  t => t !== 'bps_load_governance',
);

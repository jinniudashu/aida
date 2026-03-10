import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type {
  GovernanceConfig,
  ConstraintDef,
  PolicyDef,
  CircuitBreakerConfig,
  Severity,
  ViolationAction,
} from './types.js';

const VALID_SEVERITIES = new Set<Severity>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const VALID_ACTIONS = new Set<ViolationAction>(['BLOCK', 'REQUIRE_APPROVAL']);

export interface GovernanceLoadResult {
  constraints: ConstraintDef[];
  circuitBreaker?: CircuitBreakerConfig;
  errors: string[];
}

/** Load and validate governance.yaml from a file path */
export function loadGovernanceFile(filePath: string): GovernanceLoadResult {
  if (!fs.existsSync(filePath)) {
    return { constraints: [], errors: [`File not found: ${filePath}`] };
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return loadGovernanceFromString(content);
}

/** Load and validate governance config from a YAML string */
export function loadGovernanceFromString(yamlContent: string): GovernanceLoadResult {
  const errors: string[] = [];
  let raw: GovernanceConfig;

  try {
    raw = parseYaml(yamlContent) as GovernanceConfig;
  } catch (err) {
    return { constraints: [], errors: [`YAML parse error: ${err instanceof Error ? err.message : String(err)}`] };
  }

  if (!raw || typeof raw !== 'object') {
    return { constraints: [], errors: ['Governance config must be a YAML object'] };
  }

  // Support flat constraints[] format (what Aida writes) in addition to policies[] format
  const rawAny2 = raw as unknown as Record<string, unknown>;
  if (!Array.isArray(raw.policies) && Array.isArray(rawAny2.constraints)) {
    const flatConstraints = rawAny2.constraints as Array<Record<string, unknown>>;
    // Normalize flat constraint fields: Aida may write `action` instead of `onViolation`,
    // and may omit `scope.tools` (default to all write tools)
    const ALL_WRITE_TOOLS = ['bps_update_entity', 'bps_create_task', 'bps_update_task', 'bps_complete_task', 'bps_create_skill'];
    const normalized = flatConstraints.map(c => ({
      ...c,
      label: c.label ?? c.id ?? 'unnamed',
      onViolation: c.onViolation ?? c.action ?? 'BLOCK',
      scope: c.scope ?? { tools: ALL_WRITE_TOOLS },
    }));
    raw.policies = [{
      id: 'auto-policy',
      label: 'Auto-generated policy from flat constraints',
      constraints: normalized,
    }] as unknown as PolicyDef[];
  }

  if (!Array.isArray(raw.policies)) {
    return { constraints: [], errors: ['Missing or invalid "policies" array. Expected "policies[]" or "constraints[]" at top level.'] };
  }

  const constraints: ConstraintDef[] = [];
  const seenIds = new Set<string>();

  for (const policy of raw.policies) {
    const policyErrors = validatePolicy(policy);
    errors.push(...policyErrors);
    if (policyErrors.length > 0) continue;

    for (const c of policy.constraints) {
      if (seenIds.has(c.id)) {
        errors.push(`Duplicate constraint ID: ${c.id}`);
        continue;
      }
      seenIds.add(c.id);

      const constraintErrors = validateConstraint(c, policy.id);
      errors.push(...constraintErrors);
      if (constraintErrors.length > 0) continue;

      constraints.push({
        id: c.id,
        policyId: policy.id,
        label: c.label,
        scope: {
          tools: c.scope.tools,
          entityTypes: c.scope.entityTypes,
          dataFields: c.scope.dataFields,
        },
        condition: c.condition,
        onViolation: normalizeAction(c.onViolation),
        severity: normalizeSeverity(c.severity),
        approver: c.approver,
        message: c.message,
      });
    }
  }

  // Parse circuit breaker config (supports both camelCase and snake_case keys)
  let circuitBreaker: CircuitBreakerConfig | undefined;
  const rawAny = raw as unknown as Record<string, unknown>;
  const cbRaw = rawAny.circuitBreaker ?? rawAny.circuit_breaker;
  if (cbRaw && typeof cbRaw === 'object') {
    const cb = cbRaw as Record<string, unknown>;
    const thresholdsRaw = cb.thresholds as Array<Record<string, unknown>> | undefined;
    circuitBreaker = {
      thresholds: (thresholdsRaw ?? []).map(t => ({
        severity: normalizeSeverity(t.severity as string),
        maxViolations: ((t.max_violations ?? t.maxViolations) as number) || 1,
        window: (t.window as string) || '1h',
        action: ((t.action as string) || 'WARNING').toUpperCase() as CircuitBreakerConfig['thresholds'][0]['action'],
      })),
      cooldown: cb.cooldown as string | undefined,
      notify: cb.notify as string[] | undefined,
    };
  }

  return { constraints, circuitBreaker, errors };
}

function validatePolicy(policy: PolicyDef): string[] {
  const errors: string[] = [];
  if (!policy.id || typeof policy.id !== 'string') {
    errors.push('Policy missing "id"');
  }
  if (!policy.label || typeof policy.label !== 'string') {
    errors.push(`Policy ${policy.id ?? '?'}: missing "label"`);
  }
  if (!Array.isArray(policy.constraints) || policy.constraints.length === 0) {
    errors.push(`Policy ${policy.id ?? '?'}: missing or empty "constraints"`);
  }
  return errors;
}

function validateConstraint(c: Omit<ConstraintDef, 'policyId'>, policyId: string): string[] {
  const errors: string[] = [];
  const prefix = `Policy ${policyId}, constraint ${c.id ?? '?'}`;

  if (!c.id) errors.push(`${prefix}: missing "id"`);
  if (!c.label) errors.push(`${prefix}: missing "label"`);
  if (!c.condition) errors.push(`${prefix}: missing "condition"`);
  if (!c.message) errors.push(`${prefix}: missing "message"`);

  if (!c.scope || !Array.isArray(c.scope.tools) || c.scope.tools.length === 0) {
    errors.push(`${prefix}: scope.tools must be a non-empty array`);
  }

  const onViolation = normalizeAction(c.onViolation);
  if (!VALID_ACTIONS.has(onViolation)) {
    errors.push(`${prefix}: invalid on_violation "${c.onViolation}"`);
  }

  const severity = normalizeSeverity(c.severity);
  if (!VALID_SEVERITIES.has(severity)) {
    errors.push(`${prefix}: invalid severity "${c.severity}"`);
  }

  if (onViolation === 'REQUIRE_APPROVAL' && !c.approver) {
    // Not strictly required, but warn-worthy — we allow it
  }

  return errors;
}

function normalizeSeverity(s: unknown): Severity {
  if (typeof s !== 'string') return 'MEDIUM';
  return s.toUpperCase() as Severity;
}

function normalizeAction(a: unknown): ViolationAction {
  if (typeof a !== 'string') return 'BLOCK';
  const upper = a.toUpperCase();
  if (upper === 'REQUIRE_APPROVAL') return 'REQUIRE_APPROVAL';
  return 'BLOCK';
}

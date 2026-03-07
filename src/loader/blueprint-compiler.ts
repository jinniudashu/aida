/**
 * Blueprint Compiler — DataItem pattern for BPS blueprints.
 *
 * Aida writes a simplified "business description" (services + flow topology).
 * The compiler generates the full engine schema (events + instructions + rules).
 *
 * Analogy with erpsys:
 *   DataItem DAG        ≈  services[] + flow[]
 *   generate_script()   ≈  compileBlueprint()
 *   Django ORM classes  ≈  events[] + instructions[] + rules[]
 */

// ——— Simplified input types (what Aida writes) ———

export interface SimplifiedService {
  id: string;
  label: string;
  composite?: boolean;
  executor?: 'agent' | 'manual' | 'system';
  entityType?: string;
  subjectEntity?: string;
  manualStart?: boolean;
  agentSkills?: string[];
  agentPrompt?: string;
  // Full-format fields accepted for passthrough
  serviceType?: string;
  executorType?: string;
}

export interface CompilerInput {
  version?: string;
  name: string;
  services?: SimplifiedService[];
  flow?: string[];
}

// ——— Compiled output types (what the engine consumes) ———

export interface CompiledBlueprint {
  version: string;
  name: string;
  services: CompiledService[];
  events: CompiledEvent[];
  instructions: CompiledInstruction[];
  rules: CompiledRule[];
}

export interface CompiledService {
  id: string;
  label: string;
  serviceType: string;
  executorType: string;
  entityType?: string;
  subjectEntity?: string;
  manualStart?: boolean;
  agentSkills?: string[];
  agentPrompt?: string;
}

export interface CompiledEvent {
  id: string;
  label: string;
  expression: string;
  evaluationMode: string;
}

export interface CompiledInstruction {
  id: string;
  label: string;
  sysCall: string;
}

export interface CompiledRule {
  id: string;
  label: string;
  targetServiceId: string;
  serviceId: string;
  eventId: string;
  instructionId: string;
  operandServiceId: string;
  order: number;
}

// ——— Compiler result ———

export interface CompileResult {
  blueprint: CompiledBlueprint;
  compiled: boolean;
  warnings: string[];
  errors: string[];
}

// ——— Internal: parsed flow edge ———

interface FlowEdge {
  from: string;
  to: string;
  condition?: string;
}

// ——— Public API ———

/**
 * Detect whether a parsed YAML object uses simplified format (has flow[], no rules[]).
 */
export function isSimplifiedFormat(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.flow) && !Array.isArray(obj.rules);
}

/**
 * Compile a simplified blueprint object into the full engine schema.
 *
 * Input: { services[], flow[] }
 * Output: { services[], events[], instructions[], rules[] }
 *
 * If the input already has events/instructions/rules, returns it as passthrough.
 */
export function compileBlueprint(input: Record<string, unknown>): CompileResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const services = input.services as SimplifiedService[] | undefined;
  const flow = input.flow as string[] | undefined;

  if (!services?.length) {
    errors.push('No "services" array found.');
    return {
      blueprint: { version: '1.0', name: '', services: [], events: [], instructions: [], rules: [] },
      compiled: false, warnings, errors,
    };
  }

  if (!flow?.length) {
    errors.push('No "flow" array found. Simplified blueprints require flow[] to define service connections (e.g., "svc-a -> svc-b").');
    return {
      blueprint: { version: '1.0', name: '', services: [], events: [], instructions: [], rules: [] },
      compiled: false, warnings, errors,
    };
  }

  // 1. Normalize services
  const serviceMap = new Map<string, CompiledService>();
  const compiledServices: CompiledService[] = [];
  for (const svc of services) {
    const normalized = normalizeService(svc);
    serviceMap.set(normalized.id, normalized);
    compiledServices.push(normalized);
  }

  // 2. Find composite service (scope for rules)
  const composites = compiledServices.filter(s => s.serviceType === 'composite');
  if (composites.length === 0) {
    warnings.push('No composite service found. First service will be used as the rule scope (targetServiceId).');
  }
  if (composites.length > 1) {
    warnings.push(`Multiple composite services found (${composites.map(s => s.id).join(', ')}). Using the first one as the rule scope.`);
  }
  const compositeId = composites[0]?.id ?? compiledServices[0].id;

  // 3. Parse flow edges
  const edges: FlowEdge[] = [];
  const conditionalExpressions: string[] = [];

  for (const line of flow) {
    const parsed = parseFlowLine(String(line));
    if (parsed.error) {
      errors.push(parsed.error);
      continue;
    }
    for (const edge of parsed.edges) {
      edges.push(edge);
      if (edge.condition && !conditionalExpressions.includes(edge.condition)) {
        conditionalExpressions.push(edge.condition);
      }
    }
  }

  // 4. Validate: all referenced service IDs must exist
  for (const edge of edges) {
    if (!serviceMap.has(edge.from)) {
      errors.push(`Flow references unknown service: "${edge.from}"`);
    }
    if (!serviceMap.has(edge.to)) {
      errors.push(`Flow references unknown service: "${edge.to}"`);
    }
  }

  if (errors.length > 0) {
    return {
      blueprint: { version: '1.0', name: String(input.name ?? ''), services: compiledServices, events: [], instructions: [], rules: [] },
      compiled: false, warnings, errors,
    };
  }

  // 5. Generate standard events
  const events: CompiledEvent[] = [
    { id: 'evt-new', label: 'Process created', expression: "process_state == 'NEW'", evaluationMode: 'deterministic' },
    { id: 'evt-terminated', label: 'Process terminated', expression: "process_state == 'TERMINATED'", evaluationMode: 'deterministic' },
  ];

  // Add non-deterministic events for conditional edges
  const condEventMap = new Map<string, string>();
  for (let i = 0; i < conditionalExpressions.length; i++) {
    const expr = conditionalExpressions[i];
    const eventId = `evt-cond-${i + 1}`;
    condEventMap.set(expr, eventId);
    events.push({
      id: eventId,
      label: expr.length > 60 ? expr.substring(0, 57) + '...' : expr,
      expression: expr,
      evaluationMode: 'non_deterministic',
    });
  }

  // 6. Generate standard instructions
  const instructions: CompiledInstruction[] = [
    { id: 'instr-start', label: 'Start service', sysCall: 'start_service' },
    { id: 'instr-terminate', label: 'Terminate process', sysCall: 'terminate_process' },
  ];

  // 7. Generate rules from flow topology
  const rules: CompiledRule[] = [];
  let order = 10;

  // 7a. Find entry services (have outgoing edges but no incoming edges, excluding composite)
  const incomingSet = new Set(edges.map(e => e.to));
  const outgoingSet = new Set(edges.map(e => e.from));

  const entryServiceIds: string[] = [];
  for (const svc of compiledServices) {
    if (svc.id === compositeId) continue;
    if (outgoingSet.has(svc.id) && !incomingSet.has(svc.id)) {
      entryServiceIds.push(svc.id);
    }
  }
  // Also include services that only appear as targets of the composite (no incoming from other non-composite)
  if (entryServiceIds.length === 0) {
    // Fallback: first non-composite service that appears in flow
    for (const svc of compiledServices) {
      if (svc.id !== compositeId && (outgoingSet.has(svc.id) || incomingSet.has(svc.id))) {
        entryServiceIds.push(svc.id);
        break;
      }
    }
  }

  // 7b. Entry rules: composite NEW → start each entry service
  for (const entryId of entryServiceIds) {
    rules.push({
      id: `rule-entry-${entryId}`,
      label: `${compositeId} started → ${entryId}`,
      targetServiceId: compositeId,
      serviceId: compositeId,
      eventId: 'evt-new',
      instructionId: 'instr-start',
      operandServiceId: entryId,
      order,
    });
    order += 10;
  }

  // 7c. Edge rules: from TERMINATED (or condition) → start to
  for (const edge of edges) {
    const eventId = edge.condition ? condEventMap.get(edge.condition)! : 'evt-terminated';
    rules.push({
      id: makeRuleId(edge.from, edge.to),
      label: `${edge.from} done → ${edge.to}`,
      targetServiceId: compositeId,
      serviceId: edge.from,
      eventId,
      instructionId: 'instr-start',
      operandServiceId: edge.to,
      order,
    });
    order += 10;
  }

  return {
    blueprint: {
      version: String(input.version ?? '1.0'),
      name: String(input.name ?? ''),
      services: compiledServices,
      events,
      instructions,
      rules,
    },
    compiled: true,
    warnings,
    errors,
  };
}

// ——— Internals ———

function normalizeService(svc: SimplifiedService): CompiledService {
  const serviceType = svc.serviceType ?? (svc.composite ? 'composite' : 'atomic');
  const executorType = svc.executorType ?? svc.executor ?? (svc.composite ? 'system' : 'manual');

  const result: CompiledService = {
    id: svc.id,
    label: svc.label,
    serviceType,
    executorType,
  };

  if (svc.entityType) result.entityType = svc.entityType;
  if (svc.subjectEntity) result.subjectEntity = svc.subjectEntity;
  if (svc.manualStart !== undefined) result.manualStart = svc.manualStart;
  else if (svc.composite) result.manualStart = true;
  if (svc.agentSkills) result.agentSkills = svc.agentSkills;
  if (svc.agentPrompt) result.agentPrompt = svc.agentPrompt;

  return result;
}

/**
 * Parse a flow line into edges.
 *
 * Syntax:
 *   "A -> B -> C"                        sequential chain
 *   "A -> B, C, D"                       parallel fanout
 *   "A -> B | \"condition text\""        conditional (non-deterministic event)
 *
 * The condition (after |) applies only to the last arrow in the chain.
 */
function parseFlowLine(line: string): { edges: FlowEdge[]; error?: string } {
  const trimmed = line.trim();
  if (!trimmed) return { edges: [] };

  // Extract condition (after last " | ")
  let condition: string | undefined;
  let mainPart = trimmed;
  const pipeIdx = trimmed.lastIndexOf(' | ');
  if (pipeIdx !== -1) {
    condition = trimmed.substring(pipeIdx + 3).trim().replace(/^["']|["']$/g, '');
    mainPart = trimmed.substring(0, pipeIdx).trim();
  }

  // Split by " -> "
  const segments = mainPart.split(/\s*->\s*/).filter(s => s.length > 0);
  if (segments.length < 2) {
    return { edges: [], error: `Flow line needs at least 2 services connected by "->": "${trimmed}"` };
  }

  const edges: FlowEdge[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const fromId = segments[i].trim();
    const toIds = segments[i + 1].split(/\s*,\s*/).map(s => s.trim()).filter(s => s.length > 0);
    const isLastArrow = i === segments.length - 2;

    for (const toId of toIds) {
      edges.push({
        from: fromId,
        to: toId,
        condition: isLastArrow ? condition : undefined,
      });
    }
  }

  return { edges };
}

function makeRuleId(from: string, to: string): string {
  return `rule-${from}-to-${to}`.replace(/[^a-zA-Z0-9-]/g, '-');
}

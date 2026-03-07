import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBpsEngine,
  type BpsEngine,
  loadBlueprintFromString,
  compileBlueprint,
  isSimplifiedFormat,
} from '../src/index.js';

// ——— Test fixtures ———

const SIMPLIFIED_SEQUENTIAL = `
version: "1.0"
name: "store-opening"

services:
  - id: svc-opening
    label: "Store Opening"
    composite: true
    entityType: store

  - id: svc-env-prep
    label: "Environment Prep"
    executor: manual

  - id: svc-material-check
    label: "Material Check"
    executor: manual

  - id: svc-final
    label: "Final Check"
    executor: manual

flow:
  - svc-env-prep -> svc-material-check -> svc-final
`;

const SIMPLIFIED_PARALLEL = `
version: "1.0"
name: "geo-publish"

services:
  - id: svc-geo
    label: "GEO Operations"
    composite: true
    entityType: store

  - id: svc-generate
    label: "Content Generation"
    executor: agent
    agentPrompt: "Generate GEO content"

  - id: svc-pub-doubao
    label: "Doubao Publish"
    executor: agent

  - id: svc-pub-qianwen
    label: "Qianwen Publish"
    executor: agent

  - id: svc-pub-yuanbao
    label: "Yuanbao Publish"
    executor: agent

  - id: svc-summary
    label: "Summary"
    executor: agent

flow:
  - svc-generate -> svc-pub-doubao, svc-pub-qianwen, svc-pub-yuanbao
  - svc-pub-doubao -> svc-summary
`;

const SIMPLIFIED_CONDITIONAL = `
version: "1.0"
name: "monitor-optimize"

services:
  - id: svc-ops
    label: "Operations"
    composite: true

  - id: svc-monitor
    label: "Monitor"
    executor: agent

  - id: svc-optimize
    label: "Optimize"
    executor: agent

flow:
  - svc-monitor -> svc-optimize | "GEO score below 60"
`;

const FULL_FORMAT = `
version: "1.0"
name: "full-format-test"

services:
  - id: svc-main
    label: "Main"
    serviceType: composite
    executorType: system

events:
  - id: evt-new
    label: "New"
    expression: "process_state == 'NEW'"
    evaluationMode: deterministic

instructions:
  - id: instr-start
    label: "Start"
    sysCall: start_service

rules:
  - id: rule-1
    label: "Rule 1"
    targetServiceId: svc-main
    serviceId: svc-main
    eventId: evt-new
    instructionId: instr-start
    operandServiceId: svc-main
`;

// ——— Tests ———

describe('Blueprint Compiler', () => {
  describe('isSimplifiedFormat', () => {
    it('should detect simplified format (flow, no rules)', () => {
      expect(isSimplifiedFormat({ flow: ['a -> b'], services: [] })).toBe(true);
    });

    it('should reject full format (has rules)', () => {
      expect(isSimplifiedFormat({ flow: ['a -> b'], rules: [{}] })).toBe(false);
    });

    it('should reject format with no flow', () => {
      expect(isSimplifiedFormat({ services: [] })).toBe(false);
    });
  });

  describe('compileBlueprint — sequential chain', () => {
    it('should compile services + flow into full schema', () => {
      const input = {
        version: '1.0',
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'Step A' },
          { id: 'svc-b', label: 'Step B' },
          { id: 'svc-c', label: 'Step C' },
        ],
        flow: ['svc-a -> svc-b -> svc-c'],
      };

      const result = compileBlueprint(input);

      expect(result.compiled).toBe(true);
      expect(result.errors).toEqual([]);

      // Services normalized
      expect(result.blueprint.services).toHaveLength(4);
      expect(result.blueprint.services[0].serviceType).toBe('composite');
      expect(result.blueprint.services[0].executorType).toBe('system');
      expect(result.blueprint.services[1].serviceType).toBe('atomic');
      expect(result.blueprint.services[1].executorType).toBe('manual');

      // Standard events generated
      expect(result.blueprint.events).toHaveLength(2);
      expect(result.blueprint.events.map(e => e.id)).toEqual(['evt-new', 'evt-terminated']);

      // Standard instructions generated
      expect(result.blueprint.instructions).toHaveLength(2);
      expect(result.blueprint.instructions.map(i => i.sysCall)).toEqual(['start_service', 'terminate_process']);

      // Rules: 1 entry + 2 edges = 3
      expect(result.blueprint.rules).toHaveLength(3);

      // Entry rule: composite NEW → svc-a
      const entryRule = result.blueprint.rules[0];
      expect(entryRule.serviceId).toBe('svc-main');
      expect(entryRule.eventId).toBe('evt-new');
      expect(entryRule.operandServiceId).toBe('svc-a');

      // Edge rules
      const rule1 = result.blueprint.rules[1];
      expect(rule1.serviceId).toBe('svc-a');
      expect(rule1.eventId).toBe('evt-terminated');
      expect(rule1.operandServiceId).toBe('svc-b');

      const rule2 = result.blueprint.rules[2];
      expect(rule2.serviceId).toBe('svc-b');
      expect(rule2.eventId).toBe('evt-terminated');
      expect(rule2.operandServiceId).toBe('svc-c');
    });

    it('should auto-increment rule order by 10', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'A' },
          { id: 'svc-b', label: 'B' },
        ],
        flow: ['svc-a -> svc-b'],
      });

      expect(result.blueprint.rules[0].order).toBe(10); // entry
      expect(result.blueprint.rules[1].order).toBe(20); // edge
    });
  });

  describe('compileBlueprint — parallel fanout', () => {
    it('should generate multiple rules from comma-separated targets', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-review', label: 'Review' },
          { id: 'svc-pub-a', label: 'Pub A' },
          { id: 'svc-pub-b', label: 'Pub B' },
          { id: 'svc-pub-c', label: 'Pub C' },
        ],
        flow: ['svc-review -> svc-pub-a, svc-pub-b, svc-pub-c'],
      });

      expect(result.compiled).toBe(true);
      expect(result.errors).toEqual([]);

      // 1 entry + 3 parallel = 4 rules
      expect(result.blueprint.rules).toHaveLength(4);

      // All three fanout rules share the same serviceId and eventId
      const fanoutRules = result.blueprint.rules.filter(r => r.serviceId === 'svc-review');
      expect(fanoutRules).toHaveLength(3);
      expect(fanoutRules.map(r => r.operandServiceId).sort()).toEqual(['svc-pub-a', 'svc-pub-b', 'svc-pub-c']);
      for (const r of fanoutRules) {
        expect(r.eventId).toBe('evt-terminated');
      }
    });
  });

  describe('compileBlueprint — conditional edges', () => {
    it('should generate non-deterministic event for condition after |', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-monitor', label: 'Monitor' },
          { id: 'svc-optimize', label: 'Optimize' },
        ],
        flow: ['svc-monitor -> svc-optimize | "Score below 60"'],
      });

      expect(result.compiled).toBe(true);

      // Should have 3 events: new, terminated, conditional
      expect(result.blueprint.events).toHaveLength(3);
      const condEvent = result.blueprint.events[2];
      expect(condEvent.id).toBe('evt-cond-1');
      expect(condEvent.expression).toBe('Score below 60');
      expect(condEvent.evaluationMode).toBe('non_deterministic');

      // The edge rule should reference the conditional event
      const condRule = result.blueprint.rules.find(r => r.operandServiceId === 'svc-optimize');
      expect(condRule?.eventId).toBe('evt-cond-1');
    });
  });

  describe('compileBlueprint — service normalization', () => {
    it('should normalize composite shorthand', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'A' },
        ],
        flow: ['svc-main -> svc-a'],
      });

      const main = result.blueprint.services.find(s => s.id === 'svc-main')!;
      expect(main.serviceType).toBe('composite');
      expect(main.executorType).toBe('system');
      expect(main.manualStart).toBe(true);
    });

    it('should normalize executor shorthand', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'A', executor: 'agent', agentPrompt: 'Do something' },
          { id: 'svc-b', label: 'B', executor: 'manual' },
          { id: 'svc-c', label: 'C', executor: 'system' },
        ],
        flow: ['svc-a -> svc-b -> svc-c'],
      });

      expect(result.blueprint.services[1].executorType).toBe('agent');
      expect(result.blueprint.services[1].agentPrompt).toBe('Do something');
      expect(result.blueprint.services[2].executorType).toBe('manual');
      expect(result.blueprint.services[3].executorType).toBe('system');
    });

    it('should accept full-format fields in services (passthrough)', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', serviceType: 'composite', executorType: 'system' },
          { id: 'svc-a', label: 'A', serviceType: 'atomic', executorType: 'agent' },
        ],
        flow: ['svc-main -> svc-a'],
      });

      expect(result.blueprint.services[0].serviceType).toBe('composite');
      expect(result.blueprint.services[1].executorType).toBe('agent');
    });
  });

  describe('compileBlueprint — error handling', () => {
    it('should error on missing services', () => {
      const result = compileBlueprint({ name: 'test', flow: ['a -> b'] });
      expect(result.errors).toContain('No "services" array found.');
    });

    it('should error on missing flow', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [{ id: 'svc-a', label: 'A' }],
      });
      expect(result.errors.some(e => e.includes('No "flow" array found'))).toBe(true);
    });

    it('should error on unknown service in flow', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'A' },
        ],
        flow: ['svc-a -> svc-unknown'],
      });
      expect(result.errors).toContain('Flow references unknown service: "svc-unknown"');
    });

    it('should error on flow line with less than 2 segments', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'A' },
        ],
        flow: ['svc-a'],
      });
      expect(result.errors.some(e => e.includes('needs at least 2 services'))).toBe(true);
    });
  });

  describe('compileBlueprint — entry service detection', () => {
    it('should detect entry service (no incoming edges)', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'A' },
          { id: 'svc-b', label: 'B' },
          { id: 'svc-c', label: 'C' },
        ],
        flow: ['svc-a -> svc-b -> svc-c'],
      });

      const entryRule = result.blueprint.rules[0];
      expect(entryRule.serviceId).toBe('svc-main');
      expect(entryRule.operandServiceId).toBe('svc-a');
    });

    it('should handle multiple entry services (parallel start)', () => {
      const result = compileBlueprint({
        name: 'test',
        services: [
          { id: 'svc-main', label: 'Main', composite: true },
          { id: 'svc-a', label: 'A' },
          { id: 'svc-b', label: 'B' },
          { id: 'svc-c', label: 'C' },
        ],
        flow: [
          'svc-a -> svc-c',
          'svc-b -> svc-c',
        ],
      });

      // Both svc-a and svc-b should be entry services
      const entryRules = result.blueprint.rules.filter(r => r.eventId === 'evt-new');
      expect(entryRules).toHaveLength(2);
      expect(entryRules.map(r => r.operandServiceId).sort()).toEqual(['svc-a', 'svc-b']);
    });
  });
});

describe('yaml-loader auto-compile integration', () => {
  let engine: BpsEngine;

  beforeEach(() => {
    engine = createBpsEngine();
  });

  it('should auto-compile simplified YAML and load into BlueprintStore', () => {
    const result = loadBlueprintFromString(SIMPLIFIED_SEQUENTIAL, engine.blueprintStore);

    expect(result.errors).toEqual([]);
    expect(result.services).toBe(4);
    expect(result.events).toBe(2);
    expect(result.instructions).toBe(2);
    expect(result.rules).toBe(3); // 1 entry + 2 edges (3-service chain)

    // Verify services are in the store
    const services = engine.blueprintStore.listServices();
    expect(services).toHaveLength(4);
    expect(services.find(s => s.id === 'svc-opening')?.serviceType).toBe('composite');
    expect(services.find(s => s.id === 'svc-env-prep')?.executorType).toBe('manual');

    // Verify rules enable topology queries
    const nextSteps = engine.blueprintStore.getNextSteps('svc-env-prep');
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0].operandServiceId).toBe('svc-material-check');
  });

  it('should auto-compile parallel fanout YAML', () => {
    const result = loadBlueprintFromString(SIMPLIFIED_PARALLEL, engine.blueprintStore);

    expect(result.errors).toEqual([]);
    expect(result.services).toBe(6);

    // svc-generate → 3 parallel targets
    const nextSteps = engine.blueprintStore.getNextSteps('svc-generate');
    expect(nextSteps).toHaveLength(3);
    const targets = nextSteps.map(s => s.operandServiceId).sort();
    expect(targets).toEqual(['svc-pub-doubao', 'svc-pub-qianwen', 'svc-pub-yuanbao']);
  });

  it('should auto-compile conditional YAML with non-deterministic event', () => {
    const result = loadBlueprintFromString(SIMPLIFIED_CONDITIONAL, engine.blueprintStore);

    expect(result.errors).toEqual([]);
    expect(result.events).toBe(3); // new + terminated + conditional

    const nextSteps = engine.blueprintStore.getNextSteps('svc-monitor');
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0].evaluationMode).toBe('non_deterministic');
    expect(nextSteps[0].operandServiceId).toBe('svc-optimize');
  });

  it('should pass through full-format YAML without compilation', () => {
    const result = loadBlueprintFromString(FULL_FORMAT, engine.blueprintStore);

    expect(result.errors).toEqual([]);
    expect(result.services).toBe(1);
    expect(result.events).toBe(1);
    expect(result.instructions).toBe(1);
    expect(result.rules).toBe(1);

    // Should NOT have the auto-compile warning
    expect(result.warnings.some(w => w.includes('compiled from simplified format'))).toBe(false);
  });

  it('should include compile warning for simplified format', () => {
    const result = loadBlueprintFromString(SIMPLIFIED_SEQUENTIAL, engine.blueprintStore);
    expect(result.warnings.some(w => w.includes('compiled from simplified format'))).toBe(true);
  });

  it('should work with bps_create_task after auto-compile', () => {
    loadBlueprintFromString(SIMPLIFIED_SEQUENTIAL, engine.blueprintStore);

    // Should be able to create a task for a compiled service
    const task = engine.tracker.createTask({ serviceId: 'svc-env-prep', entityType: 'store', entityId: 'store-001' });
    expect(task.id).toBeTruthy();
    expect(task.state).toBe('OPEN');
  });
});

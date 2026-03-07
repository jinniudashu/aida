import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "../../src/plugins/types.js";
import { createBpsEngine, createDatabase } from "./src/index.js";
import { loadBlueprintFromYaml } from "./src/loader/yaml-loader.js";
import { ProcessStateMachine } from "./src/engine/state-machine.js";
import path from "node:path";
import fs from "node:fs";

export default function register(api: OpenClawPluginApi) {
  const logger = api.logger;
  logger.info("[bps-engine] Initializing BPS Engine plugin...");

  // Create the BPS engine with file-based SQLite for data persistence & sharing
  const pluginDir = path.dirname(new URL(import.meta.url).pathname);
  const dbPath = process.env.BPS_DB_PATH || path.join(pluginDir, "data", "bps-engine.db");
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  logger.info(`[bps-engine] Using database: ${dbPath}`);
  const db = createDatabase(dbPath);
  const engine = createBpsEngine({ db });

  // Auto-load blueprints from extensions/bps-engine/blueprints/
  const bpDir = path.join(path.dirname(new URL(import.meta.url).pathname), "blueprints");
  if (fs.existsSync(bpDir)) {
    for (const file of fs.readdirSync(bpDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))) {
      try {
        const result = loadBlueprintFromYaml(path.join(bpDir, file), engine.blueprintStore);
        logger.info(`[bps-engine] Loaded blueprint ${file}: ${result.services} services, ${result.events} events, ${result.rules} rules`);
        if (result.errors.length > 0) {
          logger.warn(`[bps-engine] Blueprint ${file} had errors: ${result.errors.join("; ")}`);
        }
      } catch (err) {
        logger.error(`[bps-engine] Failed to load blueprint ${file}: ${err}`);
      }
    }
  }

  // Helper: wrap result as AgentToolResult
  function jsonResult(data: unknown) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      details: data,
    };
  }

  // ——— Tool 1: bps_list_services ———
  api.registerTool({
    name: "bps_list_services",
    label: "BPS List Services",
    description: "List all BPS services, optionally filtered by entityType, executorType, or status.",
    parameters: Type.Object({
      entityType: Type.Optional(Type.String({ description: "Filter by entity type" })),
      executorType: Type.Optional(Type.String({ description: "Filter by executor type: manual|agent|system" })),
      status: Type.Optional(Type.String({ description: "Filter by status: draft|active|archived" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      let services = engine.blueprintStore.listServices({
        entityType: params.entityType as string | undefined,
        status: params.status as string | undefined,
      });
      if (params.executorType) {
        services = services.filter(s => s.executorType === params.executorType);
      }
      return jsonResult({
        count: services.length,
        services: services.map(s => ({
          id: s.id, label: s.label, serviceType: s.serviceType,
          executorType: s.executorType, entityType: s.entityType, status: s.status,
        })),
      });
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 2: bps_get_process ———
  api.registerTool({
    name: "bps_get_process",
    label: "BPS Get Process",
    description: "Get a BPS process state and its latest context snapshot.",
    parameters: Type.Object({
      processId: Type.String({ description: "The process ID to retrieve" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const result = engine.processManager.getProcessWithContext(params.processId as string);
      if (!result) {
        return jsonResult({ error: `Process not found: ${params.processId}` });
      }
      return jsonResult({
        process: result.process,
        contextSnapshot: result.snapshot?.contextData ?? null,
      });
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 3: bps_query_processes ———
  api.registerTool({
    name: "bps_query_processes",
    label: "BPS Query Processes",
    description: "Query BPS processes by state, serviceId, entityType, or entityId.",
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "Filter by process state: NEW|READY|RUNNING|WAITING|SUSPENDED|TERMINATED|ERROR" })),
      serviceId: Type.Optional(Type.String({ description: "Filter by service ID" })),
      entityType: Type.Optional(Type.String({ description: "Filter by entity type" })),
      entityId: Type.Optional(Type.String({ description: "Filter by entity ID" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      let processes = params.state
        ? engine.processStore.queryByState(params.state as string)
        : [
            ...engine.processStore.queryByState("NEW"),
            ...engine.processStore.queryByState("READY"),
            ...engine.processStore.queryByState("RUNNING"),
            ...engine.processStore.queryByState("WAITING"),
            ...engine.processStore.queryByState("SUSPENDED"),
            ...engine.processStore.queryByState("ERROR"),
          ];
      if (params.serviceId) processes = processes.filter(p => p.serviceId === params.serviceId);
      if (params.entityType) processes = processes.filter(p => p.entityType === params.entityType);
      if (params.entityId) processes = processes.filter(p => p.entityId === params.entityId);
      return jsonResult({
        count: processes.length,
        processes: processes.map(p => ({
          id: p.id, pid: p.pid, serviceId: p.serviceId, state: p.state,
          entityType: p.entityType, entityId: p.entityId, createdAt: p.createdAt,
        })),
      });
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 4: bps_start_process ———
  api.registerTool({
    name: "bps_start_process",
    label: "BPS Start Process",
    description: "Start a new BPS process for a given service. Triggers rule evaluation and may spawn child processes.",
    parameters: Type.Object({
      serviceId: Type.String({ description: "The service ID to start a process for" }),
      entityType: Type.Optional(Type.String({ description: "Entity type for the process" })),
      entityId: Type.Optional(Type.String({ description: "Entity ID for the process" })),
      operatorId: Type.Optional(Type.String({ description: "Operator ID" })),
      initParams: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Initial context parameters" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const process = await engine.processManager.createProcess({
          serviceId: params.serviceId as string,
          entityType: params.entityType as string | undefined,
          entityId: params.entityId as string | undefined,
          operatorId: params.operatorId as string | undefined,
          initParams: params.initParams as Record<string, unknown> | undefined,
        });
        return jsonResult({ success: true, processId: process.id, pid: process.pid, state: process.state });
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 5: bps_complete_task ———
  api.registerTool({
    name: "bps_complete_task",
    label: "BPS Complete Task",
    description: "Complete a BPS task. Automatically advances through intermediate states (NEW->READY->RUNNING->TERMINATED).",
    parameters: Type.Object({
      processId: Type.String({ description: "The process ID to complete" }),
      returnValue: Type.Optional(Type.Unknown({ description: "Return value / summary of results" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const processId = params.processId as string;
      const process = engine.processStore.get(processId);
      if (!process) return jsonResult({ success: false, error: `Process not found: ${processId}` });
      if (ProcessStateMachine.isTerminal(process.state)) {
        return jsonResult({ success: true, message: "Process already terminated", processId });
      }
      try {
        const advancePath: Record<string, string[]> = {
          "NEW": ["READY", "RUNNING"],
          "READY": ["RUNNING"],
          "WAITING": ["RUNNING"],
          "SUSPENDED": ["READY", "RUNNING"],
        };
        const steps = advancePath[process.state];
        if (steps) {
          for (const s of steps) await engine.processManager.transitionState(processId, s);
        }
        await engine.processManager.completeProcess(processId, params.returnValue);
        return jsonResult({ success: true, processId, finalState: "TERMINATED" });
      } catch (err) {
        return jsonResult({ success: false, error: String(err), processId });
      }
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 6: bps_transition_state ———
  api.registerTool({
    name: "bps_transition_state",
    label: "BPS Transition State",
    description: "Transition a BPS process to a new state. Validates state machine legality.",
    parameters: Type.Object({
      processId: Type.String({ description: "The process ID to transition" }),
      newState: Type.String({ description: "Target state: NEW|READY|RUNNING|WAITING|SUSPENDED|TERMINATED|ERROR" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const updated = await engine.processManager.transitionState(
          params.processId as string, params.newState as string,
        );
        return jsonResult({ success: true, processId: params.processId, currentState: updated.state });
      } catch (err) {
        return jsonResult({ success: false, error: String(err), processId: params.processId });
      }
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 7: bps_get_entity ———
  api.registerTool({
    name: "bps_get_entity",
    label: "BPS Get Entity",
    description: "Read an entity dossier. Lookup by erpsysId (single global ID) or by entityType+entityId. Optionally read a specific historical version.",
    parameters: Type.Object({
      erpsysId: Type.Optional(Type.String({ description: "Global unique dossier ID (erpsysId). If provided, entityType/entityId are ignored." })),
      entityType: Type.Optional(Type.String({ description: "Entity type (e.g. 'store', 'order')" })),
      entityId: Type.Optional(Type.String({ description: "Entity ID" })),
      version: Type.Optional(Type.Integer({ description: "Specific version number to read (omit for latest)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const erpsysId = params.erpsysId as string | undefined;
      const entityType = params.entityType as string | undefined;
      const entityId = params.entityId as string | undefined;
      const version = params.version as number | undefined;

      let result: { dossier: { id: string; entityType: string; entityId: string; [k: string]: unknown }; data: Record<string, unknown> } | null;

      if (erpsysId) {
        result = engine.dossierStore.getById(erpsysId);
        if (!result) return jsonResult({ error: `Entity not found: erpsysId=${erpsysId}` });
      } else if (entityType && entityId) {
        result = engine.dossierStore.get(entityType, entityId);
        if (!result) return jsonResult({ error: `Entity not found: ${entityType}/${entityId}` });
      } else {
        return jsonResult({ error: "Provide erpsysId or both entityType and entityId" });
      }

      if (version !== undefined) {
        const ver = engine.dossierStore.getVersion(result.dossier.id, version);
        if (!ver) {
          return jsonResult({ error: `Version ${version} not found for erpsysId=${result.dossier.id}` });
        }
        return jsonResult({ dossier: result.dossier, version: ver });
      }

      return jsonResult(result);
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 8: bps_update_entity ———
  api.registerTool({
    name: "bps_update_entity",
    label: "BPS Update Entity",
    description: "Write/update an entity dossier. Creates the dossier if it doesn't exist. Uses shallow merge semantics.",
    parameters: Type.Object({
      entityType: Type.String({ description: "Entity type (e.g. 'store', 'order')" }),
      entityId: Type.String({ description: "Entity ID" }),
      data: Type.Record(Type.String(), Type.Unknown(), { description: "Data fields to write (shallow merged with existing)" }),
      message: Type.Optional(Type.String({ description: "Commit message for audit trail" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const dossier = engine.dossierStore.getOrCreate(
          params.entityType as string, params.entityId as string,
        );
        const ver = engine.dossierStore.commit(dossier.id, params.data as Record<string, unknown>, {
          message: params.message as string | undefined,
        });
        return jsonResult({ success: true, dossierId: dossier.id, version: ver.version });
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 9: bps_query_entities ———
  api.registerTool({
    name: "bps_query_entities",
    label: "BPS Query Entities",
    description: "Search entity dossiers by entityType, lifecycle, and/or data field values (e.g. {\"city\": \"Shanghai\"}). Supports pagination.",
    parameters: Type.Object({
      entityType: Type.Optional(Type.String({ description: "Filter by entity type" })),
      lifecycle: Type.Optional(Type.String({ description: "Filter by lifecycle: DRAFT|ACTIVE|ARCHIVED" })),
      dataFilter: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Filter by data fields (equality match), e.g. {\"city\": \"Shanghai\"}" })),
      limit: Type.Optional(Type.Integer({ description: "Max number of results (default: 50)" })),
      offset: Type.Optional(Type.Integer({ description: "Number of results to skip (for pagination)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const results = engine.dossierStore.search({
          entityType: params.entityType as string | undefined,
          lifecycle: params.lifecycle as string | undefined,
          dataFilter: params.dataFilter as Record<string, unknown> | undefined,
          limit: (params.limit as number | undefined) ?? 50,
          offset: params.offset as number | undefined,
        });
        return jsonResult({
          count: results.length,
          dossiers: results.map(r => ({
            id: r.dossier.id, entityType: r.dossier.entityType, entityId: r.dossier.entityId,
            lifecycle: r.dossier.lifecycle, currentVersion: r.dossier.currentVersion,
            data: r.data,
            createdAt: r.dossier.createdAt, updatedAt: r.dossier.updatedAt,
          })),
        });
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 10: bps_dashboard_overview ———
  api.registerTool({
    name: "bps_dashboard_overview",
    label: "BPS Dashboard Overview",
    description: "Get a full dashboard overview with entity, process, and service statistics.",
    parameters: Type.Object({}),
    async execute() {
      const overview = engine.dashboardQuery.getOverview();
      return jsonResult(overview);
    },
  } as unknown as AnyAgentTool);

  // ——— Tool 11: bps_dashboard_snapshot ———
  api.registerTool({
    name: "bps_dashboard_snapshot",
    label: "BPS Dashboard Snapshot",
    description: "Get a compact text summary of the current BPS system state, optimized for agent conversations.",
    parameters: Type.Object({}),
    async execute() {
      const overview = engine.dashboardQuery.getOverview();
      const lines: string[] = [];

      lines.push("=== BPS System Snapshot ===");
      lines.push("");

      // Processes
      lines.push(`Processes: ${overview.processes.totalCount} total, ${overview.processes.activeCount} active, ${overview.processes.errorCount} errors`);
      const stateEntries = Object.entries(overview.processes.byState);
      if (stateEntries.length > 0) {
        lines.push(`  States: ${stateEntries.map(([s, c]) => `${s}=${c}`).join(', ')}`);
      }

      // Entities
      lines.push(`Entities: ${overview.entities.totalCount} total`);
      const typeEntries = Object.entries(overview.entities.byType);
      if (typeEntries.length > 0) {
        lines.push(`  Types: ${typeEntries.map(([t, c]) => `${t}=${c}`).join(', ')}`);
      }

      // Services
      lines.push(`Services: ${overview.services.totalCount} total`);
      const execEntries = Object.entries(overview.services.byExecutorType);
      if (execEntries.length > 0) {
        lines.push(`  Executors: ${execEntries.map(([e, c]) => `${e}=${c}`).join(', ')}`);
      }

      // Recent changes
      if (overview.entities.recentChanges.length > 0) {
        lines.push("");
        lines.push("Recent Changes:");
        for (const change of overview.entities.recentChanges) {
          const by = change.committedBy ? ` by ${change.committedBy}` : '';
          lines.push(`  - ${change.dossier.entityType}/${change.dossier.entityId} v${change.version}${by} (${change.versionCreatedAt})`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: overview,
      };
    },
  } as unknown as AnyAgentTool);

  // Log BPS engine events
  engine.processManager.on("process:created", (e) => {
    logger.info(`[bps-engine] Process created: ${e.processId} (service: ${e.serviceId})`);
  });
  engine.processManager.on("process:state_changed", (e) => {
    logger.info(`[bps-engine] Process ${e.processId}: ${e.from} -> ${e.to}`);
  });
  engine.processManager.on("process:completed", (e) => {
    logger.info(`[bps-engine] Process completed: ${e.processId}`);
  });
  engine.processManager.on("process:error", (e) => {
    logger.error(`[bps-engine] Process error: ${e.processId} - ${e.error}`);
  });
  engine.processManager.on("rule:evaluated", (e) => {
    logger.info(`[bps-engine] Rule ${e.ruleId} evaluated: matched=${e.matched} (process: ${e.processId})`);
  });

  engine.processManager.on("dossier:committed", (e) => {
    logger.info(`[bps-engine] Dossier committed: ${e.dossierId} (entity: ${e.entityType}/${e.entityId}, process: ${e.processId})`);
  });

  logger.info("[bps-engine] BPS Engine plugin registered with 11 tools.");
}

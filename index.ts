/**
 * BPS Engine — OpenClaw plugin entry point.
 *
 * This file lives at the repo root so that `openclaw plugins install --link`
 * can discover it alongside openclaw.plugin.json.
 */

import { loadAidaProject } from "./src/loader/aida-project.js";
import { createBpsTools } from "./src/integration/tools.js";
import { BpsEventBridge } from "./src/integration/event-bridge.js";

// Minimal OpenClaw plugin API surface used by this plugin.
// The actual object is injected by OpenClaw at runtime.
interface OpenClawPluginApi {
  logger: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; error(msg: string, meta?: Record<string, unknown>): void; debug(msg: string, meta?: Record<string, unknown>): void };
  registerTool(tool: unknown): void;
  onEvent(event: string, handler: (payload: Record<string, unknown>) => void | Promise<void>): void;
  emitEvent(event: string, payload: Record<string, unknown>): void;
}

export default function register(api: OpenClawPluginApi) {
  const logger = api.logger;
  logger.info("[bps-engine] Initializing BPS Engine plugin...");

  // 1. Load AIDA project from ~/.aida/
  const result = loadAidaProject();
  const { engine, project, aidaDir, systemKnowledge } = result;
  logger.info(`[bps-engine] AIDA project loaded from ${aidaDir}`);
  if (project) {
    logger.info(`[bps-engine] Project: ${project.name} (${project.projectId})`);
    logger.info(`[bps-engine] Blueprints: ${project.blueprints.loaded}, Seeds: ${project.seeds.loaded}`);
  }
  logger.info(`[bps-engine] System knowledge: ${systemKnowledge.loaded} loaded, ${systemKnowledge.skipped} skipped`);
  if (result.governance && result.governance.constraintCount > 0) {
    logger.info(`[bps-engine] Governance: ${result.governance.constraintCount} constraints loaded`);
  }

  // 2. Register tools (13 tools from shared module, 5 wrapped with governance)
  const { governance } = result;
  const tools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    skillMetricsStore: engine.skillMetricsStore,
    governanceGate: governance?.gate,
    governanceStore: governance?.store,
    logger,
  });

  for (const tool of tools) {
    api.registerTool(tool);
  }

  // 3. Set up event bridge (BPS ↔ OpenClaw) if API supports events
  if (typeof (api as any).emitEvent === "function") {
    const eventBridge = new BpsEventBridge(
      api as any,
      engine.tracker,
      engine.processStore,
      logger,
    );
    eventBridge.setup();
  }

  logger.info(`[bps-engine] BPS Engine plugin registered with ${tools.length} tools.`);
}

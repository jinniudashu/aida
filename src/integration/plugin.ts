import type { DatabaseSync } from 'node:sqlite';
import type { OpenClawPluginApi, OpenClawLogger } from './openclaw-types.js';
import { createBpsTools } from './tools.js';
import { BpsEventBridge } from './event-bridge.js';
import { createBpsEngine, type BpsEngine } from '../index.js';

export interface BpsPluginConfig {
  /** 已有的 SQLite 数据库实例（复用 OpenClaw 的 DB） */
  db?: DatabaseSync;
  /** 自定义日志器 */
  logger?: OpenClawLogger;
}

export interface BpsPluginResult {
  engine: BpsEngine;
  eventBridge: BpsEventBridge;
}

/**
 * registerBpsPlugin — 一键注册 BPS 引擎到 OpenClaw
 *
 * 1. 创建 BPS Engine
 * 2. 注册 13 个工具到 OpenClaw（含治理层）
 * 3. 建立事件桥接
 */
export function registerBpsPlugin(
  api: OpenClawPluginApi,
  config: BpsPluginConfig = {},
): BpsPluginResult {
  const logger = config.logger ?? api.logger;

  // 1. 创建 BPS Engine
  const engine = createBpsEngine({
    db: config.db,
  });

  // 2. 注册工具
  const tools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    logger,
  });

  for (const tool of tools) {
    api.registerTool(tool);
  }

  // 3. 建立事件桥接
  const eventBridge = new BpsEventBridge(
    api,
    engine.tracker,
    engine.processStore,
    logger,
  );
  eventBridge.setup();

  logger?.info('BPS plugin registered', {
    toolCount: tools.length,
    toolNames: tools.map(t => t.name),
  });

  return { engine, eventBridge };
}

// ——— OpenClaw Integration Layer ———
export * from './openclaw-types.js';
export { createBpsTools, type BpsToolDeps } from './tools.js';
export { BpsEventBridge } from './event-bridge.js';
export { registerToolObserver, type ToolObserverDeps } from './tool-observer.js';
export { registerBpsPlugin, type BpsPluginConfig, type BpsPluginResult } from './plugin.js';

/**
 * OpenClaw API 契约类型（无运行时依赖）
 *
 * 这些类型描述了 OpenClaw Agent 框架的插件 API，
 * 让 BPS 引擎可以在不直接依赖 OpenClaw npm 包的情况下与之集成。
 */

// ——— Agent 工具定义 ———

export interface OpenClawAgentTool<TInput = unknown> {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (callId: string, params: TInput) => Promise<unknown>;
}

// ——— Agent 结束状态 ———

export type SubagentEndedOutcome =
  | 'ok'
  | 'error'
  | 'timeout'
  | 'killed'
  | 'reset'
  | 'deleted';

// ——— 日志接口 ———

export interface OpenClawLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

// ——— 事件处理 ———

export type OpenClawEventHandler = (payload: Record<string, unknown>) => void | Promise<void>;

// ——— 插件 API 主接口 ———

export interface OpenClawPluginApi {
  /** 注册工具到 OpenClaw */
  registerTool(tool: OpenClawAgentTool): void;

  /** 订阅 OpenClaw 事件 */
  onEvent(event: string, handler: OpenClawEventHandler): void;

  /** 发布事件到 Gateway */
  emitEvent(event: string, payload: Record<string, unknown>): void;

  /** 获取 homeDir（用于 DB 存储路径） */
  homeDir?: string;

  /** 获取日志器 */
  logger?: OpenClawLogger;
}

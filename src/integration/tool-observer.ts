import os from 'node:os';
import path from 'node:path';
import type { OpenClawPluginApi, OpenClawLogger } from './openclaw-types.js';
import type { ProcessTracker } from '../engine/process-tracker.js';

/**
 * ToolObserver — OpenClaw `after_tool_call` Hook 观测层
 *
 * 两个职责：
 * 1. 全景观测：为原生工具（write/edit/exec 等）emit 事件到 Dashboard SSE
 * 2. 纵深防御：检测 Agent 通过原生文件 I/O 绕过 BPS 工具写入 AIDA 数据目录
 */

export interface ToolObserverDeps {
  api: OpenClawPluginApi;
  tracker: ProcessTracker;
  logger?: OpenClawLogger;
}

/** after_tool_call payload（OpenClaw 文档定义的字段子集） */
interface AfterToolCallPayload {
  tool: string;
  input: Record<string, unknown>;
  result?: unknown;
  duration?: number;
  error?: string;
}

/** AIDA 数据目录名 */
const AIDA_DIR = '.aida';

/** 需要观测的原生工具集（非 BPS 工具） */
const NATIVE_WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'exec']);

/**
 * 注册 after_tool_call Hook 到 OpenClaw
 *
 * 使用 api.onHook()（优先）或回退到 (api as any).on()。
 * 如果两者均不可用，静默跳过（不影响引擎功能）。
 */
export function registerToolObserver(deps: ToolObserverDeps): boolean {
  const { api, tracker, logger } = deps;

  const registerFn = resolveHookRegistration(api);
  if (!registerFn) {
    logger?.debug('[tool-observer] Hook registration not available, skipping');
    return false;
  }

  const aidaDataDir = path.join(os.homedir(), AIDA_DIR);

  registerFn('after_tool_call', (payload) => {
    const p = payload as unknown as AfterToolCallPayload;
    if (!p.tool) return;

    // 1. 全景观测：原生工具事件 → tracker → Dashboard SSE
    if (NATIVE_WRITE_TOOLS.has(p.tool)) {
      tracker.emit('tool:native_call', {
        tool: p.tool,
        path: extractPath(p.input),
        duration: p.duration,
        hasError: !!p.error,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. 纵深防御：检测文件 I/O 绕过
    if (isAidaDataWrite(p.tool, p.input, aidaDataDir)) {
      const filePath = extractPath(p.input) ?? '(unknown)';
      logger?.warn('[tool-observer] Management bypass detected: native file I/O to AIDA data directory', {
        tool: p.tool,
        path: filePath,
      });
      tracker.emit('tool:management_bypass', {
        tool: p.tool,
        path: filePath,
        timestamp: new Date().toISOString(),
        message: `Agent used ${p.tool} to write directly to ${filePath} — bypassing BPS tools`,
      });
    }
  });

  logger?.info('[tool-observer] after_tool_call hook registered');
  return true;
}

// ——— Internals ———

/**
 * 解析 Hook 注册函数。
 * 优先使用 api.onHook()，回退到 (api as any).on()。
 */
function resolveHookRegistration(
  api: OpenClawPluginApi,
): ((hookName: string, handler: (payload: Record<string, unknown>) => void) => void) | null {
  if (typeof api.onHook === 'function') {
    return (name, handler) => api.onHook!(name, handler);
  }
  // Fallback: OpenClaw 部分版本使用 .on() 统一注册 Hook
  const anyApi = api as unknown as Record<string, unknown>;
  if (typeof anyApi['on'] === 'function' && anyApi['on'] !== api.onEvent) {
    return (name, handler) => (anyApi['on'] as Function)(name, handler);
  }
  return null;
}

/** 从工具 input 中提取文件路径 */
function extractPath(input: Record<string, unknown>): string | null {
  // OpenClaw 原生工具的路径字段名
  const candidates = ['file_path', 'path', 'filePath', 'command'];
  for (const key of candidates) {
    const val = input[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return null;
}

/** 判断是否为写入 AIDA 数据目录的原生文件操作 */
function isAidaDataWrite(
  tool: string,
  input: Record<string, unknown>,
  aidaDataDir: string,
): boolean {
  if (!NATIVE_WRITE_TOOLS.has(tool)) return false;

  const filePath = extractPath(input);
  if (!filePath) return false;

  // exec 工具：检查 command 是否包含对 AIDA 目录的写操作
  if (tool === 'exec') {
    const cmd = typeof input['command'] === 'string' ? input['command'] : '';
    return (cmd.includes(aidaDataDir) || cmd.includes(AIDA_DIR + '/')) &&
           /(>>?|[^a-z]tee\b|\bcp\b|\bmv\b|\brm\b)/.test(cmd);
  }

  // write/edit/apply_patch：检查目标路径
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  return resolved.startsWith(aidaDataDir + path.sep) || resolved === aidaDataDir;
}

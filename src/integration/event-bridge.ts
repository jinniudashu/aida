import type { ProcessTracker } from '../engine/process-tracker.js';
import type { ProcessStore } from '../store/process-store.js';
import type { OpenClawPluginApi, OpenClawLogger, SubagentEndedOutcome } from './openclaw-types.js';

/**
 * BpsEventBridge — 双向事件桥接
 *
 * BPS → OpenClaw: 监听 ProcessTracker 事件，转发到 Gateway
 * OpenClaw → BPS: 监听 subagent.ended，处理 Agent 完成/失败
 */
export class BpsEventBridge {
  constructor(
    private api: OpenClawPluginApi,
    private tracker: ProcessTracker,
    private processStore: ProcessStore,
    private logger?: OpenClawLogger,
  ) {}

  /** 建立双向桥接 */
  setup(): void {
    this.setupBpsToOpenClaw();
    this.setupOpenClawToBps();
  }

  // ——— BPS → OpenClaw ———

  private setupBpsToOpenClaw(): void {
    this.tracker.on('task:created', (data) => {
      this.api.emitEvent('bps.task.created', data as unknown as Record<string, unknown>);
    });

    this.tracker.on('task:updated', (data) => {
      this.api.emitEvent('bps.task.updated', data as unknown as Record<string, unknown>);
    });

    this.tracker.on('task:completed', (data) => {
      this.api.emitEvent('bps.task.completed', data as unknown as Record<string, unknown>);
    });

    this.tracker.on('task:failed', (data) => {
      this.api.emitEvent('bps.task.failed', data as unknown as Record<string, unknown>);
    });
  }

  // ——— OpenClaw → BPS ———

  private setupOpenClawToBps(): void {
    this.api.onEvent('subagent.ended', async (payload) => {
      await this.handleSubagentEnded(payload);
    });
  }

  /**
   * 处理 Agent 结束事件
   *
   * outcome=ok → completeTask
   * outcome=error/timeout → failTask
   * outcome=killed → failTask (with reason)
   */
  private async handleSubagentEnded(payload: Record<string, unknown>): Promise<void> {
    const sessionKey = payload['sessionKey'] as string | undefined;
    const outcome = payload['outcome'] as SubagentEndedOutcome | undefined;

    if (!sessionKey) {
      this.logger?.warn('subagent.ended event missing sessionKey', payload);
      return;
    }

    const process = this.processStore.findBySessionKey(sessionKey);
    if (!process) {
      this.logger?.debug('No BPS task found for session', { sessionKey });
      return;
    }

    // Already in terminal state
    if (process.state === 'COMPLETED' || process.state === 'FAILED') {
      this.logger?.debug('Task already in terminal state', {
        taskId: process.id,
        state: process.state,
      });
      return;
    }

    this.logger?.info('Handling subagent.ended for BPS task', {
      taskId: process.id,
      outcome,
      currentState: process.state,
    });

    try {
      switch (outcome) {
        case 'ok': {
          this.tracker.completeTask(process.id);
          break;
        }
        case 'error':
        case 'timeout': {
          this.tracker.failTask(process.id, `Agent ended with outcome: ${outcome}`);
          break;
        }
        case 'killed': {
          this.tracker.failTask(process.id, 'Agent killed');
          break;
        }
        default: {
          this.tracker.failTask(process.id, `Agent ended with unexpected outcome: ${outcome}`);
          break;
        }
      }
    } catch (err) {
      this.logger?.error('Failed to handle subagent.ended', {
        taskId: process.id,
        error: String(err),
      });
    }
  }
}

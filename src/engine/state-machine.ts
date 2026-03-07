import { VALID_TRANSITIONS } from '../schema/process.js';

export class BpsStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BpsStateError';
  }
}

/**
 * 任务状态机约束（5 态模型）
 * OPEN → IN_PROGRESS → COMPLETED/FAILED/BLOCKED
 */
export class ProcessStateMachine {
  static canTransition(from: string, to: string): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  static assertTransition(from: string, to: string): void {
    if (!this.canTransition(from, to)) {
      const allowed = VALID_TRANSITIONS[from];
      throw new BpsStateError(
        `Invalid state transition: ${from} → ${to}. Allowed: [${allowed?.join(', ') ?? 'none'}]`
      );
    }
  }

  static terminalStates(): readonly string[] {
    return ['COMPLETED', 'FAILED'];
  }

  static isTerminal(state: string): boolean {
    return this.terminalStates().includes(state);
  }
}

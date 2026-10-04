// Dependency-free so the SpacetimeDB module can import it directly.

export const TASK_CHANNELS = ['browser', 'email', 'phone'] as const;
export type TaskChannel = (typeof TASK_CHANNELS)[number];

export const TASK_STATUSES = ['REQUESTED', 'RUNNING', 'WAITING_FOR_USER', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const TERMINAL: readonly TaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  REQUESTED: ['RUNNING'],
  RUNNING: ['WAITING_FOR_USER', 'COMPLETED'],
  WAITING_FOR_USER: ['RUNNING', 'COMPLETED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskChannel(value: string): value is TaskChannel {
  return (TASK_CHANNELS as readonly string[]).includes(value);
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return TERMINAL.includes(status);
}

/** Same-state is allowed (idempotent). Any live task may fail or be cancelled. */
export function canTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  if (isTaskTerminal(from)) return false;
  if (to === 'FAILED' || to === 'CANCELLED') return true;
  return TRANSITIONS[from].includes(to);
}

export const TASK_EVENT_KINDS = ['info', 'action', 'wait', 'success', 'error'] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

/** Parameters for a browser return task (stored as JSON in support_task.paramsJson). */
export interface ReturnTaskParams {
  /** What to return, e.g. "Logitech wireless mouse". Matched against order history. */
  item: string;
  /** Why, e.g. "scroll wheel is broken". Mapped to the store's return reasons. */
  reason: string;
  orderNumber?: string;
  /** Let the agent click the final "Confirm your return" itself. Default: wait for approval. */
  autoConfirm?: boolean;
}

import type { SupportTask } from '@holdless/db';
import { isTaskTerminal, type ReturnTaskParams, type TaskStatus } from '@holdless/shared';
import { AgentStop, AmazonReturnAgent, type AgentOptions } from '../browser/amazon-return';
import { log } from '../log';

/** What the manager needs from SpacetimeDB (SpacetimeStore implements it). */
export interface TaskStore {
  allTasks(): SupportTask[];
  getTask(taskId: bigint): SupportTask | null;
  claimTask(taskId: bigint): Promise<void>;
  updateTask(taskId: bigint, status: string, step: string, summary: string): Promise<void>;
  taskEvent(taskId: bigint, kind: string, title: string, description?: string): Promise<void>;
  completeTask(taskId: bigint, summary: string, result: string): Promise<void>;
  failTask(taskId: bigint, errorMessage: string, cancelled?: boolean): Promise<void>;
}

export interface TaskManagerOptions {
  baseUrl: string;
  openSession: AgentOptions['openSession'];
  userWaitMs: number;
  assist?: AgentOptions['assist'];
  lingerMs?: number;
}

export interface TaskArtifacts {
  screen?: Buffer;
  confirmation?: Buffer;
  qr?: Buffer;
}

export function parseReturnParams(task: SupportTask): ReturnTaskParams {
  let raw: Partial<ReturnTaskParams> = {};
  try {
    raw = JSON.parse(task.paramsJson || '{}');
  } catch {}
  const item = String(raw.item ?? task.query).trim().slice(0, 200);
  const reason = String(raw.reason ?? '').trim().slice(0, 250) || task.query.slice(0, 250);
  const orderNumber = raw.orderNumber ? String(raw.orderNumber).trim().slice(0, 40) : undefined;
  return { item, reason, orderNumber, autoConfirm: raw.autoConfirm === true };
}

/**
 * Runs browser tasks one at a time (the agent's Chrome profile can only be open
 * once). SpacetimeDB is the queue: REQUESTED rows are claimed in order, and every
 * status change / step is written back for the UI to subscribe to.
 */
export class TaskManager {
  private queue: bigint[] = [];
  private running: bigint | null = null;
  readonly artifacts = new Map<bigint, TaskArtifacts>();

  constructor(
    private readonly store: TaskStore,
    private readonly opts: TaskManagerOptions,
  ) {}

  /** Call once on startup: queue pending requests, close out tasks orphaned by a restart. */
  resume() {
    for (const task of this.store.allTasks().sort((a, b) => Number(a.id - b.id))) {
      if (task.status === 'REQUESTED') this.enqueue(task);
      else if (!isTaskTerminal(task.status as TaskStatus) && task.channel === 'browser') {
        void this.store.failTask(task.id, 'The agent restarted while this task was running. Please start it again.');
      }
    }
  }

  enqueue(task: SupportTask) {
    if (task.channel !== 'browser' || task.status !== 'REQUESTED') return;
    if (this.queue.includes(task.id) || this.running === task.id) return;
    this.queue.push(task.id);
    void this.pump();
  }

  /** Resolves when nothing is queued or running (tests). */
  async idle() {
    while (this.running !== null || this.queue.length) await new Promise((r) => setTimeout(r, 50));
  }

  private async pump() {
    if (this.running !== null) return;
    const id = this.queue.shift();
    if (id === undefined) return;
    this.running = id;
    try {
      await this.run(id);
    } catch (err) {
      log.error(`task ${id}: ${(err as Error).stack ?? err}`);
    } finally {
      this.running = null;
      void this.pump();
    }
  }

  private async run(taskId: bigint) {
    const task = this.store.getTask(taskId);
    if (!task || task.status !== 'REQUESTED') return;
    try {
      await this.store.claimTask(taskId);
    } catch (err) {
      log.warn(`could not claim task ${taskId}: ${(err as Error).message}`);
      return;
    }
    if (!/amazon/i.test(task.provider)) {
      await this.store.failTask(taskId, `Browser returns are only supported for Amazon right now (got "${task.provider}").`);
      return;
    }
    const params = parseReturnParams(task);
    log.info(`task ${taskId}: Amazon return for "${params.item}" (${params.autoConfirm ? 'auto-confirm' : 'asks before submitting'})`);
    const artifacts: TaskArtifacts = {};
    this.artifacts.set(taskId, artifacts);
    const agent = new AmazonReturnAgent(
      params,
      {
        status: (status, step, summary) => this.store.updateTask(taskId, status, step, summary),
        event: (kind, title, description) => this.store.taskEvent(taskId, kind, title, description ?? ''),
        screenshot: (png) => (artifacts.screen = png),
        approved: () => !!this.store.getTask(taskId)?.approveRequested,
        cancelled: () => !!this.store.getTask(taskId)?.cancelRequested,
      },
      { baseUrl: this.opts.baseUrl, openSession: this.opts.openSession, userWaitMs: this.opts.userWaitMs, assist: this.opts.assist, lingerMs: this.opts.lingerMs },
    );
    try {
      const outcome = await agent.run();
      artifacts.confirmation = outcome.confirmationPng;
      artifacts.qr = outcome.qrPng;
      await this.store.completeTask(taskId, outcome.summary, outcome.details.join('\n') || 'Return submitted.');
    } catch (err) {
      const cancelled = !!this.store.getTask(taskId)?.cancelRequested;
      const message = err instanceof AgentStop ? err.message : `Browser agent error: ${(err as Error).message}`;
      await this.store.failTask(taskId, cancelled ? 'You cancelled the return.' : message, cancelled);
    }
  }
}

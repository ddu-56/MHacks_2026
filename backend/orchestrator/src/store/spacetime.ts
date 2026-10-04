import fs from 'node:fs';
import path from 'node:path';
import { DbConnection, type CallSession, type SupportTask, type TaskEvent } from '@holdless/db';
import type { CallStatus } from '@holdless/shared';
import { config } from '../config';
import { log } from '../log';
import type { CallSnapshot, CallStore, EventInput } from './types';

const tokenFile = path.join(config.dataDir, 'spacetime-token');

function readToken(): string | undefined {
  try {
    return fs.readFileSync(tokenFile, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token: string) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(tokenFile, token);
}

export interface SpacetimeHandlers {
  onCallInserted(call: CallSession): void;
  onCallUpdated(prev: CallSession, next: CallSession): void;
  onTaskInserted?(task: SupportTask): void;
  onTaskUpdated?(prev: SupportTask, next: SupportTask): void;
}

export class SpacetimeStore implements CallStore {
  private constructor(private readonly conn: DbConnection) {}

  static connect(handlers: SpacetimeHandlers): Promise<SpacetimeStore> {
    return new Promise((resolve, reject) => {
      const conn = DbConnection.builder()
        .withUri(config.spacetime.host)
        .withDatabaseName(config.spacetime.module)
        .withToken(readToken())
        .onConnect((c, identity, token) => {
          saveToken(token);
          log.info(`SpacetimeDB connected as ${identity.toHexString().slice(0, 12)}…`);
          c.db.callSession.onInsert((_ctx, row) => handlers.onCallInserted(row));
          c.db.callSession.onUpdate((_ctx, prev, next) => handlers.onCallUpdated(prev, next));
          c.db.supportTask.onInsert((_ctx, row) => handlers.onTaskInserted?.(row));
          c.db.supportTask.onUpdate((_ctx, prev, next) => handlers.onTaskUpdated?.(prev, next));
          c.subscriptionBuilder()
            .onApplied(() => resolve(new SpacetimeStore(c)))
            .onError((ctx) => reject(ctx.event ?? new Error('Subscription failed')))
            .subscribe([
              'SELECT * FROM call_session',
              'SELECT * FROM user_context',
              'SELECT * FROM support_task',
              'SELECT * FROM task_event',
            ]);
        })
        .onConnectError((_ctx, err) => reject(err))
        .onDisconnect(() => {
          log.error('SpacetimeDB disconnected; exiting so the supervisor can restart us');
          process.exit(1);
        })
        .build();
      void conn;
    });
  }

  get reducers() {
    return this.conn.reducers;
  }

  allCalls(): CallSession[] {
    return [...this.conn.db.callSession.iter()];
  }

  getCall(callId: bigint): CallSnapshot | null {
    const row = this.conn.db.callSession.id.find(callId);
    if (!row) return null;
    const ctx = [...this.conn.db.userContext.iter()]
      .filter((c) => c.callId === callId)
      .map((c) => c.value)
      .join('\n');
    return {
      id: row.id,
      companyName: row.companyName,
      phoneNumber: row.phoneNumber,
      userGoal: row.userGoal,
      userPhoneNumber: row.userPhoneNumber,
      userContext: ctx,
      status: row.status as CallStatus,
      demo: row.demo,
      cancelRequested: row.cancelRequested,
    };
  }

  private async call(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      log.warn(`reducer ${name} rejected: ${(err as Error).message ?? err}`);
    }
  }

  async register(info: {
    mode: string;
    demoMode: boolean;
    reasoning: string;
    voice: string;
    demoSupportNumber: string;
    demoUserNumber: string;
  }) {
    await this.conn.reducers.registerOrchestrator({ ...info, version: '0.1.0' });
  }

  heartbeat() {
    return this.call('heartbeat', () => this.conn.reducers.heartbeat({}));
  }

  claim(callId: bigint, mode: string) {
    return this.conn.reducers.claimCall({ callId, mode });
  }

  setStatus(callId: bigint, status: CallStatus, opts: { menuContext?: string; summary?: string } = {}) {
    return this.call(`updateCallStatus(${status})`, () =>
      this.conn.reducers.updateCallStatus({ callId, status, menuContext: opts.menuContext, summary: opts.summary }),
    );
  }

  event(callId: bigint, e: EventInput) {
    return this.call('appendCallEvent', () =>
      this.conn.reducers.appendCallEvent({
        callId,
        type: e.type,
        actor: e.actor,
        title: e.title,
        description: e.description ?? '',
        metadata: e.metadata ? JSON.stringify(e.metadata) : '',
        dedupeKey: e.dedupeKey ?? '',
      }),
    );
  }

  transcript(callId: bigint, speakerType: string, text: string, confidence: number) {
    return this.call('appendTranscript', () => this.conn.reducers.appendTranscript({ callId, speakerType, text, confidence }));
  }

  action(callId: bigint, a: Parameters<CallStore['action']>[1]) {
    return this.call('recordAgentAction', () => this.conn.reducers.recordAgentAction({ callId, ...a }));
  }

  agent(callId: bigint, status: string, currentTask: string) {
    return this.call('setAgentStatus', () => this.conn.reducers.setAgentStatus({ callId, status, currentTask }));
  }

  humanConfidence(callId: bigint, confidence: number) {
    return this.call('updateHumanConfidence', () => this.conn.reducers.updateHumanConfidence({ callId, confidence }));
  }

  humanDetected(callId: bigint, confidence: number, evidence: string) {
    return this.call('markHumanDetected', () => this.conn.reducers.markHumanDetected({ callId, confidence, evidence }));
  }

  userConnected(callId: bigint) {
    return this.call('markUserConnected', () => this.conn.reducers.markUserConnected({ callId }));
  }

  sids(callId: bigint, s: { supportCallSid?: string; userCallSid?: string }) {
    return this.call('setCallSids', () =>
      this.conn.reducers.setCallSids({ callId, supportCallSid: s.supportCallSid, userCallSid: s.userCallSid }),
    );
  }

  complete(callId: bigint, summary: string) {
    return this.call('completeCall', () => this.conn.reducers.completeCall({ callId, summary }));
  }

  fail(callId: bigint, errorMessage: string) {
    return this.call('failCall', () => this.conn.reducers.failCall({ callId, errorMessage }));
  }

  // --- Support tasks -------------------------------------------------------

  allTasks(): SupportTask[] {
    return [...this.conn.db.supportTask.iter()];
  }

  getTask(taskId: bigint): SupportTask | null {
    return this.conn.db.supportTask.id.find(taskId) ?? null;
  }

  taskEvents(taskId: bigint): TaskEvent[] {
    return [...this.conn.db.taskEvent.iter()].filter((e) => e.taskId === taskId);
  }

  claimTask(taskId: bigint) {
    return this.conn.reducers.claimTask({ taskId });
  }

  updateTask(taskId: bigint, status: string, step: string, summary: string) {
    return this.call(`updateTask(${status})`, () => this.conn.reducers.updateTask({ taskId, status, step, summary }));
  }

  taskEvent(taskId: bigint, kind: string, title: string, description = '') {
    return this.call('appendTaskEvent', () => this.conn.reducers.appendTaskEvent({ taskId, kind, title, description }));
  }

  completeTask(taskId: bigint, summary: string, result: string) {
    return this.call('completeTask', () => this.conn.reducers.completeTask({ taskId, summary, result }));
  }

  failTask(taskId: bigint, errorMessage: string, cancelled = false) {
    return this.call('failTask', () => this.conn.reducers.failTask({ taskId, errorMessage, cancelled }));
  }
}

import { canTransition, type CallStatus } from '@holdless/shared';
import type { ActionInput, CallSnapshot, CallStore, EventInput } from './types';

/** In-memory CallStore with the same transition rules as the SpacetimeDB module. Used by tests. */
export class MemoryStore implements CallStore {
  calls = new Map<bigint, CallSnapshot & { humanConfidence: number; menuContext: string }>();
  events: Array<EventInput & { callId: bigint }> = [];
  transcripts: Array<{ callId: bigint; speakerType: string; text: string }> = [];
  actions: Array<ActionInput & { callId: bigint }> = [];
  statusHistory: CallStatus[] = [];
  private seenDedupe = new Set<string>();

  addCall(snapshot: Omit<CallSnapshot, 'status' | 'cancelRequested'>) {
    this.calls.set(snapshot.id, { ...snapshot, status: 'REQUESTED', cancelRequested: false, humanConfidence: 0, menuContext: '' });
  }

  getCall(callId: bigint) {
    return this.calls.get(callId) ?? null;
  }

  private move(callId: bigint, to: CallStatus) {
    const call = this.calls.get(callId);
    if (!call) throw new Error(`no call ${callId}`);
    if (!canTransition(call.status, to)) throw new Error(`Illegal transition ${call.status} -> ${to}`);
    if (call.status !== to) this.statusHistory.push(to);
    call.status = to;
  }

  async claim(callId: bigint) {
    this.move(callId, 'PREPARING');
  }
  async setStatus(callId: bigint, status: CallStatus, opts: { menuContext?: string } = {}) {
    this.move(callId, status);
    if (opts.menuContext !== undefined) this.calls.get(callId)!.menuContext = opts.menuContext;
  }
  async event(callId: bigint, e: EventInput) {
    if (e.dedupeKey) {
      const key = `${callId}:${e.dedupeKey}`;
      if (this.seenDedupe.has(key)) return;
      this.seenDedupe.add(key);
    }
    this.events.push({ ...e, callId });
  }
  async transcript(callId: bigint, speakerType: string, text: string) {
    this.transcripts.push({ callId, speakerType, text });
  }
  async action(callId: bigint, a: ActionInput) {
    this.actions.push({ ...a, callId });
  }
  async agent() {}
  async humanConfidence(callId: bigint, confidence: number) {
    this.calls.get(callId)!.humanConfidence = confidence;
  }
  async humanDetected(callId: bigint, confidence: number, evidence: string) {
    if (this.calls.get(callId)!.status === 'HUMAN_DETECTED') return;
    this.move(callId, 'HUMAN_DETECTED');
    this.calls.get(callId)!.humanConfidence = confidence;
    await this.event(callId, { type: 'HUMAN_DETECTED', actor: 'AI', title: 'Representative detected', description: evidence });
  }
  async userConnected(callId: bigint) {
    this.move(callId, 'USER_CONNECTED');
    await this.event(callId, { type: 'USER_CONNECTED', actor: 'USER', title: 'You joined the call' });
  }
  async sids() {}
  async complete(callId: bigint, summary: string) {
    this.move(callId, 'COMPLETED');
    await this.event(callId, { type: 'CALL_COMPLETED', actor: 'SYSTEM', title: 'Call ended', description: summary });
  }
  async fail(callId: bigint, errorMessage: string) {
    const call = this.calls.get(callId);
    if (call?.status === 'FAILED' || call?.status === 'COMPLETED') return;
    this.move(callId, 'FAILED');
    await this.event(callId, { type: 'CALL_FAILED', actor: 'SYSTEM', title: 'Call failed', description: errorMessage });
  }
}

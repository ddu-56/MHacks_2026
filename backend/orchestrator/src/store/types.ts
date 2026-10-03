import type { ActionStatus, ActionType, Actor, AgentStatusValue, CallStatus, EventType, SpeakerType } from '@holdless/shared';

export interface CallSnapshot {
  id: bigint;
  companyName: string;
  phoneNumber: string;
  userGoal: string;
  userPhoneNumber: string;
  userContext: string;
  status: CallStatus;
  demo: boolean;
  cancelRequested: boolean;
}

export interface EventInput {
  type: EventType;
  actor: Actor;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface ActionInput {
  actionType: ActionType;
  reasoningSummary: string;
  actionValue: string;
  confidence: number;
  status: ActionStatus;
}

/** Everything the call runner is allowed to do to shared state. Backed by SpacetimeDB reducers in production. */
export interface CallStore {
  getCall(callId: bigint): CallSnapshot | null;
  claim(callId: bigint, mode: string): Promise<void>;
  setStatus(callId: bigint, status: CallStatus, opts?: { menuContext?: string; summary?: string }): Promise<void>;
  event(callId: bigint, e: EventInput): Promise<void>;
  transcript(callId: bigint, speakerType: SpeakerType, text: string, confidence: number): Promise<void>;
  action(callId: bigint, a: ActionInput): Promise<void>;
  agent(callId: bigint, status: AgentStatusValue, task: string): Promise<void>;
  humanConfidence(callId: bigint, confidence: number): Promise<void>;
  humanDetected(callId: bigint, confidence: number, evidence: string): Promise<void>;
  userConnected(callId: bigint): Promise<void>;
  sids(callId: bigint, sids: { supportCallSid?: string; userCallSid?: string }): Promise<void>;
  complete(callId: bigint, summary: string): Promise<void>;
  fail(callId: bigint, errorMessage: string): Promise<void>;
}

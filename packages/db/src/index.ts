export * from './bindings';
export type {
  AgentStatus,
  CallAction,
  CallEvent,
  CallSession,
  Orchestrator,
  TranscriptSegment,
  UserContext,
} from './bindings/types';

import type { Timestamp } from 'spacetimedb';

export function tsToMillis(ts: Timestamp | undefined | null): number | null {
  return ts ? Number(ts.microsSinceUnixEpoch / 1000n) : null;
}

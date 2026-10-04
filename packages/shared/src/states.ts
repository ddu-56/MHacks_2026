// Dependency-free so the SpacetimeDB module can import it directly.

export const CALL_STATUSES = [
  'REQUESTED',
  'PREPARING',
  'DIALING',
  'CONNECTED_TO_IVR',
  'LISTENING',
  'REASONING',
  'SENDING_DTMF',
  'SPEAKING',
  'NAVIGATING_MENU',
  'ON_HOLD',
  'POSSIBLE_HUMAN',
  'HUMAN_DETECTED',
  'CALLING_USER',
  'BRIDGING_USER',
  'USER_CONNECTED',
  'COMPLETED',
  'FAILED',
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const TERMINAL_STATUSES: readonly CallStatus[] = ['COMPLETED', 'FAILED'];

const IVR_LOOP: CallStatus[] = ['LISTENING', 'REASONING', 'SENDING_DTMF', 'SPEAKING', 'NAVIGATING_MENU'];
// CALLING_USER directly (without HUMAN_DETECTED) is the "verification needed, hand off to the user" path.
// DIALING again = calling back after a dropped or hung-up call.
const AFTER_IVR: CallStatus[] = ['ON_HOLD', 'POSSIBLE_HUMAN', 'HUMAN_DETECTED', 'CALLING_USER', 'DIALING'];

const TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  REQUESTED: ['PREPARING', 'DIALING'],
  PREPARING: ['DIALING'],
  DIALING: ['CONNECTED_TO_IVR', 'DIALING'],
  CONNECTED_TO_IVR: [...IVR_LOOP, ...AFTER_IVR],
  LISTENING: [...IVR_LOOP, ...AFTER_IVR],
  REASONING: [...IVR_LOOP, ...AFTER_IVR],
  SENDING_DTMF: [...IVR_LOOP, ...AFTER_IVR],
  SPEAKING: [...IVR_LOOP, ...AFTER_IVR],
  NAVIGATING_MENU: [...IVR_LOOP, ...AFTER_IVR],
  ON_HOLD: ['LISTENING', 'REASONING', 'SENDING_DTMF', 'SPEAKING', 'POSSIBLE_HUMAN', 'HUMAN_DETECTED', 'CALLING_USER', 'DIALING'],
  POSSIBLE_HUMAN: ['ON_HOLD', 'LISTENING', 'REASONING', 'SENDING_DTMF', 'SPEAKING', 'HUMAN_DETECTED', 'CALLING_USER', 'DIALING'],
  HUMAN_DETECTED: ['CALLING_USER'],
  CALLING_USER: ['BRIDGING_USER'],
  BRIDGING_USER: ['USER_CONNECTED'],
  USER_CONNECTED: ['COMPLETED'],
  COMPLETED: [],
  FAILED: [],
};

export function isCallStatus(value: string): value is CallStatus {
  return (CALL_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: CallStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Same-state is allowed (idempotent). Any live call may end in COMPLETED or FAILED. */
export function canTransition(from: CallStatus, to: CallStatus): boolean {
  if (from === to) return true;
  if (isTerminal(from)) return false;
  if (to === 'FAILED' || to === 'COMPLETED') return true;
  return TRANSITIONS[from].includes(to);
}

/** Coarse phases used by the progress stepper. */
export const PHASES = ['Requested', 'Dialing', 'Navigating IVR', 'Waiting', 'Human found', 'Connected'] as const;
export type Phase = (typeof PHASES)[number];

export function phaseOf(status: CallStatus): number {
  switch (status) {
    case 'REQUESTED':
    case 'PREPARING':
      return 0;
    case 'DIALING':
      return 1;
    case 'CONNECTED_TO_IVR':
    case 'LISTENING':
    case 'REASONING':
    case 'SENDING_DTMF':
    case 'SPEAKING':
    case 'NAVIGATING_MENU':
      return 2;
    case 'ON_HOLD':
    case 'POSSIBLE_HUMAN':
      return 3;
    case 'HUMAN_DETECTED':
    case 'CALLING_USER':
    case 'BRIDGING_USER':
      return 4;
    case 'USER_CONNECTED':
    case 'COMPLETED':
      return 5;
    case 'FAILED':
      return -1;
  }
}

export const STATUS_LABELS: Record<CallStatus, string> = {
  REQUESTED: 'Requested',
  PREPARING: 'Preparing',
  DIALING: 'Dialing',
  CONNECTED_TO_IVR: 'Connected to IVR',
  LISTENING: 'Listening',
  REASONING: 'Reasoning',
  SENDING_DTMF: 'Pressing keys',
  SPEAKING: 'Speaking',
  NAVIGATING_MENU: 'Navigating menu',
  ON_HOLD: 'On hold',
  POSSIBLE_HUMAN: 'Possible human',
  HUMAN_DETECTED: 'Representative found',
  CALLING_USER: 'Calling you',
  BRIDGING_USER: 'Bridging',
  USER_CONNECTED: 'You are connected',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

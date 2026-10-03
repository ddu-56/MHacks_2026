export const EVENT_TYPES = [
  'CALL_REQUESTED',
  'OUTBOUND_CALL_STARTED',
  'IVR_DETECTED',
  'TRANSCRIPT_RECEIVED',
  'MENU_OPTION_IDENTIFIED',
  'DTMF_SENT',
  'SPOKE',
  'HOLD_DETECTED',
  'HUMAN_SUSPECTED',
  'HUMAN_DETECTED',
  'USER_CALLED',
  'USER_CONNECTED',
  'CALL_COMPLETED',
  'CALL_FAILED',
  'LOW_CONFIDENCE',
  'HANDOFF_REQUIRED',
  'INFO',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ACTORS = ['SYSTEM', 'AI', 'IVR', 'HUMAN_REP', 'USER', 'TELEPHONY'] as const;
export type Actor = (typeof ACTORS)[number];

export const SPEAKER_TYPES = ['AUTOMATED_SYSTEM', 'UNKNOWN', 'HUMAN_REP', 'AI', 'USER'] as const;
export type SpeakerType = (typeof SPEAKER_TYPES)[number];

export const ACTION_TYPES = ['WAIT', 'PRESS_KEY', 'SPEAK', 'TRANSFER_TO_USER', 'END_CALL'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = ['PLANNED', 'EXECUTED', 'SKIPPED', 'FAILED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const SITUATIONS = ['MENU', 'HOLD', 'HUMAN', 'INFO_REQUEST', 'VERIFICATION', 'OTHER'] as const;
export type Situation = (typeof SITUATIONS)[number];

export const AGENT_STATUSES = ['IDLE', 'LISTENING', 'THINKING', 'ACTING', 'WAITING', 'HANDING_OFF', 'DONE', 'ERROR'] as const;
export type AgentStatusValue = (typeof AGENT_STATUSES)[number];

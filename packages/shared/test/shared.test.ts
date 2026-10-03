import { describe, expect, it } from 'vitest';
import { canTransition, CALL_STATUSES, offeredKeys, parseRequestText, phaseOf, validateDecision } from '../src';

const ctx = { transcript: 'For sales, press 1. For technical support, press 2. For billing, press 3.', userContext: 'Account 55512' };
const base = { situation: 'MENU', action: 'PRESS_KEY', value: '3', confidence: 0.95, humanLikelihood: 0, explanation: 'Billing matches.' };

describe('validateDecision', () => {
  it('accepts a valid offered key', () => {
    const r = validateDecision(base, ctx);
    expect(r.ok).toBe(true);
    expect(r.decision.value).toBe('3');
  });
  it('rejects malformed output and degrades to WAIT', () => {
    for (const bad of [null, 'press 3', { ...base, action: 'HACK' }, { ...base, confidence: 3 }, { ...base, explanation: '' }]) {
      const r = validateDecision(bad, ctx);
      expect(r.ok).toBe(false);
      expect(r.decision.action).toBe('WAIT');
    }
  });
  it('rejects keys the menu never offered', () => {
    expect(validateDecision({ ...base, value: '7' }, ctx).ok).toBe(false);
  });
  it('rejects low-confidence key presses', () => {
    expect(validateDecision({ ...base, confidence: 0.4 }, ctx).ok).toBe(false);
  });
  it('rejects non-digit key sequences', () => {
    expect(validateDecision({ ...base, value: '3; rm -rf' }, ctx).ok).toBe(false);
  });
  it('only enters multi-digit numbers the user provided', () => {
    const t = { transcript: 'Please enter your account number.', userContext: 'Account 55512' };
    expect(validateDecision({ ...base, situation: 'INFO_REQUEST', value: '55512' }, t).ok).toBe(true);
    expect(validateDecision({ ...base, situation: 'INFO_REQUEST', value: '1234' }, t).ok).toBe(false);
  });
  it('refuses to speak credentials or unprovided numbers', () => {
    const speak = { ...base, action: 'SPEAK', situation: 'INFO_REQUEST' };
    expect(validateDecision({ ...speak, value: 'My PIN is 1234' }, ctx).ok).toBe(false);
    expect(validateDecision({ ...speak, value: 'Account 99999' }, ctx).ok).toBe(false);
    expect(validateDecision({ ...speak, value: 'Account 55512' }, ctx).ok).toBe(true);
  });
  it('blanks value for non-keypress actions', () => {
    expect(validateDecision({ ...base, action: 'WAIT', value: '9' }, ctx).decision.value).toBe('');
  });
});

describe('offeredKeys', () => {
  it('reads numerals and spoken digits', () => {
    expect(offeredKeys(ctx.transcript).sort()).toEqual(['1', '2', '3']);
    expect(offeredKeys('To dispute a charge, press two. Press star to repeat.').sort()).toEqual(['*', '2']);
  });
});

describe('state machine', () => {
  it('allows the happy path', () => {
    const path = ['REQUESTED', 'PREPARING', 'DIALING', 'CONNECTED_TO_IVR', 'LISTENING', 'REASONING', 'SENDING_DTMF', 'NAVIGATING_MENU', 'REASONING', 'ON_HOLD', 'POSSIBLE_HUMAN', 'HUMAN_DETECTED', 'CALLING_USER', 'BRIDGING_USER', 'USER_CONNECTED', 'COMPLETED'] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i]), `${path[i - 1]}->${path[i]}`).toBe(true);
  });
  it('blocks skipping the handoff and leaving terminal states', () => {
    expect(canTransition('ON_HOLD', 'USER_CONNECTED')).toBe(false);
    expect(canTransition('DIALING', 'ON_HOLD')).toBe(false);
    expect(canTransition('HUMAN_DETECTED', 'ON_HOLD')).toBe(false);
    expect(canTransition('COMPLETED', 'FAILED')).toBe(false);
    expect(canTransition('FAILED', 'DIALING')).toBe(false);
  });
  it('lets any live state fail or complete, and is idempotent', () => {
    for (const s of CALL_STATUSES) {
      if (s === 'COMPLETED' || s === 'FAILED') continue;
      expect(canTransition(s, 'FAILED')).toBe(true);
      expect(canTransition(s, s)).toBe(true);
    }
  });
  it('maps every status to a phase', () => {
    expect(phaseOf('ON_HOLD')).toBe(3);
    expect(phaseOf('USER_CONNECTED')).toBe(5);
  });
});

describe('parseRequestText', () => {
  it('parses the canonical demo request', () => {
    expect(parseRequestText('Get me a human at Wolverine Wireless about an incorrect charge.')).toEqual({
      companyName: 'Wolverine Wireless',
      userGoal: 'Talk to someone about an incorrect charge.',
    });
  });
  it('parses "call X and get me to Y about Z"', () => {
    expect(parseRequestText('Call Delta and get me to customer service about a cancelled flight')?.companyName).toBe('Delta');
  });
  it('returns null when it cannot tell', () => {
    expect(parseRequestText('hello')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { WOLVERINE_HOLD_ANNOUNCEMENTS, WOLVERINE_IVR, WOLVERINE_REP_GREETING, ivrPromptFor, validateDecision } from '@holdless/shared';
import { GeminiAgent, buildUserPrompt } from '../src/ai/gemini';
import { RuleBasedAgent, parseMenuOptions } from '../src/ai/rules';
import type { DecisionInput } from '../src/ai/types';
import { classifyHuman, combineConfidence, isHoldAnnouncement, scoreHumanLikelihood } from '../src/detection/human';
import { MemoryStore } from '../src/store/memory';

const GOAL = 'Talk to someone about an incorrect charge.';
const input = (transcript: string, onHold = false): DecisionInput => ({
  companyName: 'Wolverine Wireless',
  userGoal: GOAL,
  userContext: '',
  transcript,
  onHold,
  history: [],
});
const rules = new RuleBasedAgent();
const decide = (t: string, onHold = false) => validateDecision(rules.decideSync(input(t, onHold)), { transcript: t, userContext: '' });
const thresholds = { detected: 0.8, possible: 0.5 };

describe('menu parsing and decisions (spec scenario)', () => {
  it('parses Wolverine menus', () => {
    expect(parseMenuOptions(ivrPromptFor('main', true))).toEqual([
      { key: '1', label: 'sales' },
      { key: '2', label: 'technical support' },
      { key: '3', label: 'billing' },
    ]);
    expect(parseMenuOptions('Press 1 for English. Press two for Spanish.')).toEqual([
      { key: '1', label: 'english' },
      { key: '2', label: 'spanish' },
    ]);
  });
  it('Menu 1 -> 3 (Billing)', () => {
    const r = decide('For sales, press 1. For technical support, press 2. For billing, press 3.');
    expect(r.ok && r.decision.action === 'PRESS_KEY' && r.decision.value).toBe('3');
  });
  it('Menu 2 -> 2 (Dispute charge)', () => {
    const r = decide(WOLVERINE_IVR.billing!.prompt);
    expect(r.decision).toMatchObject({ action: 'PRESS_KEY', value: '2' });
    expect(r.decision.confidence).toBeGreaterThan(0.9);
  });
  it('"Please hold while we connect you." -> HOLD/WAIT', () => {
    expect(decide('Please hold while we connect you.').decision).toMatchObject({ situation: 'HOLD', action: 'WAIT' });
  });
  it('waits instead of guessing when nothing matches', () => {
    expect(decide('For new pet insurance, press 1. For travel, press 2.').decision.action).toBe('WAIT');
  });
  it('hands off verification instead of answering it', () => {
    expect(decide('Please enter your four digit PIN followed by the pound sign.').decision).toMatchObject({
      situation: 'VERIFICATION',
      action: 'TRANSFER_TO_USER',
    });
  });
});

describe('human detection', () => {
  const onHold = { wasOnHold: true, musicStopped: false, previousConfidence: 0 };
  it('Sarah greeting -> DETECTED', () => {
    const s = scoreHumanLikelihood('Hi, thanks for holding. My name is Sarah. How can I help you?', onHold);
    expect(classifyHuman(combineConfidence(s.score, null), s, thresholds)).toBe('DETECTED');
    expect(classifyHuman(combineConfidence(s.score, 0.95), s, thresholds)).toBe('DETECTED');
  });
  it('spec demo rep line detects', () => {
    const s = scoreHumanLikelihood(WOLVERINE_REP_GREETING, onHold);
    expect(classifyHuman(s.score, s, thresholds)).toBe('DETECTED');
  });
  it('a teammate saying "This is Mike from billing, how can I help?" detects', () => {
    const s = scoreHumanLikelihood('Hello, this is Mike from billing, how can I help?', onHold);
    expect(classifyHuman(s.score, s, thresholds)).toBe('DETECTED');
  });
  it('never treats hold announcements as human, even if the LLM is fooled', () => {
    for (const a of [...WOLVERINE_HOLD_ANNOUNCEMENTS, 'Thank you for holding. Your call is important to us.']) {
      const s = scoreHumanLikelihood(a, onHold);
      expect(classifyHuman(combineConfidence(s.score, 0.99), s, thresholds), a).toBe('CONTINUE');
      expect(isHoldAnnouncement(a)).toBe(true);
    }
  });
  it('a bare "Hello?" is only POSSIBLE, then a second cue confirms', () => {
    const first = scoreHumanLikelihood('Hello?', { ...onHold, musicStopped: true });
    const v1 = classifyHuman(first.score, first, thresholds);
    expect(v1).toBe('POSSIBLE');
    const second = scoreHumanLikelihood('Hello, are you there?', { ...onHold, previousConfidence: first.score });
    expect(classifyHuman(second.score, second, thresholds)).toBe('DETECTED');
  });
  it('weak LLM-only evidence does not bridge', () => {
    const s = scoreHumanLikelihood('Okay.', onHold);
    expect(classifyHuman(combineConfidence(s.score, 0.9), s, thresholds)).not.toBe('DETECTED');
  });
});

describe('Gemini agent', () => {
  const fakeAi = (impl: () => Promise<{ text: string }>) => ({ models: { generateContent: impl } }) as never;

  it('returns parsed structured output', async () => {
    const agent = new GeminiAgent(
      fakeAi(async () => ({ text: JSON.stringify({ situation: 'MENU', action: 'PRESS_KEY', value: '3', confidence: 0.97, humanLikelihood: 0, explanation: 'Billing best matches an incorrect charge.' }) })),
      'gemini-test',
      1000,
    );
    const out = await agent.decide(input('For billing, press 3.'));
    expect(out.source).toBe('gemini');
    expect(validateDecision(out.raw, { transcript: 'For billing, press 3.', userContext: '' }).ok).toBe(true);
  });
  it('falls back to rules on API errors', async () => {
    const agent = new GeminiAgent(fakeAi(async () => { throw new Error('503'); }), 'gemini-test', 1000);
    const out = await agent.decide(input(WOLVERINE_IVR.billing!.prompt));
    expect(out.source).toBe('rules');
    expect(out.note).toMatch(/fallback/);
    expect((out.raw as { value: string }).value).toBe('2');
  });
  it('builds a prompt with goal, context and transcript', () => {
    const p = buildUserPrompt({ ...input('For billing, press 3.'), history: [{ heard: 'Welcome', action: 'Waited' }] });
    expect(p).toContain(GOAL);
    expect(p).toContain('JUST HEARD: "For billing, press 3."');
    expect(p).toContain('You did: Waited');
  });
});

describe('duplicate event protection', () => {
  it('drops events with a repeated dedupe key', async () => {
    const store = new MemoryStore();
    store.addCall({ id: 1n, companyName: 'X', phoneNumber: '+1', userGoal: 'g', userPhoneNumber: '+1', userContext: '', demo: false });
    for (let i = 0; i < 3; i++) await store.event(1n, { type: 'HOLD_DETECTED', actor: 'AI', title: 'hold', dedupeKey: 'hold-detected' });
    expect(store.events).toHaveLength(1);
  });
});

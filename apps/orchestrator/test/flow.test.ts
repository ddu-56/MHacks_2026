import { describe, expect, it } from 'vitest';
import { DEMO_PROFILE } from '@holdless/shared';
import { RuleBasedAgent } from '../src/ai/rules';
import { CallRunner, type RunnerSettings } from '../src/runner';
import { MemoryStore } from '../src/store/memory';
import { MockTelephony } from '../src/telephony/mock';

const settings: RunnerSettings = {
  humanThreshold: 0.8,
  possibleHumanThreshold: 0.5,
  utteranceGapMs: 20,
  maxKeyPresses: 12,
  maxHoldMinutes: 1,
  userAnswerTimeoutSeconds: 5,
};

function setup(opts: { userAnswers?: boolean } = {}) {
  const store = new MemoryStore();
  store.addCall({
    id: 1n,
    companyName: DEMO_PROFILE.companyName,
    phoneNumber: DEMO_PROFILE.phoneNumber,
    userGoal: 'Talk to someone about an incorrect charge.',
    userPhoneNumber: '+15555550100',
    userContext: DEMO_PROFILE.userContext,
    demo: true,
  });
  const telephony = new MockTelephony({ timeScale: 0.01, holdSeconds: 8, holdAnnouncementSeconds: 3, ...opts });
  let finished = false;
  const runner = new CallRunner(store.getCall(1n)!, {
    store,
    telephony,
    agent: new RuleBasedAgent(),
    settings,
    onFinished: () => (finished = true),
  });
  return { store, runner, isFinished: () => finished };
}

async function until(pred: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('Wolverine Wireless end-to-end (mock telephony, rule-based reasoning)', () => {
  it('navigates Billing -> Dispute, holds, detects the rep and connects the user', async () => {
    const { store, runner } = setup();
    await store.claim(1n);
    await runner.start();
    await until(() => store.getCall(1n)!.status === 'USER_CONNECTED');

    const keys = store.actions.filter((a) => a.actionType === 'PRESS_KEY').map((a) => a.actionValue);
    expect(keys).toEqual(['3', '2']);

    const h = store.statusHistory;
    const idx = (s: string) => h.indexOf(s as never);
    expect(idx('ON_HOLD')).toBeGreaterThan(idx('NAVIGATING_MENU'));
    expect(idx('HUMAN_DETECTED')).toBeGreaterThan(idx('ON_HOLD'));
    expect(h.slice(-4)).toEqual(['HUMAN_DETECTED', 'CALLING_USER', 'BRIDGING_USER', 'USER_CONNECTED']);

    expect(store.getCall(1n)!.humanConfidence).toBeGreaterThanOrEqual(0.8);
    const types = store.events.map((e) => e.type);
    for (const t of ['OUTBOUND_CALL_STARTED', 'IVR_DETECTED', 'MENU_OPTION_IDENTIFIED', 'DTMF_SENT', 'HOLD_DETECTED', 'HUMAN_DETECTED', 'USER_CALLED', 'USER_CONNECTED']) {
      expect(types).toContain(t);
    }
    // Hold announcements must never be mistaken for a person.
    expect(types.filter((t) => t === 'HUMAN_DETECTED')).toHaveLength(1);
    expect(store.transcripts.some((t) => t.speakerType === 'HUMAN_REP' && /Sarah/.test(t.text))).toBe(true);
  });

  it('fails cleanly when the user never answers', async () => {
    const { store, runner, isFinished } = setup({ userAnswers: false });
    await store.claim(1n);
    await runner.start();
    await until(isFinished, 8000);
    expect(store.getCall(1n)!.status).toBe('FAILED');
    expect(store.events.at(-1)!.description).toMatch(/did not answer/);
  });

  it('cancelling mid-call hangs up and completes', async () => {
    const { store, runner } = setup();
    await store.claim(1n);
    await runner.start();
    await until(() => store.getCall(1n)!.status === 'ON_HOLD');
    await runner.cancel();
    expect(store.getCall(1n)!.status).toBe('COMPLETED');
  });
});

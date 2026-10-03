import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PROFILE } from '@holdless/shared';

process.env.PUBLIC_BASE_URL = 'https://holdless.example';
process.env.ELEVENLABS_API_KEY = '';

const { RuleBasedAgent } = await import('../src/ai/rules');
const { CallRunner } = await import('../src/runner');
const { MemoryStore } = await import('../src/store/memory');
const { MockTelephony } = await import('../src/telephony/mock');
const { TwilioTelephony } = await import('../src/telephony/twilio');
const { HybridTelephony } = await import('../src/telephony/hybrid');
const { fakeTwilio, serve, until } = await import('./helpers');

const USER = '+15555550100';
const REP = '+15555550199';
let closeServer: (() => void) | undefined;
afterEach(() => closeServer?.());

async function setup(opts: { rep?: string; failTo?: Record<string, number> } = {}) {
  const fake = fakeTwilio({ failTo: opts.failTo });
  const phones = new TwilioTelephony(fake.client);
  const telephony = new HybridTelephony(new MockTelephony({ timeScale: 0.01, holdSeconds: 8, holdAnnouncementSeconds: 3 }), phones, opts.rep ?? '');
  const { server, post } = await serve((app) => telephony.mount(app));
  closeServer = () => server.close();

  const store = new MemoryStore();
  store.addCall({
    id: 1n,
    companyName: DEMO_PROFILE.companyName,
    phoneNumber: DEMO_PROFILE.phoneNumber,
    userGoal: DEMO_PROFILE.userGoal,
    userPhoneNumber: USER,
    userContext: '',
    demo: true,
  });
  const runner = new CallRunner(store.getCall(1n)!, {
    store,
    telephony,
    agent: new RuleBasedAgent(),
    settings: { humanThreshold: 0.8, possibleHumanThreshold: 0.5, utteranceGapMs: 20, maxKeyPresses: 12, maxHoldMinutes: 1, userAnswerTimeoutSeconds: 10 },
  });
  await store.claim(1n);
  await runner.start();
  const status = () => store.getCall(1n)!.status;
  const created = (to: string) => fake.created.find((c) => c.to === to);
  return { store, fake, post, status, created };
}

describe('hybrid mode: simulated company line, real calls to people', () => {
  it('navigates the simulated IVR, then really calls the user, who hears the scripted rep after pressing 1', async () => {
    const { store, fake, post, status, created } = await setup();
    await until(() => !!created(USER));

    expect(store.actions.filter((a) => a.actionType === 'PRESS_KEY').map((a) => a.actionValue)).toEqual(['3', '2']);
    expect(status()).toBe('CALLING_USER');
    expect(fake.created).toHaveLength(1); // only the user's phone, no PSTN call to the company

    const briefing = await (await post('/twilio/user/answer?callId=1&attempt=1')).text();
    expect(briefing).toContain('Press 1 to connect');
    await post('/twilio/user/accept?callId=1', { Digits: '1' });

    await until(() => status() === 'USER_CONNECTED');
    expect(String(fake.updates.at(-1)!.args.twiml)).toContain('My name is Sarah');

    await post('/twilio/status?leg=user&callId=1', { CallStatus: 'completed' });
    await until(() => status() === 'COMPLETED');
  });

  it('rings the teammate rep at handoff and conferences the user with them', async () => {
    const { fake, post, status, created } = await setup({ rep: REP });
    await until(() => !!created(USER));
    const repCall = created(REP)!;
    expect(String(repCall.twiml)).toMatch(/startConferenceOnEnter="false"[^>]*>holdless-1</);
    const repSid = `CA${fake.created.indexOf(repCall) + 1}`;
    const userSid = `CA${fake.created.indexOf(created(USER)!) + 1}`;

    await post('/twilio/conference?callId=1', { StatusCallbackEvent: 'participant-join', CallSid: repSid });
    await post('/twilio/user/accept?callId=1', { Digits: '1' });
    await until(() => fake.updates.some((u) => u.sid === userSid && /startConferenceOnEnter="true"/.test(String(u.args.twiml))));
    await post('/twilio/conference?callId=1', { StatusCallbackEvent: 'participant-join', CallSid: userSid });
    await until(() => status() === 'USER_CONNECTED');
  });

  it("falls back to the scripted rep when the teammate doesn't pick up", async () => {
    const { fake, post, status, created } = await setup({ rep: REP });
    await until(() => !!created(USER));
    const repSid = `CA${fake.created.indexOf(created(REP)!) + 1}`;
    await post('/twilio/status?leg=rep&callId=1', { CallStatus: 'no-answer' });
    await post('/twilio/user/accept?callId=1', { Digits: '1' });
    await until(() => status() === 'USER_CONNECTED');
    expect(String(fake.updates.at(-1)!.args.twiml)).toContain('My name is Sarah');
    expect(fake.updates.some((u) => u.sid === repSid && u.args.status === 'completed')).toBe(false);
  });

  it('explains trial-account restrictions when the user number is unverified', async () => {
    const { store, status } = await setup({ failTo: { [USER]: 21219 } });
    await until(() => status() === 'FAILED');
    expect(store.events.at(-1)!.description).toMatch(/verify your phone number/i);
  });
});

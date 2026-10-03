import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.PUBLIC_BASE_URL = 'https://holdless.example';
process.env.ELEVENLABS_API_KEY = '';
process.env.DEMO_HOLD_SECONDS = '20';
process.env.DEMO_HOLD_ANNOUNCEMENT_SECONDS = '6';
process.env.DEMO_REP_PHONE_NUMBER = '';

const { TwilioTelephony } = await import('../src/telephony/twilio');
const { mountWolverineIvr } = await import('../src/ivr/wolverine');
const { fakeTwilio } = await import('./helpers');

let base = '';
let server: http.Server;
const fake = fakeTwilio();
const tel = new TwilioTelephony(fake.client);

beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  tel.mount(app);
  mountWolverineIvr(app);
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const post = (path: string, body: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', body: new URLSearchParams(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

describe('TwilioTelephony (stubbed REST, real webhooks)', () => {
  const support = { onAnswered: vi.fn(), onSpeech: vi.fn(), onAudio: vi.fn(), onEnded: vi.fn() };
  const user = { onAccepted: vi.fn(), onBridged: vi.fn(), onUnanswered: vi.fn(), onEnded: vi.fn() };

  it('places the support call with a forked media stream + transcription', async () => {
    await tel.startSupportCall({ callId: 7n, to: '+17345550142' }, support);
    const twiml = String(fake.created[0]!.twiml);
    expect(twiml).toContain('<Stream');
    expect(twiml).toContain('wss://holdless.example/twilio/media');
    expect(twiml).toContain('<Transcription');
    expect(twiml).toContain('<Pause length="3600"/>');
  });

  it('answers once even if Twilio retries the status webhook', async () => {
    await post('/twilio/status?leg=support&callId=7', { CallStatus: 'in-progress' });
    await post('/twilio/status?leg=support&callId=7', { CallStatus: 'in-progress' });
    expect(support.onAnswered).toHaveBeenCalledTimes(1);
  });

  it('forwards final transcriptions only', async () => {
    await post('/twilio/transcription?callId=7', {
      TranscriptionEvent: 'transcription-content',
      Final: 'false',
      TranscriptionData: JSON.stringify({ transcript: 'For sal' }),
    });
    await post('/twilio/transcription?callId=7', {
      TranscriptionEvent: 'transcription-content',
      Final: 'true',
      TranscriptionData: JSON.stringify({ transcript: 'For billing, press 3.', confidence: 0.93 }),
    });
    expect(support.onSpeech).toHaveBeenCalledTimes(1);
    expect(support.onSpeech).toHaveBeenCalledWith({ text: 'For billing, press 3.', confidence: 0.93 });
  });

  it('sends DTMF by updating TwiML and keeps listening', async () => {
    await tel.sendDigits(7n, '3');
    const twiml = String(fake.updates.at(-1)!.args.twiml);
    expect(twiml).toContain('<Play digits="w3"/>');
    expect(twiml).toContain('<Pause');
  });

  it('parks the rep in a conference and bridges the user only after they press 1', async () => {
    await tel.holdForHandoff(7n, 'One moment please.');
    expect(String(fake.updates.at(-1)!.args.twiml)).toMatch(/<Conference[^>]*startConferenceOnEnter="false"[^>]*>holdless-7</);

    await tel.startUserCall({ callId: 7n, to: '+15555550100', briefing: 'Wolverine Wireless billing is on the line. Press 1 to connect.' }, user);
    const userSid = 'CA2';
    const answer = await (await post('/twilio/user/answer?callId=7&attempt=1')).text();
    expect(answer).toContain('<Gather');
    expect(answer).toContain('Press 1 to connect');

    await post('/twilio/user/accept?callId=7', { Digits: '5' });
    expect(user.onAccepted).not.toHaveBeenCalled();
    await post('/twilio/user/accept?callId=7', { Digits: '1' });
    expect(user.onAccepted).toHaveBeenCalledTimes(1);

    await tel.bridgeUser(7n);
    expect(String(fake.updates.at(-1)!.args.twiml)).toMatch(/startConferenceOnEnter="true"[^>]*>holdless-7</);
    await post('/twilio/conference?callId=7', { StatusCallbackEvent: 'participant-join', CallSid: userSid });
    expect(user.onBridged).toHaveBeenCalledTimes(1);
  });

  it('reports busy support lines as failures', async () => {
    const h = { onAnswered: vi.fn(), onSpeech: vi.fn(), onAudio: vi.fn(), onEnded: vi.fn() };
    await tel.startSupportCall({ callId: 8n, to: '+17345550142' }, h);
    await post('/twilio/status?leg=support&callId=8', { CallStatus: 'busy' });
    expect(h.onEnded).toHaveBeenCalledWith('busy', true);
  });
});

describe('Wolverine Wireless IVR TwiML', () => {
  it('greets and gathers the main menu', async () => {
    const xml = await (await post('/ivr/wolverine')).text();
    expect(xml).toContain('Thank you for calling Wolverine Wireless.');
    expect(xml).toContain('For billing, press 3.');
    expect(xml).toContain('<Gather');
  });
  it('routes 3 -> billing, 2 -> hold queue then the representative', async () => {
    expect(await (await post('/ivr/wolverine/select?node=main', { Digits: '3' })).text()).toContain('To dispute a charge, press 2.');
    const hold = await (await post('/ivr/wolverine/select?node=billing', { Digits: '2' })).text();
    expect(hold).toContain('Please hold while we connect you');
    expect(hold).toContain('hold-music.wav');
    expect(hold).toContain('Your call is important to us');
    expect(hold).toContain('My name is Sarah');
  });
  it('repeats the menu on invalid input', async () => {
    const xml = await (await post('/ivr/wolverine/select?node=main', { Digits: '8' })).text();
    expect(xml).toContain("Sorry, I didn't get that.");
  });
});

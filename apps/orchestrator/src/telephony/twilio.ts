import type { Express, Request, Response } from 'express';
import twilio from 'twilio';
import type { WebSocket } from 'ws';
import { config } from '../config';
import { log } from '../log';
import { AudioClassifier } from '../voice/audio';
import { speechUrl } from '../voice/assets';
import { openElevenLabsStt, type SttSession } from '../voice/elevenlabs';
import type { SupportLegHandlers, TelephonyProvider, UserLegHandlers } from './types';

const { VoiceResponse } = twilio.twiml;
type TwiML = InstanceType<typeof VoiceResponse>;

const TERMINAL = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);
const LISTEN_SECONDS = 3600;
const SAY_VOICE = 'Polly.Joanna-Neural' as const;

interface SupportLeg {
  callId: bigint;
  sid: string;
  handlers: SupportLegHandlers;
  answered: boolean;
  ended: boolean;
  listening: boolean;
  streamName: string;
  streamRestarts: number;
  stt?: SttSession;
  classifier: AudioClassifier;
}

interface UserLeg {
  sid: string;
  handlers: UserLegHandlers;
  briefing: string;
  briefingUrl: string | null;
  accepted: boolean;
  bridged: boolean;
  ended: boolean;
}

interface RepLeg {
  sid: string;
  joined: boolean;
  ended: boolean;
}

const room = (callId: bigint) => `holdless-${callId}`;

/** Turns Twilio REST errors into something a person can act on (trial accounts especially). */
export function describeTwilioError(err: unknown, who: string): string {
  const code = (err as { code?: number })?.code;
  if (code === 21219 || code === 21608) {
    return `Twilio trial accounts can only call verified numbers. Verify ${who} in the Twilio console (Phone Numbers → Verified Caller IDs).`;
  }
  if (code === 21211) return `${who} isn't a valid phone number.`;
  return (err as Error)?.message ?? String(err);
}

/**
 * Twilio implementation.
 * - Support leg: outbound call whose far-end audio is forked (<Start><Stream>) to our
 *   WebSocket and transcribed by ElevenLabs Scribe (or Twilio real-time transcription
 *   when no ElevenLabs key). DTMF/speech are injected by updating the call's TwiML.
 * - Handoff: the representative is parked in a Conference; the user is called, must
 *   press 1 (so voicemail can never be bridged), and is then joined to that Conference.
 */
export class TwilioTelephony implements TelephonyProvider {
  readonly name = 'twilio' as const;
  private support = new Map<bigint, SupportLeg>();
  private users = new Map<bigint, UserLeg>();
  private reps = new Map<bigint, RepLeg>();
  private readonly useElevenLabs = !!config.elevenlabs.apiKey;

  constructor(private readonly client: ReturnType<typeof twilio> = twilio(config.twilio.accountSid, config.twilio.authToken)) {}

  private url(path: string) {
    return `${config.publicBaseUrl}${path}`;
  }

  private get mediaUrl() {
    return `${config.publicBaseUrl.replace(/^http/, 'ws')}/twilio/media`;
  }

  private leg(callId: bigint) {
    const leg = this.support.get(callId);
    if (!leg) throw new Error(`No active support call for ${callId}`);
    return leg;
  }

  private listenTwiml(callId: bigint, before?: (r: TwiML) => void, startListening = false): string {
    const r = new VoiceResponse();
    if (startListening) {
      const start = r.start();
      const leg = this.support.get(callId);
      const stream = start.stream({ name: leg?.streamName ?? `listen-${callId}`, url: this.mediaUrl, track: 'inbound_track' });
      stream.parameter({ name: 'callId', value: callId.toString() });
      if (!this.useElevenLabs) {
        start.transcription({
          name: `stt-${callId}`,
          statusCallbackUrl: this.url(`/twilio/transcription?callId=${callId}`),
          track: 'inbound_track',
          partialResults: false,
        });
      }
    }
    before?.(r);
    r.pause({ length: LISTEN_SECONDS });
    return r.toString();
  }

  async startSupportCall({ callId, to }: { callId: bigint; to: string }, handlers: SupportLegHandlers) {
    const leg: SupportLeg = {
      callId,
      sid: '',
      handlers,
      answered: false,
      ended: false,
      listening: true,
      streamName: `listen-${callId}`,
      streamRestarts: 0,
      classifier: new AudioClassifier((signal) => handlers.onAudio(signal)),
    };
    this.support.set(callId, leg);
    const call = await this.client.calls.create({
      to,
      from: config.twilio.phoneNumber,
      twiml: this.listenTwiml(callId, undefined, true),
      timeout: 30,
      statusCallback: this.url(`/twilio/status?leg=support&callId=${callId}`),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });
    leg.sid = call.sid;
    log.call(callId, `Twilio support leg ${call.sid} → ${to} (STT: ${this.useElevenLabs ? 'ElevenLabs Scribe' : 'Twilio real-time transcription'})`);
    return { sid: call.sid };
  }

  async sendDigits(callId: bigint, digits: string) {
    const leg = this.leg(callId);
    await this.client.calls(leg.sid).update({ twiml: this.listenTwiml(callId, (r) => r.play({ digits: `w${digits}` })) });
  }

  async speak(callId: bigint, text: string) {
    const leg = this.leg(callId);
    const audio = await speechUrl(text);
    await this.client.calls(leg.sid).update({
      twiml: this.listenTwiml(callId, (r) => (audio ? r.play(audio) : r.say({ voice: SAY_VOICE }, text))),
    });
  }

  async holdForHandoff(callId: bigint, message: string) {
    const leg = this.leg(callId);
    const audio = await speechUrl(message);
    const r = new VoiceResponse();
    if (audio) r.play(audio);
    else r.say({ voice: SAY_VOICE }, message);
    r.dial().conference(
      {
        startConferenceOnEnter: false,
        endConferenceOnExit: true,
        beep: 'false',
        waitUrl: this.url('/audio/hold-music.wav'),
        waitMethod: 'GET',
        statusCallback: this.url(`/twilio/conference?callId=${callId}`),
        statusCallbackEvent: ['join', 'leave', 'end'],
      },
      room(callId),
    );
    await this.client.calls(leg.sid).update({ twiml: r.toString() });
  }

  async startUserCall({ callId, to, briefing }: { callId: bigint; to: string; briefing: string }, handlers: UserLegHandlers) {
    const leg: UserLeg = { sid: '', handlers, briefing, briefingUrl: await speechUrl(briefing), accepted: false, bridged: false, ended: false };
    this.users.set(callId, leg);
    const call = await this.client.calls
      .create({
        to,
        from: config.twilio.phoneNumber,
        url: this.url(`/twilio/user/answer?callId=${callId}&attempt=1`),
        timeout: 25,
        statusCallback: this.url(`/twilio/status?leg=user&callId=${callId}`),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      })
      .catch((err) => {
        throw new Error(describeTwilioError(err, 'your phone number'));
      });
    leg.sid = call.sid;
    return { sid: call.sid };
  }

  /**
   * Hybrid demo: ring a real person (a teammate playing the representative) into
   * the handoff conference, where they wait with hold music until the user joins.
   */
  async dialRepIntoRoom(callId: bigint, to: string) {
    const r = new VoiceResponse();
    r.say(
      { voice: SAY_VOICE },
      "This is HoldLess. You're playing the Wolverine Wireless representative. Your customer will join in a moment, so greet them when you hear them.",
    );
    r.dial().conference(
      {
        startConferenceOnEnter: false,
        endConferenceOnExit: true,
        beep: 'false',
        waitUrl: this.url('/audio/hold-music.wav'),
        waitMethod: 'GET',
        statusCallback: this.url(`/twilio/conference?callId=${callId}`),
        statusCallbackEvent: ['join', 'leave', 'end'],
      },
      room(callId),
    );
    const rep: RepLeg = { sid: '', joined: false, ended: false };
    this.reps.set(callId, rep);
    try {
      const call = await this.client.calls.create({
        to,
        from: config.twilio.phoneNumber,
        twiml: r.toString(),
        timeout: 25,
        statusCallback: this.url(`/twilio/status?leg=rep&callId=${callId}`),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });
      rep.sid = call.sid;
      log.call(callId, `ringing teammate rep ${call.sid}`);
    } catch (err) {
      rep.ended = true;
      throw new Error(describeTwilioError(err, "the rep's number (DEMO_REP_PHONE_NUMBER)"));
    }
  }

  /** Waits for the rep to be in the conference. Resolves false if they hang up, fail, or time out. */
  async waitForRep(callId: bigint, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rep = this.reps.get(callId);
      if (!rep || rep.ended) return false;
      if (rep.joined) return true;
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async dropRep(callId: bigint) {
    const rep = this.reps.get(callId);
    if (rep?.sid && !rep.ended) {
      rep.ended = true;
      await this.client.calls(rep.sid).update({ status: 'completed' }).catch(() => {});
    }
  }

  /** Plays a line to the accepted user (the scripted rep), then hangs up after a short pause. */
  async playToUser(callId: bigint, text: string) {
    const leg = this.users.get(callId);
    if (!leg) throw new Error('User leg missing');
    const audio = await speechUrl(text);
    const r = new VoiceResponse();
    r.pause({ length: 1 });
    if (audio) r.play(audio);
    else r.say({ voice: SAY_VOICE }, text);
    r.pause({ length: 20 });
    r.say({ voice: SAY_VOICE }, 'This was a HoldLess demo. Thanks for listening. Goodbye.');
    r.hangup();
    await this.client.calls(leg.sid).update({ twiml: r.toString() });
    this.markBridged(callId);
  }

  async bridgeUser(callId: bigint) {
    const leg = this.users.get(callId);
    if (!leg) throw new Error('User leg missing');
    const r = new VoiceResponse();
    r.dial().conference({ startConferenceOnEnter: true, endConferenceOnExit: true, beep: 'false' }, room(callId));
    await this.client.calls(leg.sid).update({ twiml: r.toString() });
    // The conference 'join' webhook confirms the bridge; this only covers a missing callback.
    setTimeout(() => {
      if (!leg.bridged && !leg.ended) {
        log.warn(`call ${callId}: no conference join callback; assuming bridged`);
        this.markBridged(callId);
      }
    }, 8000);
  }

  private markBridged(callId: bigint) {
    const leg = this.users.get(callId);
    if (!leg || leg.bridged) return;
    leg.bridged = true;
    leg.handlers.onBridged();
  }

  async stopListening(callId: bigint) {
    const leg = this.support.get(callId);
    if (!leg) return;
    leg.listening = false;
    leg.stt?.close();
    leg.stt = undefined;
    await this.client.calls(leg.sid).streams(leg.streamName).update({ status: 'stopped' }).catch(() => {});
    if (!this.useElevenLabs) {
      await this.client.calls(leg.sid).transcriptions(`stt-${callId}`).update({ status: 'stopped' }).catch(() => {});
    }
  }

  async hangup(callId: bigint) {
    const leg = this.support.get(callId);
    const user = this.users.get(callId);
    for (const l of [leg, user, this.reps.get(callId)]) {
      if (l && l.sid && !l.ended) {
        l.ended = true;
        await this.client.calls(l.sid).update({ status: 'completed' }).catch(() => {});
      }
    }
    leg?.stt?.close();
    this.support.delete(callId);
    this.users.delete(callId);
    this.reps.delete(callId);
  }

  async getCallStatus(callId: bigint) {
    const leg = this.support.get(callId);
    if (!leg?.sid) return 'unknown';
    return (await this.client.calls(leg.sid).fetch()).status;
  }

  // -------------------------------------------------------------------------
  // Webhooks & media
  // -------------------------------------------------------------------------

  mount(app: Express) {
    const id = (req: Request) => {
      try {
        return BigInt(String(req.query.callId));
      } catch {
        return -1n;
      }
    };
    const twiml = (res: Response, body: string) => res.type('text/xml').send(body);

    app.post('/twilio/status', (req, res) => {
      const callId = id(req);
      const status = String(req.body.CallStatus ?? '');
      if (req.query.leg === 'support') this.onSupportStatus(callId, status);
      else if (req.query.leg === 'rep') this.onRepStatus(callId, status);
      else this.onUserStatus(callId, status);
      res.sendStatus(204);
    });

    app.post('/twilio/transcription', (req, res) => {
      res.sendStatus(204);
      const leg = this.support.get(id(req));
      if (!leg || !leg.listening) return;
      const event = String(req.body.TranscriptionEvent ?? '');
      if (event === 'transcription-content' && String(req.body.Final) === 'true') {
        try {
          const data = JSON.parse(String(req.body.TranscriptionData ?? '{}')) as { transcript?: string; confidence?: number };
          if (data.transcript?.trim()) {
            leg.classifier.noteSpeech();
            leg.handlers.onSpeech({ text: data.transcript.trim(), confidence: data.confidence ?? 0.8 });
          }
        } catch {}
      } else if (event === 'transcription-stopped' && !leg.ended) {
        void this.client
          .calls(leg.sid)
          .transcriptions.create({
            name: `stt-${leg.callId}`,
            statusCallbackUrl: this.url(`/twilio/transcription?callId=${leg.callId}`),
            track: 'inbound_track',
            partialResults: false,
          })
          .catch((e) => log.warn(`could not restart transcription: ${e.message}`));
      }
    });

    app.post('/twilio/user/answer', (req, res) => {
      const callId = id(req);
      const leg = this.users.get(callId);
      const attempt = Number(req.query.attempt ?? 1);
      const r = new VoiceResponse();
      if (!leg) {
        r.hangup();
        return twiml(res, r.toString());
      }
      const gather = r.gather({ numDigits: 1, timeout: 7, action: this.url(`/twilio/user/accept?callId=${callId}`) });
      if (leg.briefingUrl) gather.play(leg.briefingUrl);
      else gather.say({ voice: SAY_VOICE }, leg.briefing);
      if (attempt < 2) r.redirect(this.url(`/twilio/user/answer?callId=${callId}&attempt=${attempt + 1}`));
      else {
        r.say({ voice: SAY_VOICE }, "We didn't hear a key press, so we'll let you go. Goodbye.");
        r.hangup();
      }
      twiml(res, r.toString());
    });

    app.post('/twilio/user/accept', (req, res) => {
      const callId = id(req);
      const leg = this.users.get(callId);
      const r = new VoiceResponse();
      if (!leg) {
        r.hangup();
        return twiml(res, r.toString());
      }
      if (String(req.body.Digits) !== '1') {
        r.redirect(this.url(`/twilio/user/answer?callId=${callId}&attempt=2`));
        return twiml(res, r.toString());
      }
      r.say({ voice: SAY_VOICE }, 'Connecting you now.');
      r.pause({ length: 30 });
      twiml(res, r.toString());
      if (!leg.accepted) {
        leg.accepted = true;
        leg.handlers.onAccepted();
      }
    });

    app.post('/twilio/conference', (req, res) => {
      res.sendStatus(204);
      const callId = id(req);
      const user = this.users.get(callId);
      const event = String(req.body.StatusCallbackEvent ?? '');
      if (event !== 'participant-join') return;
      if (user && req.body.CallSid === user.sid) this.markBridged(callId);
      const rep = this.reps.get(callId);
      if (rep && req.body.CallSid === rep.sid) rep.joined = true;
    });
  }

  handleMediaSocket(ws: WebSocket) {
    let leg: SupportLeg | undefined;
    ws.on('message', (raw) => {
      let msg: { event: string; start?: { customParameters?: Record<string, string> }; media?: { payload: string; track?: string } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.event === 'start') {
        const callId = BigInt(msg.start?.customParameters?.callId ?? '-1');
        leg = this.support.get(callId);
        if (!leg) return ws.close();
        if (this.useElevenLabs && leg.listening) {
          const current = leg;
          current.stt?.close();
          current.stt = openElevenLabsStt({
            onText: (text) => {
              current.classifier.noteSpeech();
              if (current.listening) current.handlers.onSpeech({ text, confidence: 0.9 });
            },
            onError: (m) => log.warn(`call ${callId}: ElevenLabs STT ${m}`),
          });
        }
      } else if (msg.event === 'media' && leg && msg.media) {
        if (!leg.listening) return;
        leg.classifier.feed(Buffer.from(msg.media.payload, 'base64'));
        leg.stt?.sendUlaw(msg.media.payload);
      } else if (msg.event === 'stop' && leg) {
        leg.stt?.close();
        leg.stt = undefined;
        this.restartStream(leg);
      }
    });
  }

  /** If Twilio drops the fork while we still need to listen, re-create it over REST. */
  private restartStream(leg: SupportLeg) {
    if (!leg.listening || leg.ended || leg.streamRestarts >= 5) return;
    leg.streamRestarts++;
    leg.streamName = `listen-${leg.callId}-${leg.streamRestarts}`;
    setTimeout(() => {
      if (!leg.listening || leg.ended) return;
      void this.client
        .calls(leg.sid)
        .streams.create({
          url: this.mediaUrl,
          name: leg.streamName,
          track: 'inbound_track',
          'parameter1.name': 'callId',
          'parameter1.value': leg.callId.toString(),
        })
        .then(() => log.call(leg.callId, `media stream re-attached (${leg.streamName})`))
        .catch((e) => log.warn(`could not restart media stream: ${e.message}`));
    }, 300);
  }

  private onSupportStatus(callId: bigint, status: string) {
    const leg = this.support.get(callId);
    if (!leg || leg.ended) return;
    if (status === 'in-progress' && !leg.answered) {
      leg.answered = true;
      leg.handlers.onAnswered();
    } else if (TERMINAL.has(status)) {
      leg.ended = true;
      leg.listening = false;
      leg.stt?.close();
      const reason = status === 'completed' && !leg.answered ? 'no-answer' : status;
      leg.handlers.onEnded(reason, status !== 'completed' || !leg.answered);
    }
  }

  private onRepStatus(callId: bigint, status: string) {
    const rep = this.reps.get(callId);
    if (rep && TERMINAL.has(status)) rep.ended = true;
  }

  private onUserStatus(callId: bigint, status: string) {
    const leg = this.users.get(callId);
    if (!leg || leg.ended || !TERMINAL.has(status)) return;
    leg.ended = true;
    if (!leg.accepted) leg.handlers.onUnanswered(status === 'completed' ? 'no key press' : status);
    else leg.handlers.onEnded(status);
  }
}

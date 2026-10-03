import type { Express, Request } from 'express';
import twilio from 'twilio';
import {
  WOLVERINE_GREETING,
  WOLVERINE_HOLD_ANNOUNCEMENTS,
  WOLVERINE_INVALID,
  WOLVERINE_IVR,
  WOLVERINE_REP_GREETING,
} from '@holdless/shared';
import { config } from '../config';

const { VoiceResponse } = twilio.twiml;
const IVR_VOICE = 'Polly.Salli' as const;
const REP_VOICE = 'Polly.Joanna-Neural' as const;
const MUSIC_LOOP_SECONDS = 6;

/**
 * The fake "Wolverine Wireless" support line, served as TwiML. Point a Twilio
 * number's Voice webhook at POST {PUBLIC_BASE_URL}/ivr/wolverine.
 */
export function mountWolverineIvr(app: Express) {
  const url = (p: string) => `${config.publicBaseUrl}${p}`;
  const xml = (r: InstanceType<typeof VoiceResponse>) => r.toString();

  const menu = (nodeId: string, greet: boolean, prefix = '') => {
    const node = WOLVERINE_IVR[nodeId] ?? WOLVERINE_IVR.main!;
    const r = new VoiceResponse();
    const gather = r.gather({ numDigits: 1, timeout: 6, action: url(`/ivr/wolverine/select?node=${node.id}`) });
    if (prefix) gather.say({ voice: IVR_VOICE }, prefix);
    if (greet) gather.say({ voice: IVR_VOICE }, WOLVERINE_GREETING);
    gather.say({ voice: IVR_VOICE }, node.prompt);
    r.redirect(url(`/ivr/wolverine?node=${node.id}&repeat=1`));
    return xml(r);
  };

  app.post('/ivr/wolverine', (req: Request, res) => {
    const node = String(req.query.node ?? 'main');
    res.type('text/xml').send(menu(node, !req.query.repeat && node === 'main'));
  });

  app.post('/ivr/wolverine/select', (req, res) => {
    const node = WOLVERINE_IVR[String(req.query.node)] ?? WOLVERINE_IVR.main!;
    const option = node.options.find((o) => o.key === String(req.body.Digits));
    if (!option) return res.type('text/xml').send(menu(node.id, false, WOLVERINE_INVALID));
    const next = WOLVERINE_IVR[option.next]!;
    if (next.kind !== 'hold') return res.type('text/xml').send(menu(next.id, false));

    const r = new VoiceResponse();
    r.say({ voice: IVR_VOICE }, next.prompt);
    let elapsed = 4;
    let sinceAnnouncement = 0;
    let announcement = 0;
    while (elapsed < config.demo.holdSeconds) {
      if (sinceAnnouncement >= config.demo.holdAnnouncementSeconds) {
        r.say({ voice: IVR_VOICE }, WOLVERINE_HOLD_ANNOUNCEMENTS[announcement++ % WOLVERINE_HOLD_ANNOUNCEMENTS.length]!);
        elapsed += 6;
        sinceAnnouncement = 0;
      }
      r.play(url('/audio/hold-music.wav'));
      elapsed += MUSIC_LOOP_SECONDS;
      sinceAnnouncement += MUSIC_LOOP_SECONDS;
    }
    if (config.demo.repPhoneNumber) {
      r.dial({ timeout: 20, answerOnBridge: true, action: url('/ivr/wolverine/after-dial') }, config.demo.repPhoneNumber);
    } else {
      r.pause({ length: 1 });
      r.say({ voice: REP_VOICE }, WOLVERINE_REP_GREETING);
      r.pause({ length: 120 });
    }
    res.type('text/xml').send(xml(r));
  });

  // Teammate didn't pick up: fall back to the scripted representative so the demo still completes.
  app.post('/ivr/wolverine/after-dial', (req, res) => {
    const r = new VoiceResponse();
    if (String(req.body.DialCallStatus) === 'completed') r.hangup();
    else {
      r.say({ voice: REP_VOICE }, WOLVERINE_REP_GREETING);
      r.pause({ length: 120 });
    }
    res.type('text/xml').send(xml(r));
  });
}

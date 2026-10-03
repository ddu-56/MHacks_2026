import {
  WOLVERINE_GREETING,
  WOLVERINE_HOLD_ANNOUNCEMENTS,
  WOLVERINE_INVALID,
  WOLVERINE_IVR,
  WOLVERINE_REP_GREETING,
} from '@holdless/shared';
import { log } from '../log';
import type { SupportLegHandlers, TelephonyProvider, UserLegHandlers } from './types';

export interface MockOptions {
  /** Multiplies every delay. 1 = demo pace, 0.01 = tests. */
  timeScale?: number;
  holdSeconds?: number;
  holdAnnouncementSeconds?: number;
  userAnswers?: boolean;
}

interface Leg {
  node: string;
  handlers: SupportLegHandlers;
  user?: UserLegHandlers;
  timers: Set<NodeJS.Timeout>;
  listening: boolean;
  ended: boolean;
}

/**
 * Simulates the Wolverine Wireless phone tree in-process (no phone calls).
 * Uses the exact same IVR script as the Twilio-hosted line.
 */
export class MockTelephony implements TelephonyProvider {
  readonly name = 'mock' as const;
  private legs = new Map<bigint, Leg>();
  private readonly scale: number;
  private readonly holdMs: number;
  private readonly announceMs: number;
  private readonly userAnswers: boolean;

  constructor(opts: MockOptions = {}) {
    this.scale = opts.timeScale ?? 1;
    this.holdMs = (opts.holdSeconds ?? 12) * 1000;
    this.announceMs = (opts.holdAnnouncementSeconds ?? 6) * 1000;
    this.userAnswers = opts.userAnswers ?? true;
  }

  private after(leg: Leg, ms: number, fn: () => void) {
    const timer = setTimeout(() => {
      leg.timers.delete(timer);
      if (!leg.ended) fn();
    }, ms * this.scale);
    leg.timers.add(timer);
  }

  /** Emits a prompt sentence by sentence, the way streaming STT would. */
  private say(leg: Leg, text: string, startDelay = 0) {
    const sentences = text.match(/[^.?!]+[.?!]/g) ?? [text];
    sentences.forEach((s, i) =>
      this.after(leg, startDelay + i * 450, () => leg.listening && leg.handlers.onSpeech({ text: s.trim(), confidence: 0.96 })),
    );
    return startDelay + sentences.length * 450;
  }

  private leg(callId: bigint): Leg {
    const leg = this.legs.get(callId);
    if (!leg) throw new Error(`No mock call for ${callId}`);
    return leg;
  }

  async startSupportCall({ callId }: { callId: bigint; to: string }, handlers: SupportLegHandlers) {
    const leg: Leg = { node: 'main', handlers, timers: new Set(), listening: true, ended: false };
    this.legs.set(callId, leg);
    this.after(leg, 1800, () => {
      handlers.onAnswered();
      this.say(leg, `${WOLVERINE_GREETING} ${WOLVERINE_IVR.main!.prompt}`, 600);
    });
    return { sid: `MOCK-${callId}` };
  }

  async sendDigits(callId: bigint, digits: string) {
    const leg = this.leg(callId);
    log.call(callId, `mock IVR received DTMF ${digits}`);
    const node = WOLVERINE_IVR[leg.node]!;
    const option = node.options.find((o) => o.key === digits);
    if (!option) {
      this.say(leg, `${WOLVERINE_INVALID} ${node.prompt}`, 700);
      return;
    }
    leg.node = option.next;
    const next = WOLVERINE_IVR[option.next]!;
    if (next.kind === 'hold') this.enterHold(leg);
    else this.say(leg, next.prompt, 900);
  }

  private enterHold(leg: Leg) {
    const done = this.say(leg, WOLVERINE_IVR.hold!.prompt, 900);
    this.after(leg, done + 600, () => leg.handlers.onAudio('music'));
    const count = Math.max(0, Math.floor((this.holdMs - done) / this.announceMs));
    for (let i = 1; i <= count; i++) {
      this.say(leg, WOLVERINE_HOLD_ANNOUNCEMENTS[(i - 1) % WOLVERINE_HOLD_ANNOUNCEMENTS.length]!, done + i * this.announceMs - 2500);
    }
    this.after(leg, this.holdMs, () => {
      leg.node = 'rep';
      leg.handlers.onAudio('speech');
      this.say(leg, WOLVERINE_REP_GREETING, 300);
    });
  }

  async speak(callId: bigint, text: string) {
    log.call(callId, `mock speak: "${text}"`);
  }

  async holdForHandoff(callId: bigint, message: string) {
    log.call(callId, `mock rep hears: "${message}"`);
  }

  async startUserCall({ callId }: { callId: bigint; to: string; briefing: string }, handlers: UserLegHandlers) {
    const leg = this.leg(callId);
    leg.user = handlers;
    if (this.userAnswers) this.after(leg, 3000, () => handlers.onAccepted());
    else this.after(leg, 5000, () => handlers.onUnanswered('no-answer'));
    return { sid: `MOCK-USER-${callId}` };
  }

  async bridgeUser(callId: bigint) {
    const leg = this.leg(callId);
    this.after(leg, 700, () => leg.user?.onBridged());
  }

  async stopListening(callId: bigint) {
    const leg = this.legs.get(callId);
    if (leg) leg.listening = false;
  }

  async hangup(callId: bigint) {
    const leg = this.legs.get(callId);
    if (!leg) return;
    leg.ended = true;
    leg.timers.forEach(clearTimeout);
    leg.timers.clear();
    this.legs.delete(callId);
  }

  async getCallStatus(callId: bigint) {
    return this.legs.has(callId) ? 'in-progress' : 'completed';
  }
}

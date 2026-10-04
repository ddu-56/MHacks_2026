import {
  WOLVERINE_GREETING,
  WOLVERINE_HOLD_ANNOUNCEMENTS,
  WOLVERINE_INVALID,
  WOLVERINE_IVR,
  WOLVERINE_REP_GREETING,
} from '@holdless/shared';
import { log } from '../log';
import { CallOver, SimCall } from './sim/engine';
import { Rng, randomSeed } from './sim/rng';
import { newOutcome, PROFILES, wolverineScenario, type Difficulty, type Outcome } from './sim/wolverine';
import type { SupportLegHandlers, TelephonyProvider, UserLegHandlers } from './types';

/** classic = the fixed demo script; the others run the simulated contact center at that difficulty. */
export type MockScenario = 'classic' | Difficulty;

export interface MockOptions {
  /** Multiplies every delay. 1 = demo pace, 0.01 = tests. */
  timeScale?: number;
  holdSeconds?: number;
  holdAnnouncementSeconds?: number;
  userAnswers?: boolean;
  scenario?: MockScenario;
  /** Fixed seed (replays the same call every time). Default: new random variant per call. */
  seed?: number;
}

export interface SimInfo {
  seed: number;
  difficulty: Difficulty;
  outcome: Outcome;
}

interface Leg {
  node: string;
  handlers: SupportLegHandlers;
  user?: UserLegHandlers;
  timers: Set<NodeJS.Timeout>;
  listening: boolean;
  ended: boolean;
  sim?: SimCall;
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
  private readonly scenario: MockScenario;
  private readonly fixedSeed?: number;
  /** Seed + what happened on each simulated call (for logs and tests). */
  readonly sims = new Map<bigint, SimInfo>();
  private attempts = new Map<bigint, number>();

  constructor(opts: MockOptions = {}) {
    this.scenario = opts.scenario ?? 'classic';
    this.fixedSeed = opts.seed;
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
    if (this.scenario !== 'classic') return this.startSimulatedCall(callId, leg, this.scenario);
    this.after(leg, 1800, () => {
      handlers.onAnswered();
      this.say(leg, `${WOLVERINE_GREETING} ${WOLVERINE_IVR.main!.prompt}`, 600);
    });
    return { sid: `MOCK-${callId}` };
  }

  /**
   * The simulated contact center: menus, an assistant that only understands speech,
   * offers, transfers, holds, drops and people — generated from a seed, never from
   * the caller's goal. It only reacts to what the agent actually presses or says.
   */
  private startSimulatedCall(callId: bigint, leg: Leg, difficulty: Difficulty) {
    // Each call-back is a new call: a fixed seed still varies per attempt (but replays exactly).
    const attempt = (this.attempts.get(callId) ?? 0) + 1;
    this.attempts.set(callId, attempt);
    const seed = this.fixedSeed !== undefined ? this.fixedSeed + (attempt - 1) * 1_000_003 : randomSeed();
    const rng = new Rng(seed);
    const profile = PROFILES[difficulty];
    const outcome = newOutcome();
    this.sims.set(callId, { seed, difficulty, outcome });
    log.call(callId, `simulated contact center: ${difficulty}, seed ${seed} (MOCK_SEED=${seed} replays it)`);

    const sim = new SimCall(
      rng,
      {
        speak: (sentence) => leg.listening && !leg.ended && leg.handlers.onSpeech({ text: sentence, confidence: 0.93 }),
        music: (on) => leg.listening && leg.handlers.onAudio(on ? 'music' : 'speech'),
        hangup: (reason) => {
          if (leg.ended) return;
          leg.ended = true;
          log.call(callId, `simulated company ended the call (${reason})`);
          leg.handlers.onEnded(reason, reason === 'busy');
        },
        humanAnswered: () => log.call(callId, 'simulated representative picked up'),
      },
      this.scale,
      profile.mishear,
    );
    leg.sim = sim;

    this.after(leg, 1200 + rng.next() * 2000, () => {
      if (rng.chance(profile.busy)) {
        outcome.endedBy = 'busy';
        leg.ended = true;
        leg.handlers.onEnded('busy', true);
        return;
      }
      leg.handlers.onAnswered();
      wolverineScenario(sim, {
        holdSeconds: this.holdMs / 1000,
        announceSeconds: this.announceMs / 1000,
        profile,
        outcome,
      }).catch((err) => {
        if (!(err instanceof CallOver)) log.error(`simulation error: ${(err as Error).stack ?? err}`);
      });
    });
    return Promise.resolve({ sid: `MOCK-${callId}-seed${seed}` });
  }

  async sendDigits(callId: bigint, digits: string) {
    const leg = this.leg(callId);
    if (leg.sim) {
      log.call(callId, `caller pressed ${digits}`);
      leg.sim.input({ type: 'digits', value: digits });
      return;
    }
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
    log.call(callId, `caller said: "${text}"`);
    this.legs.get(callId)?.sim?.input({ type: 'speech', text });
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
    this.after(leg, 700, () => {
      // You're talking to the person now; the simulated company stops driving the line.
      leg.sim?.end();
      leg.user?.onBridged();
    });
  }

  async stopListening(callId: bigint) {
    const leg = this.legs.get(callId);
    if (leg) leg.listening = false;
  }

  async hangup(callId: bigint) {
    const leg = this.legs.get(callId);
    if (!leg) return;
    leg.ended = true;
    leg.sim?.end();
    leg.timers.forEach(clearTimeout);
    leg.timers.clear();
    this.legs.delete(callId);
  }

  async getCallStatus(callId: bigint) {
    return this.legs.has(callId) ? 'in-progress' : 'completed';
  }
}

import { Rng } from './rng';

export type CallerInput = { type: 'digits'; value: string } | { type: 'speech'; text: string };

/** What the simulated company can do to the line. The engine never sees the caller's goal. */
export interface SimIO {
  /** One sentence of speech heard by the caller. */
  speak(sentence: string): void;
  music(on: boolean): void;
  /** The company ends the call. */
  hangup(reason: string): void;
  /** A live person is now on the line (the simulation stops driving it). */
  humanAnswered(): void;
}

export interface MenuOption<T> {
  keys?: string[];
  /** What the company's speech recognizer understands for this option. */
  speech?: RegExp;
  value: T;
}

export interface MenuSpec<T> {
  /** Re-spoken on each attempt; a function lets wording change between attempts. */
  prompt: string | ((attempt: number) => string);
  options: MenuOption<T>[];
  /** Returned when the caller says/presses nothing (e.g. "stay on the line"). Without it, silence counts as a failed attempt. */
  onSilence?: T;
  /** Returned after too many failed attempts; without it the company hangs up. */
  onGiveUp?: T;
  attempts?: number;
  /** Seconds to wait for input after the prompt. */
  waitSeconds?: number;
  /** "Sorry, I need you to say it" style hint when the wrong modality is used. */
  speechOnly?: boolean;
}

export class CallOver extends Error {}

/**
 * Runs one simulated call: speaks prompts sentence by sentence with human-ish
 * pacing, accepts key presses and speech at any time (barge-in), retries,
 * mishears, times out and hangs up the way a real IVR does.
 */
export class SimCall {
  private inbox: CallerInput[] = [];
  private waiter: ((i: CallerInput | null) => void) | null = null;
  private timers = new Set<NodeJS.Timeout>();
  private over = false;
  readonly transcript: string[] = [];

  constructor(
    readonly rng: Rng,
    private readonly io: SimIO,
    /** Multiplies every delay (1 = real time, 0.01 = tests). */
    private readonly scale = 1,
    /** Chance the company's speech recognizer mishears a correct answer. */
    private readonly mishearRate = 0.1,
  ) {}

  get ended() {
    return this.over;
  }

  /** Caller pressed keys or spoke. */
  input(i: CallerInput) {
    if (this.over) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(i);
    } else this.inbox.push(i);
  }

  end() {
    this.over = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.waiter?.(null);
    this.waiter = null;
  }

  private check() {
    if (this.over) throw new CallOver();
  }

  pause(seconds: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.over ? reject(new CallOver()) : resolve();
      }, seconds * 1000 * this.scale);
      this.timers.add(t);
    });
  }

  /** Speaks text one sentence at a time, roughly at speaking pace. */
  async say(text: string, pauseAfter = 0.3) {
    const sentences = text.match(/[^.?!]+[.?!]+["”']?|[^.?!]+$/g) ?? [text];
    for (const raw of sentences) {
      this.check();
      const s = raw.trim();
      if (!s) continue;
      this.io.speak(s);
      this.transcript.push(s);
      await this.pause(Math.min(4, 0.25 + s.split(/\s+/).length * 0.12));
    }
    if (pauseAfter) await this.pause(pauseAfter);
  }

  /** Next caller input, or null after `seconds` of silence. Input given during prompts counts. */
  async listen(seconds: number): Promise<CallerInput | null> {
    this.check();
    const queued = this.inbox.shift();
    if (queued) return queued;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.waiter = null;
        resolve(null);
      }, seconds * 1000 * this.scale);
      this.timers.add(t);
      this.waiter = (i) => {
        clearTimeout(t);
        this.timers.delete(t);
        resolve(i);
      };
    }).then((i) => {
      this.check();
      return i as CallerInput | null;
    });
  }

  /** Drops anything the caller said/pressed earlier (e.g. before a new prompt). */
  flushInput() {
    this.inbox = [];
  }

  /** Classic IVR prompt: speak, collect, match, retry, give up. */
  async menu<T>(spec: MenuSpec<T>): Promise<T> {
    const attempts = spec.attempts ?? 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      this.flushInput();
      await this.say(typeof spec.prompt === 'function' ? spec.prompt(attempt) : spec.prompt, 0.2);
      const got = await this.listen(spec.waitSeconds ?? 8);
      if (!got) {
        if (spec.onSilence !== undefined) return spec.onSilence;
        if (attempt < attempts - 1) await this.say(this.rng.pick(["Sorry, I didn't hear anything.", "I didn't get a response.", 'Are you still there?']));
        continue;
      }
      if (got.type === 'digits') {
        if (spec.speechOnly) {
          await this.say(this.rng.pick(['Sorry, I need you to say it.', 'You can just tell me in a few words.']));
          continue;
        }
        const hit = spec.options.find((o) => o.keys?.includes(got.value));
        if (hit) return hit.value;
      } else {
        const misheard = this.rng.chance(this.mishearRate);
        const hit = misheard ? undefined : spec.options.find((o) => o.speech?.test(got.text));
        if (hit) return hit.value;
      }
      if (attempt < attempts - 1) {
        await this.say(this.rng.pick(["Sorry, I didn't get that.", "I'm sorry, that's not a valid option.", "Hmm, I didn't quite catch that."]));
      }
    }
    if (spec.onGiveUp !== undefined) return spec.onGiveUp;
    await this.hangup("We're having trouble understanding you. Please try your call again later. Goodbye.");
    throw new CallOver();
  }

  async hangup(message: string, reason = 'remote-hangup') {
    if (message) await this.say(message, 0.5).catch(() => {});
    if (!this.over) {
      this.io.hangup(reason);
      this.end();
    }
    throw new CallOver();
  }

  /** Line goes dead without a goodbye (network drop, queue overflow). */
  drop() {
    if (this.over) return;
    this.io.hangup('dropped');
    this.end();
    throw new CallOver();
  }

  music(on: boolean) {
    this.io.music(on);
  }

  humanAnswered() {
    this.io.humanAnswered();
  }
}

import { validateDecision, type CallStatus, type IvrDecision } from '@holdless/shared';
import { isConsequentialOption, parseMenuOptions } from './ai/rules';
import type { AgentTurn, IvrAgent } from './ai/types';
import { classifyHuman, combineConfidence, isHoldAnnouncement, scoreHumanLikelihood } from './detection/human';
import { log } from './log';
import type { CallSnapshot, CallStore } from './store/types';
import type { AudioSignal, SpeechSegment, TelephonyProvider } from './telephony/types';

export interface RunnerSettings {
  humanThreshold: number;
  possibleHumanThreshold: number;
  utteranceGapMs: number;
  /** Longer pause allowed mid-menu: after hearing an option, wait this long for more before acting. Default 2.5× utteranceGapMs. */
  menuGapMs?: number;
  maxKeyPresses: number;
  maxHoldMinutes: number;
  userAnswerTimeoutSeconds: number;
}

export interface RunnerDeps {
  store: CallStore;
  telephony: TelephonyProvider;
  agent: IvrAgent;
  settings: RunnerSettings;
  /** Optional out-of-band status updates (e.g. iMessage). */
  notify?: (callId: bigint, message: string) => void;
  onFinished?: (callId: bigint) => void;
}

type Phase = 'dialing' | 'ivr' | 'hold' | 'handoff' | 'connected' | 'done';

const LINE_LABEL = {
  mock: 'simulated line (mock mode)',
  hybrid: 'simulated company line — the callback to you is a real phone call',
  twilio: 'Twilio',
} as const;

const MAX_LOW_CONFIDENCE = 4;
const MAX_REDIALS = 2;
const MENU_LINE = /\b(press|dial|oprima|marque)\s+(\d|one|two|three|four|five|six|seven|eight|nine|zero|star|pound)\b|,\s*say\b/i;
const MENU_CLOSER = /\b(hear (these|the|those) options again|to repeat|main menu|previous menu|stay on the line|otherwise|para español)\b|\?\s*$/i;
const CLOSED_HINT = /\b(closed|business hours|call back (during|between))\b/i;
const VERIFY_HINT = /\b(verif(y|ication)|security|identity)\b/i;
const MAX_SAME_MENU = 3;
const MAX_USER_ATTEMPTS = 2;
const REP_PARK_MESSAGE = "Thanks for picking up! One moment please, I'm connecting you with the account holder now.";

/**
 * Drives one support call from dial to handoff. Every observable step is
 * written to the CallStore (SpacetimeDB), which the dashboard subscribes to.
 */
export class CallRunner {
  private phase: Phase = 'dialing';
  private status: CallStatus = 'PREPARING';
  private buffer: string[] = [];
  private bufferConfidence: number[] = [];
  private flushTimer?: NodeJS.Timeout;
  private holdTimer?: NodeJS.Timeout;
  private userTimer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  private history: AgentTurn[] = [];
  private menuCounts = new Map<string, number>();
  private keyPresses = 0;
  private lowConfidence = 0;
  private humanConfidence = 0;
  private musicStoppedAt = 0;
  private sawMusic = false;
  private ivrAnnounced = false;
  private userAttempts = 0;
  private lastMenuLabel = '';
  private dialAttempt = 0;
  private redials = 0;
  private lastHeard = '';

  constructor(
    private readonly call: CallSnapshot,
    private readonly deps: RunnerDeps,
  ) {}

  get id() {
    return this.call.id;
  }

  get currentPhase() {
    return this.phase;
  }

  /** Serializes all work so callbacks from the phone line never interleave. */
  private enqueue(fn: () => Promise<void>) {
    this.queue = this.queue.then(fn).catch((err) => {
      log.error(`call ${this.id}: ${(err as Error).stack ?? err}`);
      return this.fail(`Internal error: ${(err as Error).message}`);
    });
    return this.queue;
  }

  /** Resolves once all queued work has run (used by tests). */
  idle() {
    return this.queue;
  }

  private async setStatus(status: CallStatus, opts?: { menuContext?: string; summary?: string }) {
    if (this.phase === 'done') return;
    this.status = status;
    await this.deps.store.setStatus(this.id, status, opts);
  }

  private notify(message: string) {
    this.deps.notify?.(this.id, message);
  }

  start() {
    return this.enqueue(() => this.dial());
  }

  private async dial() {
    const { store, telephony } = this.deps;
    const attempt = ++this.dialAttempt;
    const redial = attempt > 1;
    await this.setStatus('DIALING', { summary: `${redial ? 'Calling back' : 'Dialing'} ${this.call.companyName}` });
    await store.agent(this.id, 'ACTING', `${redial ? 'Calling back' : 'Dialing'} ${this.call.companyName}…`);
    await store.event(this.id, {
      type: 'OUTBOUND_CALL_STARTED',
      actor: 'TELEPHONY',
      title: redial ? `Calling ${this.call.companyName} back` : `Calling ${this.call.companyName}`,
      description: `${this.call.phoneNumber} via ${LINE_LABEL[telephony.name]}`,
      dedupeKey: `dial-${attempt}`,
    });
    if (!redial) this.notify(`Calling ${this.call.companyName} for you.`);
    // Callbacks from an earlier, dropped attempt are ignored.
    const current = () => attempt === this.dialAttempt;
    try {
      const { sid } = await telephony.startSupportCall(
        { callId: this.id, to: this.call.phoneNumber },
        {
          onAnswered: () => current() && void this.enqueue(() => this.onAnswered()),
          onSpeech: (s) => current() && this.onSpeech(s),
          onAudio: (a) => current() && this.onAudio(a),
          onEnded: (reason, failed) => {
            if (!current()) return;
            // Hear out the last words (e.g. "...we're closed. Goodbye.") before reacting to the hang-up.
            clearTimeout(this.flushTimer);
            this.flush();
            void this.enqueue(() => this.onSupportEnded(reason, failed));
          },
        },
      );
      await store.sids(this.id, { supportCallSid: sid });
    } catch (err) {
      await this.fail(`Could not place the call: ${(err as Error).message}`);
    }
  }

  cancel() {
    return this.enqueue(async () => {
      if (this.phase === 'done') return;
      this.phase = 'done';
      this.clearTimers();
      await this.deps.telephony.hangup(this.id).catch(() => {});
      await this.deps.store.complete(this.id, 'You ended the call.');
      this.deps.onFinished?.(this.id);
    });
  }

  private async onAnswered() {
    if (this.phase !== 'dialing') return;
    this.phase = 'ivr';
    await this.setStatus('CONNECTED_TO_IVR', { summary: 'Call connected' });
    await this.deps.store.event(this.id, {
      type: 'INFO',
      actor: 'TELEPHONY',
      title: 'Call connected',
      dedupeKey: 'support-answered',
    });
    await this.setStatus('LISTENING', { summary: 'Listening…' });
    await this.deps.store.agent(this.id, 'LISTENING', 'Listening…');
  }

  private onSpeech(segment: SpeechSegment) {
    if (this.phase === 'done' || this.phase === 'connected') return;
    this.buffer.push(segment.text);
    this.bufferConfidence.push(segment.confidence);
    clearTimeout(this.flushTimer);
    // Let them finish the menu: options are read with pauses between them, so after an
    // option (and no "to hear these again"-style closer) give it longer before acting.
    const { utteranceGapMs, menuGapMs } = this.deps.settings;
    const midMenu = MENU_LINE.test(segment.text) && !MENU_CLOSER.test(segment.text);
    this.flushTimer = setTimeout(() => this.flush(), midMenu ? (menuGapMs ?? utteranceGapMs * 2.5) : utteranceGapMs);
  }

  private flush() {
    if (this.buffer.length === 0) return;
    const text = this.buffer.join(' ').replace(/\s+/g, ' ').trim();
    const confidence = this.bufferConfidence.reduce((a, b) => a + b, 0) / this.bufferConfidence.length;
    this.buffer = [];
    this.bufferConfidence = [];
    void this.enqueue(() => this.handleUtterance(text, confidence));
  }

  private onAudio(signal: AudioSignal) {
    if (signal === 'music') {
      this.sawMusic = true;
      if (this.phase === 'ivr') void this.enqueue(() => this.enterHold('Hold music detected.'));
    } else if (signal === 'speech' && this.sawMusic) {
      this.musicStoppedAt = Date.now();
    }
  }

  private async handleUtterance(text: string, sttConfidence: number) {
    const { store, agent, settings } = this.deps;
    if (this.phase === 'done' || this.phase === 'connected') return;
    this.lastHeard = text;

    const onHold = this.phase === 'hold';
    const heuristic = scoreHumanLikelihood(text, {
      wasOnHold: onHold,
      musicStopped: Date.now() - this.musicStoppedAt < 10_000,
      previousConfidence: this.humanConfidence,
    });
    const menu = parseMenuOptions(text);
    const automated = heuristic.negative.length > 0 || menu.length > 0;
    const speaker = this.phase === 'handoff' ? 'HUMAN_REP' : automated ? 'AUTOMATED_SYSTEM' : heuristic.score >= 0.5 ? 'HUMAN_REP' : 'UNKNOWN';
    await store.transcript(this.id, speaker, text, sttConfidence);

    // After handoff starts we only keep the transcript; the AI never responds to the representative.
    if (this.phase === 'handoff') return;

    if (automated && !this.ivrAnnounced) {
      this.ivrAnnounced = true;
      await store.event(this.id, { type: 'IVR_DETECTED', actor: 'IVR', title: 'Automated system detected', dedupeKey: 'ivr-detected' });
    }

    await store.agent(this.id, 'THINKING', onHold ? 'Checking whether a human answered…' : 'Choosing the best menu option…');
    if (!onHold) await this.setStatus('REASONING');

    const out = await agent.decide({
      companyName: this.call.companyName,
      userGoal: this.call.userGoal,
      userContext: this.call.userContext,
      transcript: text,
      onHold,
      history: this.history,
    });
    if (out.note) await store.event(this.id, { type: 'INFO', actor: 'SYSTEM', title: out.note, dedupeKey: 'reasoning-fallback' });

    const validation = validateDecision(out.raw, { transcript: text, userContext: this.call.userContext });
    const decision = validation.decision;

    const llmHuman = out.source === 'gemini' ? decision.humanLikelihood : null;
    this.humanConfidence = combineConfidence(heuristic.score, llmHuman);
    await store.humanConfidence(this.id, this.humanConfidence);
    const verdict = classifyHuman(this.humanConfidence, heuristic, {
      detected: settings.humanThreshold,
      possible: settings.possibleHumanThreshold,
    });

    const turn: AgentTurn = { heard: text };
    this.history.push(turn);

    if (verdict === 'DETECTED') {
      turn.action = 'Transferred to user (human detected)';
      const cues = heuristic.positive.filter((c) => c !== 'speech after hold' && c !== 'hold music stopped').slice(0, 2);
      const evidence = `${capitalize(cues.join(' and ') || 'Conversational speech')}: “${truncate(text, 120)}”`;
      return this.handoff('human', evidence, decision);
    }
    if (decision.situation === 'VERIFICATION' && decision.action === 'TRANSFER_TO_USER' && validation.ok) {
      turn.action = 'Handed off for verification';
      return this.handoff('verification', decision.explanation, decision);
    }
    if (verdict === 'POSSIBLE') {
      turn.action = 'Waited (possible human)';
      if (this.status !== 'POSSIBLE_HUMAN') {
        await this.setStatus('POSSIBLE_HUMAN', { summary: 'Someone may have picked up — confirming' });
        await store.event(this.id, {
          type: 'HUMAN_SUSPECTED',
          actor: 'AI',
          title: 'Possible representative',
          description: `${Math.round(this.humanConfidence * 100)}% confident — waiting for confirmation before calling you.`,
        });
      }
      await store.agent(this.id, 'LISTENING', 'Checking whether a human answered…');
      return;
    }

    if (!validation.ok) {
      turn.action = 'Waited (low confidence)';
      this.lowConfidence++;
      await store.event(this.id, { type: 'LOW_CONFIDENCE', actor: 'AI', title: 'Not confident — holding off', description: validation.reason });
      await store.action(this.id, {
        actionType: 'WAIT',
        reasoningSummary: validation.reason,
        actionValue: '',
        confidence: decision.confidence,
        status: 'SKIPPED',
      });
      if (this.phase === 'ivr' && this.lowConfidence >= MAX_LOW_CONFIDENCE) {
        return this.fail('Could not confidently choose a menu option. Stopping rather than guessing.');
      }
      return this.resumeListening();
    }

    switch (decision.action) {
      case 'PRESS_KEY':
        turn.action = `Pressed ${decision.value}`;
        return this.pressKey(text, decision, menu);
      case 'SPEAK':
        turn.action = `Said "${decision.value}"`;
        return this.speak(decision);
      case 'END_CALL':
        if (decision.confidence >= 0.8) return this.fail(`The phone system ended the conversation: ${decision.explanation}`);
        return this.resumeListening();
      case 'TRANSFER_TO_USER':
      case 'WAIT':
        turn.action = 'Waited';
        if (decision.situation === 'HOLD' || isHoldAnnouncement(text)) return this.enterHold(decision.explanation);
        return this.resumeListening();
    }
  }

  private async resumeListening() {
    if (this.phase === 'hold') {
      if (this.status !== 'ON_HOLD') await this.setStatus('ON_HOLD', { summary: 'Waiting on hold' });
      await this.deps.store.agent(this.id, 'WAITING', 'Waiting on hold');
    } else {
      if (this.status === 'REASONING' || this.status === 'POSSIBLE_HUMAN') await this.setStatus('LISTENING');
      await this.deps.store.agent(this.id, 'LISTENING', 'Listening…');
    }
  }

  private async pressKey(text: string, decision: IvrDecision, menu: ReturnType<typeof parseMenuOptions>) {
    const { store, telephony, settings } = this.deps;
    const menuKey = text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120);
    const seen = (this.menuCounts.get(menuKey) ?? 0) + 1;
    this.menuCounts.set(menuKey, seen);
    if (seen >= MAX_SAME_MENU) return this.fail('IVR loop detected — the same menu kept repeating.');
    if (++this.keyPresses > settings.maxKeyPresses) return this.fail('Too many menu levels without reaching a person.');

    const rawLabel = menu.find((o) => o.key === decision.value)?.label ?? '';
    if (rawLabel && isConsequentialOption(rawLabel)) {
      // Hard stop regardless of what the reasoning engine decided: never buy, pay or cancel on your behalf.
      await store.event(this.id, {
        type: 'LOW_CONFIDENCE',
        actor: 'AI',
        title: `Refused “${truncate(rawLabel, 60)}”`,
        description: 'That option would buy, pay or cancel something. HoldLess never does that for you.',
      });
      return this.resumeListening();
    }
    const label = capitalize(rawLabel || `option ${decision.value}`);
    this.lowConfidence = 0;
    this.lastMenuLabel = label;

    await store.event(this.id, { type: 'TRANSCRIPT_RECEIVED', actor: 'IVR', title: `Heard: “${truncate(text, 110)}”` });
    await store.event(this.id, {
      type: 'MENU_OPTION_IDENTIFIED',
      actor: 'AI',
      title: `Selected “${label}”`,
      description: decision.explanation,
      metadata: { key: decision.value, confidence: decision.confidence },
    });
    await this.setStatus('SENDING_DTMF', { menuContext: label, summary: `Pressing ${decision.value} for ${label}` });
    await store.agent(this.id, 'ACTING', `Pressing ${decision.value} for ${label}`);
    try {
      await telephony.sendDigits(this.id, decision.value);
    } catch (err) {
      await store.action(this.id, {
        actionType: 'PRESS_KEY',
        reasoningSummary: decision.explanation,
        actionValue: decision.value,
        confidence: decision.confidence,
        status: 'FAILED',
      });
      return this.fail(`Could not send key press: ${(err as Error).message}`);
    }
    await store.action(this.id, {
      actionType: 'PRESS_KEY',
      reasoningSummary: decision.explanation,
      actionValue: decision.value,
      confidence: decision.confidence,
      status: 'EXECUTED',
    });
    await store.event(this.id, { type: 'DTMF_SENT', actor: 'AI', title: `Pressed ${decision.value}`, description: label });
    if (this.phase === 'hold') return this.resumeListening();
    this.notify(`Selected ${label} in the ${this.call.companyName} menu.`);
    await this.setStatus('NAVIGATING_MENU', { menuContext: label, summary: `Selected ${label}` });
    await store.agent(this.id, 'LISTENING', 'Listening for the next prompt…');
  }

  private async speak(decision: IvrDecision) {
    const { store, telephony } = this.deps;
    await this.setStatus('SPEAKING', { summary: `Saying “${decision.value}”` });
    await store.agent(this.id, 'ACTING', `Saying “${decision.value}”`);
    await telephony.speak(this.id, decision.value);
    await store.action(this.id, {
      actionType: 'SPEAK',
      reasoningSummary: decision.explanation,
      actionValue: decision.value,
      confidence: decision.confidence,
      status: 'EXECUTED',
    });
    await store.event(this.id, { type: 'SPOKE', actor: 'AI', title: `Said “${decision.value}”`, description: decision.explanation });
    if (this.phase === 'hold') return this.resumeListening();
    await this.setStatus('LISTENING');
    await store.agent(this.id, 'LISTENING', 'Listening…');
  }

  private async enterHold(explanation: string) {
    const { store, settings } = this.deps;
    if (this.phase === 'hold') return this.resumeListening();
    if (this.phase !== 'ivr') return;
    this.phase = 'hold';
    await this.setStatus('ON_HOLD', { summary: 'Waiting on hold', menuContext: this.lastMenuLabel || undefined });
    await store.event(this.id, {
      type: 'HOLD_DETECTED',
      actor: 'AI',
      title: 'Entered the support queue',
      description: explanation,
      dedupeKey: 'hold-detected',
    });
    await store.action(this.id, {
      actionType: 'WAIT',
      reasoningSummary: 'On hold — waiting for a representative so you don’t have to.',
      actionValue: '',
      confidence: 0.9,
      status: 'EXECUTED',
    });
    await store.agent(this.id, 'WAITING', 'Waiting on hold');
    this.notify(`Got through the ${this.call.companyName} menu. I'm waiting on hold for you.`);
    this.holdTimer = setTimeout(
      () => void this.enqueue(() => this.fail(`No representative answered within ${settings.maxHoldMinutes} minutes.`)),
      settings.maxHoldMinutes * 60_000,
    );
  }

  private async handoff(reason: 'human' | 'verification', evidence: string, decision: IvrDecision) {
    const { store, telephony } = this.deps;
    this.phase = 'handoff';
    clearTimeout(this.holdTimer);
    if (reason === 'human') {
      await store.humanDetected(this.id, this.humanConfidence, evidence);
      this.status = 'HUMAN_DETECTED';
    } else {
      await store.event(this.id, {
        type: 'HANDOFF_REQUIRED',
        actor: 'AI',
        title: 'Your input is needed',
        description: evidence,
        dedupeKey: 'handoff-required',
      });
    }
    await store.action(this.id, {
      actionType: 'TRANSFER_TO_USER',
      reasoningSummary: reason === 'human' ? 'A live representative answered — handing the call to you.' : decision.explanation,
      actionValue: '',
      confidence: reason === 'human' ? this.humanConfidence : decision.confidence,
      status: 'EXECUTED',
    });
    if (reason === 'human') await telephony.holdForHandoff(this.id, REP_PARK_MESSAGE).catch((e) => log.warn(`park failed: ${e}`));
    this.notify(
      reason === 'human'
        ? `Found a representative at ${this.call.companyName}. Calling you now.`
        : `${this.call.companyName} needs verification only you can give. Calling you now.`,
    );
    await this.callUser(reason);
  }

  private briefing(reason: 'human' | 'verification') {
    const topic = goalTopic(this.call.userGoal);
    const who = this.lastMenuLabel ? `${this.call.companyName} ${this.lastMenuLabel.toLowerCase()}` : this.call.companyName;
    return reason === 'human'
      ? `Hi, it's HoldLess. A ${who} representative is on the line about ${topic}. Press 1 to connect.`
      : `Hi, it's HoldLess. ${this.call.companyName} is asking for verification about ${topic}. Press 1 to take over the call.`;
  }

  private async callUser(reason: 'human' | 'verification') {
    const { store, telephony, settings } = this.deps;
    this.userAttempts++;
    await this.setStatus('CALLING_USER', { summary: 'Calling you now…' });
    await store.event(this.id, {
      type: 'USER_CALLED',
      actor: 'TELEPHONY',
      title: this.userAttempts > 1 ? 'Calling you again' : 'Calling you',
      description: maskPhone(this.call.userPhoneNumber),
      dedupeKey: `user-called-${this.userAttempts}`,
    });
    await store.agent(this.id, 'HANDING_OFF', 'Calling your phone…');
    try {
      const { sid } = await telephony.startUserCall(
        { callId: this.id, to: this.call.userPhoneNumber, briefing: this.briefing(reason) },
        {
          onAccepted: () => void this.enqueue(() => this.onUserAccepted()),
          onBridged: () => void this.enqueue(() => this.onUserBridged()),
          onUnanswered: (why) => void this.enqueue(() => this.onUserUnanswered(why, reason)),
          onEnded: (why) => void this.enqueue(() => this.onUserEnded(why)),
        },
      );
      await store.sids(this.id, { userCallSid: sid });
    } catch (err) {
      return this.fail(`Could not call you: ${(err as Error).message}`);
    }
    clearTimeout(this.userTimer);
    this.userTimer = setTimeout(
      () => void this.enqueue(() => this.onUserUnanswered('timeout', reason)),
      settings.userAnswerTimeoutSeconds * 1000,
    );
  }

  private async onUserAccepted() {
    if (this.phase !== 'handoff') return;
    clearTimeout(this.userTimer);
    await this.setStatus('BRIDGING_USER', { summary: 'Connecting you to the representative' });
    await this.deps.store.agent(this.id, 'HANDING_OFF', 'Connecting you to the representative…');
    await this.deps.telephony.bridgeUser(this.id);
  }

  private async onUserBridged() {
    if (this.phase !== 'handoff') return;
    this.phase = 'connected';
    clearTimeout(this.userTimer);
    await this.deps.telephony.stopListening(this.id).catch(() => {});
    await this.deps.store.userConnected(this.id);
    this.status = 'USER_CONNECTED';
    this.notify("You're connected. The AI has left the call.");
  }

  private async onUserUnanswered(why: string, reason: 'human' | 'verification') {
    if (this.phase !== 'handoff' || this.status === 'BRIDGING_USER') return;
    clearTimeout(this.userTimer);
    if (this.userAttempts < MAX_USER_ATTEMPTS) {
      await this.deps.store.event(this.id, { type: 'INFO', actor: 'TELEPHONY', title: 'You didn’t pick up', description: why });
      return this.callUser(reason);
    }
    return this.fail('You did not answer, so the call was ended.');
  }

  private async onUserEnded(why: string) {
    if (this.phase === 'connected') {
      this.phase = 'done';
      this.clearTimers();
      await this.deps.telephony.hangup(this.id).catch(() => {});
      await this.deps.store.complete(this.id, 'Call ended.');
      this.deps.onFinished?.(this.id);
    } else if (this.phase === 'handoff' && this.status === 'BRIDGING_USER') {
      await this.fail(`Your line dropped before connecting (${why}).`);
    }
  }

  private async onSupportEnded(reason: string, failed: boolean) {
    if (this.phase === 'done') return;
    if (this.phase === 'connected') {
      this.phase = 'done';
      this.clearTimers();
      await this.deps.telephony.hangup(this.id).catch(() => {});
      await this.deps.store.complete(this.id, 'The representative ended the call.');
      this.deps.onFinished?.(this.id);
      return;
    }
    const lastWords = this.lastHeard;
    if (CLOSED_HINT.test(lastWords)) return this.fail(`${this.call.companyName} is closed right now: “${truncate(lastWords, 140)}”`);
    if (VERIFY_HINT.test(lastWords) && /goodbye|can'?t continue/i.test(lastWords)) {
      return this.fail(`${this.call.companyName} hung up because it needed verification only you can give.`);
    }
    const redialable = reason === 'dropped' || reason === 'busy' || reason === 'no-answer' || !failed;
    if ((this.phase === 'ivr' || this.phase === 'hold' || this.phase === 'dialing') && redialable && this.redials < MAX_REDIALS) {
      this.redials++;
      const why = reason === 'dropped' ? 'The call dropped' : reason === 'busy' ? 'The line was busy' : `${this.call.companyName} hung up`;
      await this.deps.store.event(this.id, {
        type: 'INFO',
        actor: 'AI',
        title: `${why} — calling back`,
        description: lastWords ? `Last heard: “${truncate(lastWords, 120)}”` : '',
        dedupeKey: `redial-${this.redials}`,
      });
      this.phase = 'dialing';
      clearTimeout(this.holdTimer);
      this.menuCounts.clear();
      this.keyPresses = 0;
      this.lowConfidence = 0;
      this.humanConfidence = 0;
      this.sawMusic = false;
      this.lastHeard = '';
      this.history.push({ heard: `(${why.toLowerCase()})`, action: 'Called back' });
      await sleep(reason === 'busy' ? 3000 : 1500);
      return this.dial();
    }
    const base = failed ? describeFailure(reason) : reason === 'dropped' ? 'The call dropped.' : `${this.call.companyName} disconnected the call.`;
    const msg = this.redials >= MAX_REDIALS ? `${base} Gave up after calling back ${this.redials} times.` : base;
    await this.fail(msg);
  }

  private clearTimers() {
    clearTimeout(this.flushTimer);
    clearTimeout(this.holdTimer);
    clearTimeout(this.userTimer);
  }

  private async fail(message: string) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.clearTimers();
    log.call(this.id, `FAILED: ${message}`);
    await this.deps.telephony.hangup(this.id).catch(() => {});
    await this.deps.store.fail(this.id, message);
    this.notify(`Call to ${this.call.companyName} failed: ${message}`);
    this.deps.onFinished?.(this.id);
  }
}

function describeFailure(reason: string): string {
  switch (reason) {
    case 'busy':
      return 'The line was busy.';
    case 'no-answer':
      return 'Nobody answered the support line.';
    case 'invalid-number':
      return 'The support number is invalid.';
    default:
      return `The call could not be completed (${reason}).`;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function goalTopic(goal: string) {
  return (
    goal
      .replace(/^(?:please\s+)?(?:i (?:want|need) to\s+)?(?:talk|speak) (?:to|with) (?:someone|a human|a person|an agent|a representative)\s+(?:about|regarding)\s+/i, '')
      .replace(/[.!]+$/, '')
      .replace(/^(an?|the|my)\s/i, (w) => (w.trim().toLowerCase() === 'my' ? 'your ' : `${w.toLowerCase()}`)) || 'your request'
  );
}

function maskPhone(p: string) {
  return p.length > 4 ? `•••• ${p.slice(-4)}` : p;
}

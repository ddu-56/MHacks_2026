import type { Express } from 'express';
import { WOLVERINE_REP_GREETING } from '@holdless/shared';
import { log } from '../log';
import type { MockTelephony } from './mock';
import type { TwilioTelephony } from './twilio';
import type { SupportLegHandlers, TelephonyProvider, UserLegHandlers } from './types';

/** How long the user may wait in "Connecting you now" for a ringing teammate before we fall back to Sarah. */
const REP_JOIN_GRACE_MS = 15_000;

/**
 * Hybrid demo mode (works on a Twilio trial with one number):
 * - The company's phone tree, hold queue and representative greeting are simulated.
 * - Everything involving people is a real phone call: the user gets a real
 *   callback and presses 1, and is then connected either to a teammate playing
 *   the representative (DEMO_REP_PHONE_NUMBER) or to a scripted "Sarah".
 */
export class HybridTelephony implements TelephonyProvider {
  readonly name = 'hybrid' as const;

  constructor(
    private readonly line: MockTelephony,
    private readonly phones: TwilioTelephony,
    private readonly repPhoneNumber = '',
  ) {}

  startSupportCall(opts: { callId: bigint; to: string }, handlers: SupportLegHandlers) {
    return this.line.startSupportCall(opts, handlers);
  }

  sendDigits(callId: bigint, digits: string) {
    return this.line.sendDigits(callId, digits);
  }

  speak(callId: bigint, text: string) {
    return this.line.speak(callId, text);
  }

  async holdForHandoff(callId: bigint, message: string) {
    await this.line.holdForHandoff(callId, message);
    if (!this.repPhoneNumber) return;
    // Ring the teammate now so they're waiting in the conference by the time the user presses 1.
    await this.phones.dialRepIntoRoom(callId, this.repPhoneNumber).catch((err) =>
      log.warn(`call ${callId}: couldn't ring the teammate rep (${(err as Error).message}); the scripted rep will answer instead`),
    );
  }

  startUserCall(opts: { callId: bigint; to: string; briefing: string }, handlers: UserLegHandlers) {
    return this.phones.startUserCall(opts, handlers);
  }

  async bridgeUser(callId: bigint) {
    if (this.repPhoneNumber && (await this.phones.waitForRep(callId, REP_JOIN_GRACE_MS))) {
      log.call(callId, 'bridging user to the teammate rep');
      return this.phones.bridgeUser(callId);
    }
    if (this.repPhoneNumber) {
      log.warn(`call ${callId}: teammate rep isn't on the line; the scripted rep answers instead`);
      await this.phones.dropRep(callId);
    }
    await this.phones.playToUser(callId, WOLVERINE_REP_GREETING);
  }

  async stopListening(callId: bigint) {
    await this.line.stopListening(callId);
  }

  async hangup(callId: bigint) {
    await Promise.all([this.line.hangup(callId), this.phones.hangup(callId)]);
  }

  getCallStatus(callId: bigint) {
    return this.line.getCallStatus(callId);
  }

  mount(app: Express) {
    this.phones.mount(app);
  }
}

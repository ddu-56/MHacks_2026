import type { Express } from 'express';
import type { WebSocket } from 'ws';

export interface SpeechSegment {
  text: string;
  confidence: number;
}

export type AudioSignal = 'music' | 'silence' | 'speech';

export interface SupportLegHandlers {
  onAnswered(): void;
  /** A finalized chunk of speech heard from the company's side of the call. */
  onSpeech(segment: SpeechSegment): void;
  /** Coarse audio classification, used as a hold / hold-ended hint. */
  onAudio(signal: AudioSignal): void;
  /** The leg ended or could not be established (busy, no-answer, failed, remote hangup). */
  onEnded(reason: string, failed: boolean): void;
}

export interface UserLegHandlers {
  /** The user picked up and confirmed they want to be connected. */
  onAccepted(): void;
  /** The user is now in the same audio path as the representative. */
  onBridged(): void;
  onUnanswered(reason: string): void;
  onEnded(reason: string): void;
}

/** mock = everything simulated · hybrid = simulated company line, real calls to people · twilio = all real */
export type TelephonyMode = 'mock' | 'hybrid' | 'twilio';

export interface TelephonyProvider {
  readonly name: TelephonyMode;
  startSupportCall(opts: { callId: bigint; to: string }, handlers: SupportLegHandlers): Promise<{ sid: string }>;
  sendDigits(callId: bigint, digits: string): Promise<void>;
  speak(callId: bigint, text: string): Promise<void>;
  /** Park the representative (short courtesy message + hold) while the user is being called. */
  holdForHandoff(callId: bigint, message: string): Promise<void>;
  startUserCall(opts: { callId: bigint; to: string; briefing: string }, handlers: UserLegHandlers): Promise<{ sid: string }>;
  /** Join the accepted user leg to the representative. Fires UserLegHandlers.onBridged when audio flows. */
  bridgeUser(callId: bigint): Promise<void>;
  /** Stop listening to the call; the AI is out of the loop from here on. */
  stopListening(callId: bigint): Promise<void>;
  hangup(callId: bigint): Promise<void>;
  getCallStatus(callId: bigint): Promise<string>;
  /** Providers that receive webhooks / media register their routes here. */
  mount?(app: Express): void;
  handleMediaSocket?(ws: WebSocket): void;
}

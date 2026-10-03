'use client';

import { AlertTriangle, Headphones, Music2, PhoneCall, PhoneOff, Users } from 'lucide-react';
import type { CallSession } from '@holdless/db';
import type { CallStatus } from '@holdless/shared';
import { formatDuration, holdMs, maskPhone, ms } from '@/lib/format';

/**
 * The one loud element on the page. Quiet while the AI navigates; becomes the
 * headline when we're holding, when a person answers, and when you're connected.
 */
export function Moment({ call, now }: { call: CallSession; now: number }) {
  const status = call.status as CallStatus;
  const hold = holdMs(call, now);

  if (status === 'ON_HOLD' || status === 'POSSIBLE_HUMAN') {
    return (
      <section className="row-in flex flex-wrap items-center gap-5 rounded-2xl border border-hold/30 bg-hold-soft px-5 py-5 sm:px-7">
        <span className="grid size-12 place-items-center rounded-full bg-surface text-hold shadow-card">
          <Music2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold tracking-[-0.01em] text-ink">
            {status === 'POSSIBLE_HUMAN' ? 'Someone may have picked up. Confirming…' : 'We’re on hold so you don’t have to be.'}
          </p>
          <p className="mt-0.5 text-[15px] text-ink-2">
            Your phone rings the moment a real person answers. You can close this tab.
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl font-medium tabular-nums tracking-[-0.03em] text-ink">{formatDuration(hold ?? 0)}</div>
          <div className="text-sm text-ink-2">on hold</div>
        </div>
      </section>
    );
  }

  if (status === 'HUMAN_DETECTED' || status === 'CALLING_USER' || status === 'BRIDGING_USER') {
    const bridging = status === 'BRIDGING_USER';
    return (
      <section
        aria-live="assertive"
        className="row-in flex flex-wrap items-center gap-6 rounded-2xl bg-human-strong px-6 py-7 text-white shadow-card sm:px-8"
      >
        <span className="ring grid size-16 shrink-0 place-items-center rounded-full bg-white text-human-strong">
          <PhoneCall className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.75rem] font-semibold leading-tight tracking-[-0.025em]">
            {bridging ? 'Connecting you to the representative…' : 'A representative picked up. Calling you now.'}
          </p>
          <p className="mt-1 text-[15px] text-white/85">
            {bridging
              ? 'Hang tight. You’ll be speaking directly with them in a second.'
              : `Answer your phone (${maskPhone(call.userPhoneNumber)}) and press 1. They’re being asked to hold briefly.`}
          </p>
        </div>
        {hold !== null && (
          <div className="text-right text-white/85">
            <div className="font-mono text-xl tabular-nums">{formatDuration(hold)}</div>
            <div className="text-sm">of hold time saved</div>
          </div>
        )}
      </section>
    );
  }

  if (status === 'USER_CONNECTED') {
    const since = ms(call.connectedAt) ?? now;
    return (
      <section aria-live="polite" className="row-in flex flex-wrap items-center gap-6 rounded-2xl border border-human/40 bg-human-soft px-6 py-6 sm:px-8">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-human-strong text-white">
          <Users className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-ink">You’re connected.</p>
          <p className="mt-1 text-[15px] text-ink-2">
            You’re talking to {call.companyName} directly. The AI has left the call and isn’t listening.
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl tabular-nums text-ink">{formatDuration(now - since)}</div>
          <div className="text-sm text-ink-2">on the call</div>
        </div>
      </section>
    );
  }

  if (status === 'FAILED') {
    return (
      <section role="alert" className="row-in flex items-start gap-4 rounded-2xl border border-danger/30 bg-danger-soft px-5 py-5 sm:px-7">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
        <div>
          <p className="font-semibold text-ink">The call didn’t go through.</p>
          <p className="mt-0.5 text-[15px] text-ink-2">{call.errorMessage || 'Something went wrong.'}</p>
        </div>
      </section>
    );
  }

  if (status === 'COMPLETED') {
    const hold = holdMs(call, now);
    return (
      <section className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 sm:px-7">
        <PhoneOff className="size-5 text-muted" />
        <p className="text-[15px] text-ink-2">
          {call.lastActionSummary || 'Call ended.'}
          {hold !== null && call.humanDetectedAt ? ` HoldLess sat through ${formatDuration(hold)} of hold for you.` : ''}
        </p>
      </section>
    );
  }

  return (
    <section className="flex items-center gap-3 px-1 text-[15px] text-ink-2">
      <Headphones className="size-4 text-ai" />
      HoldLess is working the phone menu. Nothing for you to do yet.
    </section>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import type { Timestamp } from 'spacetimedb';
import { isTerminal, type CallStatus } from '@holdless/shared';

export function ms(ts: Timestamp | undefined | null): number | null {
  return ts ? Number(ts.microsSinceUnixEpoch / 1000n) : null;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatDuration(totalMs: number) {
  const s = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatClock(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export type Tone = 'neutral' | 'ai' | 'hold' | 'human' | 'done' | 'danger';

export function toneOf(status: CallStatus): Tone {
  switch (status) {
    case 'REQUESTED':
    case 'PREPARING':
    case 'DIALING':
      return 'neutral';
    case 'ON_HOLD':
    case 'POSSIBLE_HUMAN':
      return 'hold';
    case 'HUMAN_DETECTED':
    case 'CALLING_USER':
    case 'BRIDGING_USER':
    case 'USER_CONNECTED':
      return 'human';
    case 'COMPLETED':
      return 'done';
    case 'FAILED':
      return 'danger';
    default:
      return 'ai';
  }
}

export const TONE_CLASSES: Record<Tone, { text: string; bg: string; dot: string; border: string }> = {
  neutral: { text: 'text-ink-2', bg: 'bg-sunken', dot: 'bg-muted', border: 'border-line' },
  ai: { text: 'text-ai', bg: 'bg-ai-soft', dot: 'bg-ai', border: 'border-ai/30' },
  hold: { text: 'text-hold', bg: 'bg-hold-soft', dot: 'bg-hold', border: 'border-hold/30' },
  human: { text: 'text-human-strong', bg: 'bg-human-soft', dot: 'bg-human', border: 'border-human/40' },
  done: { text: 'text-ink-2', bg: 'bg-sunken', dot: 'bg-muted', border: 'border-line' },
  danger: { text: 'text-danger', bg: 'bg-danger-soft', dot: 'bg-danger', border: 'border-danger/30' },
};

/** Elapsed time of a call: frozen once it ends. */
export function elapsedMs(call: { startedAt: Timestamp; endedAt?: Timestamp; status: string }, now: number) {
  const start = ms(call.startedAt)!;
  const end = isTerminal(call.status as CallStatus) ? ms(call.endedAt) ?? now : now;
  return end - start;
}

export function holdMs(
  call: { holdStartedAt?: Timestamp; humanDetectedAt?: Timestamp; endedAt?: Timestamp },
  now: number,
) {
  const start = ms(call.holdStartedAt);
  if (start === null) return null;
  const end = ms(call.humanDetectedAt) ?? ms(call.endedAt) ?? now;
  return end - start;
}

export function maskPhone(p: string) {
  return p.length > 4 ? `•••• ${p.slice(-4)}` : p;
}

/** True only for rows that arrived after the first render, so live inserts animate but a page load doesn't. */
export function useFreshRows(ids: string[]) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null && ids.length > 0) initial.current = new Set(ids);
  return (id: string) => initial.current !== null && !initial.current.has(id);
}

/** How each telephony mode is described to viewers. Simulated parts are always labeled. */
export const MODE_COPY: Record<string, { chip: string; title: string; demo: string; badge: string | null }> = {
  mock: {
    chip: 'Simulated phone line',
    title: 'TELEPHONY_MODE=mock — no real calls are placed',
    demo: 'simulated line',
    badge: 'Simulated line',
  },
  hybrid: {
    chip: 'Simulated line · real callback',
    title: 'TELEPHONY_MODE=hybrid — the company line is simulated; calls to you (and the rep) are real',
    demo: 'simulated company line, real call to you',
    badge: 'Simulated company line · real callback',
  },
  twilio: { chip: 'Twilio · live phone', title: 'Real calls over Twilio', demo: 'real phone call', badge: null },
};

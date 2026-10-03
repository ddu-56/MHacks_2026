'use client';

import {
  AlertTriangle,
  Bot,
  CircleHelp,
  Ear,
  Grid3x3,
  Info,
  ListChecks,
  MessageSquare,
  Music2,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  ShieldAlert,
  User,
  UserCheck,
  UserSearch,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { CallEvent } from '@holdless/db';
import { formatClock, ms, useFreshRows } from '@/lib/format';

const STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  CALL_REQUESTED: { icon: User, tone: 'text-ink-2 bg-sunken' },
  OUTBOUND_CALL_STARTED: { icon: PhoneOutgoing, tone: 'text-ink-2 bg-sunken' },
  IVR_DETECTED: { icon: Bot, tone: 'text-ai bg-ai-soft' },
  TRANSCRIPT_RECEIVED: { icon: Ear, tone: 'text-ink-2 bg-sunken' },
  MENU_OPTION_IDENTIFIED: { icon: ListChecks, tone: 'text-ai bg-ai-soft' },
  DTMF_SENT: { icon: Grid3x3, tone: 'text-ai bg-ai-soft' },
  SPOKE: { icon: MessageSquare, tone: 'text-ai bg-ai-soft' },
  HOLD_DETECTED: { icon: Music2, tone: 'text-hold bg-hold-soft' },
  HUMAN_SUSPECTED: { icon: UserSearch, tone: 'text-hold bg-hold-soft' },
  HUMAN_DETECTED: { icon: UserCheck, tone: 'text-white bg-human-strong' },
  USER_CALLED: { icon: PhoneIncoming, tone: 'text-human-strong bg-human-soft' },
  USER_CONNECTED: { icon: Users, tone: 'text-white bg-human-strong' },
  CALL_COMPLETED: { icon: PhoneOff, tone: 'text-ink-2 bg-sunken' },
  CALL_FAILED: { icon: AlertTriangle, tone: 'text-danger bg-danger-soft' },
  LOW_CONFIDENCE: { icon: CircleHelp, tone: 'text-hold bg-hold-soft' },
  HANDOFF_REQUIRED: { icon: ShieldAlert, tone: 'text-hold bg-hold-soft' },
  INFO: { icon: Info, tone: 'text-ink-2 bg-sunken' },
};

export function Timeline({ events }: { events: readonly CallEvent[] }) {
  const sorted = [...events].sort((a, b) => (ms(a.timestamp) ?? 0) - (ms(b.timestamp) ?? 0) || Number(a.id - b.id));
  const fresh = useFreshRows(sorted.map((e) => e.id.toString()));
  return (
    <section aria-labelledby="timeline" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 id="timeline" className="text-base font-semibold">
          Live timeline
        </h2>
        <span className="text-xs text-muted">synced from SpacetimeDB</span>
      </div>
      <ol className="relative flex flex-col" aria-live="polite">
        {sorted.map((e, i) => {
          const s = STYLE[e.type] ?? STYLE.INFO!;
          const Icon = s.icon;
          const last = i === sorted.length - 1;
          return (
            <li key={e.id.toString()} className={`${fresh(e.id.toString()) ? 'row-in ' : ''}relative grid grid-cols-[5.5rem_2rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0`}>
              <time className="pt-1 text-right font-mono text-xs tabular-nums text-muted">{formatClock(ms(e.timestamp)!)}</time>
              <div className="relative flex justify-center">
                {!last && <span className="absolute top-8 bottom-[-1rem] w-px bg-line" aria-hidden />}
                <span className={`relative grid size-7 place-items-center rounded-full ${s.tone}`}>
                  <Icon className="size-3.5" strokeWidth={2.25} />
                </span>
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="text-[15px] font-medium leading-snug text-ink">{e.title}</p>
                {e.description && <p className="mt-0.5 text-sm leading-snug text-ink-2">{e.description}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

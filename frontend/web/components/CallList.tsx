'use client';

import Link from 'next/link';
import { ChevronRight, PhoneOff } from 'lucide-react';
import { useTable } from 'spacetimedb/react';
import { tables, type CallSession } from '@holdless/db';
import { isTerminal, type CallStatus } from '@holdless/shared';
import { elapsedMs, formatDuration, holdMs, ms, useNow } from '@/lib/format';
import { PhaseStepper, StatusPill } from './status';

export function CallList() {
  const [calls, ready] = useTable(tables.callSession);
  const now = useNow();
  const sorted = [...calls].filter((c) => c.source !== 'test').sort((a, b) => (ms(b.startedAt) ?? 0) - (ms(a.startedAt) ?? 0));
  const active = sorted.filter((c) => !isTerminal(c.status as CallStatus));
  const recent = sorted.filter((c) => isTerminal(c.status as CallStatus)).slice(0, 8);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="active-calls">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="active-calls" className="text-lg font-semibold tracking-[-0.015em]">
            On the line
          </h2>
          <span className="font-mono text-xs text-muted">{active.length} active</span>
        </div>
        {!ready ? (
          <div className="h-28 animate-pulse rounded-2xl bg-sunken" />
        ) : active.length === 0 ? (
          <div className="flex items-center gap-4 rounded-2xl border border-dashed border-line-strong px-5 py-8 text-ink-2">
            <PhoneOff className="size-5 shrink-0 text-muted" />
            <p className="text-[15px]">
              No calls in progress. Hit <span className="font-medium text-ink">Run demo</span> or describe who you need, and we’ll take it
              from there.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((c) => (
              <li key={c.id.toString()}>
                <CallCard call={c} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-calls">
          <h2 id="recent-calls" className="mb-3 text-lg font-semibold tracking-[-0.015em]">
            Earlier
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {recent.map((c) => (
              <li key={c.id.toString()}>
                <Link href={`/calls/${c.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-sunken">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.companyName}</span>
                      <StatusPill status={c.status as CallStatus} />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {c.status === 'FAILED' ? c.errorMessage : c.userGoal}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted">{formatDuration(elapsedMs(c, now))}</span>
                  <ChevronRight className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CallCard({ call, now }: { call: CallSession; now: number }) {
  const status = call.status as CallStatus;
  const hold = holdMs(call, now);
  const detail =
    status === 'ON_HOLD' || status === 'POSSIBLE_HUMAN'
      ? `On hold for ${formatDuration(hold ?? 0)}`
      : status === 'HUMAN_DETECTED' || status === 'CALLING_USER'
        ? 'Representative found — calling you now…'
        : status === 'BRIDGING_USER'
          ? 'Connecting you…'
          : status === 'USER_CONNECTED'
            ? 'You’re talking to the representative'
            : call.currentMenuContext
              ? `Selected: ${call.currentMenuContext}`
              : call.lastActionSummary;
  const urgent = status === 'HUMAN_DETECTED' || status === 'CALLING_USER' || status === 'BRIDGING_USER';

  return (
    <Link
      href={`/calls/${call.id}`}
      className={`group row-in block rounded-2xl border bg-surface p-4 shadow-card transition hover:-translate-y-px hover:border-line-strong sm:p-5 ${
        urgent ? 'border-human/50' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{call.companyName}</h3>
          <p className="mt-0.5 truncate text-sm text-ink-2">Goal: {call.userGoal}</p>
        </div>
        <span className="shrink-0 font-mono text-sm tabular-nums text-ink-2">{formatDuration(elapsedMs(call, now))}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusPill status={status} />
        <span className={`text-sm ${urgent ? 'font-medium text-human-strong' : 'text-ink-2'}`}>{detail}</span>
      </div>
      <div className="mt-4">
        <PhaseStepper status={status} compact />
      </div>
    </Link>
  );
}

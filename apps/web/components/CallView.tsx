'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, LoaderCircle, PhoneOff, RotateCcw } from 'lucide-react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '@holdless/db';
import { isTerminal, type CallStatus } from '@holdless/shared';
import { elapsedMs, formatDuration, MODE_COPY, ms, useNow } from '@/lib/format';
import { AgentPanel, HumanMeter } from './AgentPanel';
import { Moment } from './Moment';
import { PhaseStepper, StatusPill } from './status';
import { Timeline } from './Timeline';
import { Transcript } from './Transcript';

export function CallView({ id }: { id: string }) {
  const callId = useMemo(() => {
    try {
      return BigInt(id);
    } catch {
      return -1n;
    }
  }, [id]);

  const [calls, callsReady] = useTable(tables.callSession.where((r) => r.id.eq(callId)));
  const [events] = useTable(tables.callEvent.where((r) => r.callId.eq(callId)));
  const [segments] = useTable(tables.transcriptSegment.where((r) => r.callId.eq(callId)));
  const [actions] = useTable(tables.callAction.where((r) => r.callId.eq(callId)));
  const [agents] = useTable(tables.agentStatus.where((r) => r.callId.eq(callId)));
  const cancelCall = useReducer(reducers.cancelCall);
  const requestCall = useReducer(reducers.requestCall);
  const [contexts] = useTable(tables.userContext.where((r) => r.callId.eq(callId)));
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const call = calls[0];
  if (!call) {
    return (
      <div className="py-24 text-center">
        {callsReady ? (
          <>
            <p className="text-lg font-medium">Call not found.</p>
            <Link href="/" className="mt-3 inline-block text-ai underline-offset-4 hover:underline">
              Back to all calls
            </Link>
          </>
        ) : (
          <LoaderCircle className="mx-auto size-6 animate-spin text-muted" aria-label="Loading call" />
        )}
      </div>
    );
  }

  const status = call.status as CallStatus;
  const live = !isTerminal(status);
  const sortedActions = [...actions].sort((a, b) => (ms(a.timestamp) ?? 0) - (ms(b.timestamp) ?? 0));

  const retry = async () => {
    setBusy(true);
    try {
      await requestCall({
        companyName: call.companyName,
        phoneNumber: call.phoneNumber,
        userGoal: call.userGoal,
        userPhoneNumber: call.userPhoneNumber,
        userContext: contexts.map((c) => c.value).join('\n'),
        source: 'web',
        demo: call.demo,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition hover:text-ink">
          <ArrowLeft className="size-4" />
          All calls
        </Link>
        {live ? (
          <button
            type="button"
            disabled={busy || call.cancelRequested}
            onClick={async () => {
              setBusy(true);
              try {
                await cancelCall({ callId });
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 transition hover:border-danger/40 hover:text-danger disabled:opacity-50"
          >
            <PhoneOff className="size-4" />
            {call.cancelRequested ? 'Ending…' : 'End call'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 transition hover:text-ink disabled:opacity-50"
          >
            <RotateCcw className="size-4" />
            Call again
          </button>
        )}
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-[2rem] font-semibold leading-none tracking-[-0.03em] sm:text-[2.4rem]">{call.companyName}</h1>
            <p className="mt-3 max-w-[60ch] text-[15px] text-ink-2">{call.userGoal}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusPill status={status} size="lg" />
              {call.currentMenuContext && !['USER_CONNECTED', 'COMPLETED', 'FAILED'].includes(status) && (
                <span className="rounded-full border border-line px-3 py-1 text-sm text-ink-2">Selected: {call.currentMenuContext}</span>
              )}
              {MODE_COPY[call.mode]?.badge && (
                <span className="rounded-full border border-dashed border-line-strong px-3 py-1 text-xs text-muted">
                  {MODE_COPY[call.mode]!.badge}
                </span>
              )}
            </div>
          </div>
          <div className="sm:text-right">
            <div className="font-mono text-[2.6rem] font-medium leading-none tabular-nums tracking-[-0.04em]">
              {formatDuration(elapsedMs(call, now))}
            </div>
            <div className="mt-2 text-sm text-muted">elapsed</div>
          </div>
        </div>
        <div className="mt-8">
          <PhaseStepper status={status} />
        </div>
      </section>

      <Moment call={call} now={now} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Timeline events={events} />
        <div className="flex flex-col gap-6">
          <AgentPanel agent={agents[0]} status={status} actions={sortedActions} />
          <HumanMeter confidence={call.humanConfidence} status={status} />
          <Transcript segments={segments} live={live && !['USER_CONNECTED', 'BRIDGING_USER'].includes(status)} />
        </div>
      </div>
    </div>
  );
}

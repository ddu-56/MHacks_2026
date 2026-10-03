'use client';

import { Bot } from 'lucide-react';
import type { AgentStatus, CallAction } from '@holdless/db';
import type { CallStatus } from '@holdless/shared';
import { useFreshRows } from '@/lib/format';

const ACTION_LABEL: Record<string, string> = {
  PRESS_KEY: 'Pressed',
  SPEAK: 'Said',
  WAIT: 'Waited',
  TRANSFER_TO_USER: 'Handed to you',
  END_CALL: 'Ended call',
};

export function AgentPanel({
  agent,
  status,
  actions,
}: {
  agent: AgentStatus | undefined;
  status: CallStatus;
  actions: CallAction[];
}) {
  const working = agent && !['DONE', 'ERROR', 'IDLE'].includes(agent.status);
  const decisions = actions.filter((a) => a.status !== 'SKIPPED' || a.actionType !== 'WAIT').slice(-4).reverse();
  const fresh = useFreshRows(decisions.map((a) => a.id.toString()));
  const handedOff = status === 'USER_CONNECTED' || status === 'COMPLETED';

  return (
    <section aria-labelledby="agent" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="agent" className="mb-4 text-base font-semibold">
        Agent activity
      </h2>
      <div className="flex items-center gap-3 rounded-xl bg-sunken px-4 py-3">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${working ? 'bg-ai text-white' : 'bg-line text-muted'}`}>
          <Bot className="size-4" />
        </span>
        <p aria-live="polite" className={`text-[15px] font-medium ${working ? 'text-ink' : 'text-ink-2'}`}>
          {handedOff ? 'Handed off. The AI is no longer on the line.' : agent?.currentTask || 'Waiting to start…'}
          {working && <span className="breathe ml-0.5 text-ai">●</span>}
        </p>
      </div>

      {decisions.length > 0 && (
        <ol className="mt-4 flex flex-col divide-y divide-line">
          {decisions.map((a) => (
            <li key={a.id.toString()} className={`${fresh(a.id.toString()) ? 'row-in ' : ''}flex items-start gap-3 py-3 first:pt-1 last:pb-0`}>
              <span
                className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                  a.status === 'SKIPPED' || a.status === 'FAILED' ? 'bg-hold-soft text-hold' : 'bg-ai-soft text-ai'
                }`}
              >
                {a.actionType === 'PRESS_KEY' ? `KEY ${a.actionValue}` : a.actionType.replace(/_/g, ' ')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-ink">{a.reasoningSummary}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {ACTION_LABEL[a.actionType] ?? a.actionType}
                  {a.status === 'SKIPPED' ? ' · held off' : ''} · {Math.round(a.confidence * 100)}% confident
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function HumanMeter({ confidence, status }: { confidence: number; status: CallStatus }) {
  const pct = Math.round(confidence * 100);
  const found = ['HUMAN_DETECTED', 'CALLING_USER', 'BRIDGING_USER', 'USER_CONNECTED'].includes(status);
  const label = found ? 'Representative found' : pct >= 50 ? 'Possible human' : status === 'ON_HOLD' ? 'Hold queue' : 'Automated system';
  const bar = found ? 'bg-human' : pct >= 50 ? 'bg-hold' : 'bg-ink/35';
  const segments = 20;
  const lit = Math.round((pct / 100) * segments);

  return (
    <section aria-labelledby="human-meter" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="human-meter" className="text-base font-semibold">
          Human detection
        </h2>
        <span className={`font-mono text-sm tabular-nums ${found ? 'font-semibold text-human-strong' : 'text-ink-2'}`}>{pct}%</span>
      </div>
      <div
        className="relative flex gap-[3px]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Confidence that a live representative is on the line"
      >
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={`h-5 flex-1 rounded-[3px] transition-colors duration-300 ${i < lit ? bar : 'bg-sunken'}`} />
        ))}
        <span className="absolute -bottom-1.5 left-1/2 h-1 w-px bg-line-strong" aria-hidden />
        <span className="absolute -bottom-1.5 left-[80%] h-1 w-px bg-line-strong" aria-hidden />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span className={found ? 'font-semibold uppercase tracking-wide text-human-strong' : ''}>{label}</span>
        <span>Bridges at 80% with a supporting cue</span>
      </div>
    </section>
  );
}

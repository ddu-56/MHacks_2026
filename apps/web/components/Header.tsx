'use client';

import Link from 'next/link';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '@holdless/db';
import { MODE_COPY, ms, useNow } from '@/lib/format';
import { SPACETIME_TARGET } from '@/lib/spacetime';

const STALE_MS = 15_000;

export function useOrchestrator() {
  const [rows] = useTable(tables.orchestrator);
  const now = useNow(2000);
  const orch = rows[0];
  const online = !!orch && now - (ms(orch.lastHeartbeat) ?? 0) < STALE_MS;
  return { orch, online };
}

export function Header() {
  const { isActive, connectionError } = useSpacetimeDB();
  const { orch, online } = useOrchestrator();

  const chips: Array<{ label: string; ok: boolean; title: string }> = [
    {
      label: isActive ? 'SpacetimeDB live' : connectionError ? 'SpacetimeDB offline' : 'Connecting…',
      ok: isActive,
      title: SPACETIME_TARGET,
    },
    {
      label: online ? 'Call agent online' : 'Call agent offline',
      ok: online,
      title: online ? 'Orchestrator heartbeat is fresh' : 'Start the orchestrator: pnpm dev:orchestrator',
    },
  ];
  if (orch && online) {
    chips.push({
      label: (MODE_COPY[orch.mode] ?? MODE_COPY.mock!).chip,
      ok: true,
      title: (MODE_COPY[orch.mode] ?? MODE_COPY.mock!).title,
    });
    chips.push({
      label: orch.reasoning.startsWith('gemini') ? orch.reasoning.replace('gemini:', 'Gemini · ') : 'Rule-based reasoning',
      ok: true,
      title: orch.reasoning.startsWith('gemini') ? 'IVR decisions by Google Gemini' : 'No GEMINI_API_KEY — deterministic fallback',
    });
  }

  return (
    <header className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pb-8 pt-6 sm:px-6">
      <Link href="/" className="group flex items-baseline gap-3">
        <span className="text-[1.35rem] font-semibold tracking-[-0.03em] text-ink">
          Hold<span className="text-ai">Less</span>
        </span>
        <span className="hidden text-sm text-muted sm:inline">AI waits on customer service so you don&apos;t have to.</span>
      </Link>
      <ul className="flex flex-wrap items-center gap-2" aria-label="System status">
        {chips.map((c) => (
          <li
            key={c.label}
            title={c.title}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2"
          >
            <span className={`size-1.5 rounded-full ${c.ok ? 'bg-human' : 'bg-danger breathe'}`} aria-hidden />
            {c.label}
          </li>
        ))}
      </ul>
    </header>
  );
}

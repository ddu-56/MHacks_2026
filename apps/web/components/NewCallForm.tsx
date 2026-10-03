'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LoaderCircle, PhoneCall, Play } from 'lucide-react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from '@holdless/db';
import { DEMO_PROFILE, lookupCompany, parseRequestText } from '@holdless/shared';
import { MODE_COPY, ms } from '@/lib/format';
import { useOrchestrator } from './Header';

const PHONE_KEY = 'holdless:userPhone';

interface Fields {
  companyName: string;
  phoneNumber: string;
  userGoal: string;
  userPhoneNumber: string;
  userContext: string;
}

const EMPTY: Fields = { companyName: '', phoneNumber: '', userGoal: '', userPhoneNumber: '', userContext: '' };

export function NewCallForm() {
  const router = useRouter();
  const { isActive, identity } = useSpacetimeDB();
  const { orch, online } = useOrchestrator();
  const requestCall = useReducer(reducers.requestCall);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [ask, setAsk] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<'form' | 'demo' | null>(null);
  const pendingSince = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PHONE_KEY);
      if (saved) setFields((f) => ({ ...f, userPhoneNumber: f.userPhoneNumber || saved }));
    } catch {}
  }, []);

  // Reducers don't return values; follow our own new row into its call page as soon as SpacetimeDB syncs it.
  useTable(tables.callSession, {
    onInsert: (row) => {
      const since = pendingSince.current;
      if (since === null || !identity || row.userId !== identity.toHexString()) return;
      if ((ms(row.startedAt) ?? 0) < since - 5000) return;
      pendingSince.current = null;
      router.push(`/calls/${row.id}`);
    },
  });

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  const applyAsk = (text: string) => {
    const parsed = parseRequestText(text);
    if (!parsed) return;
    const known = lookupCompany(parsed.companyName);
    const isDemoCo = known?.displayName === DEMO_PROFILE.companyName;
    setFields((f) => ({
      ...f,
      companyName: known?.displayName ?? parsed.companyName,
      userGoal: parsed.userGoal,
      phoneNumber: known ? (isDemoCo && orch?.demoSupportNumber) || known.phoneNumber : f.phoneNumber,
      userContext: isDemoCo && !f.userContext ? DEMO_PROFILE.userContext : f.userContext,
    }));
  };

  const submit = async (values: Fields, demo: boolean, kind: 'form' | 'demo') => {
    setError('');
    if (!values.userPhoneNumber.trim()) {
      setError('Add the phone number we should call when a representative picks up.');
      return;
    }
    setSubmitting(kind);
    pendingSince.current = Date.now();
    try {
      await requestCall({ ...values, source: 'web', demo });
      try {
        localStorage.setItem(PHONE_KEY, values.userPhoneNumber);
      } catch {}
    } catch (err) {
      pendingSince.current = null;
      setError((err as Error).message || 'Could not start the call.');
    } finally {
      setSubmitting(null);
    }
  };

  const runDemo = () => {
    const userPhoneNumber = fields.userPhoneNumber || orch?.demoUserNumber || '';
    const values: Fields = {
      companyName: DEMO_PROFILE.companyName,
      phoneNumber: orch?.demoSupportNumber || DEMO_PROFILE.phoneNumber,
      userGoal: DEMO_PROFILE.userGoal,
      userPhoneNumber,
      userContext: DEMO_PROFILE.userContext,
    };
    setFields(values);
    setAsk('Get me a human at Wolverine Wireless about an incorrect $40 charge.');
    void submit(values, true, 'demo');
  };

  const disabled = !isActive || submitting !== null;
  const showDemo = !orch || orch.demoMode;

  return (
    <section aria-labelledby="new-call" className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h1 id="new-call" className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] text-balance">
        Who do you need to reach?
      </h1>
      <p className="mt-1.5 text-[15px] text-ink-2">
        We dial, work the phone menu and sit on hold. Your phone rings only when a real person picks up.
      </p>

      {showDemo && (
        <button
          type="button"
          onClick={runDemo}
          disabled={disabled}
          className="group mt-5 flex w-full items-center gap-3 rounded-xl border border-ai/30 bg-ai-soft px-4 py-3 text-left transition hover:border-ai/60 disabled:opacity-60"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ai text-white">
            {submitting === 'demo' ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Run demo</span>
            <span className="block truncate text-[13px] text-ink-2">
              Wolverine Wireless · incorrect $40 charge{` · ${(MODE_COPY[orch?.mode ?? 'mock'] ?? MODE_COPY.mock!).demo}`}
            </span>
          </span>
          <ArrowRight className="size-4 text-ai transition group-hover:translate-x-0.5" />
        </button>
      )}

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(fields, fields.companyName.trim().toLowerCase() === 'wolverine wireless', 'form');
        }}
      >
        <Field label="Ask in plain words" hint="We’ll fill in the details below.">
          <textarea
            value={ask}
            rows={2}
            onChange={(e) => {
              setAsk(e.target.value);
              applyAsk(e.target.value);
            }}
            placeholder="Get me a human at Wolverine Wireless about an incorrect charge."
            className={inputClass('resize-none')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company">
            <input required value={fields.companyName} onChange={set('companyName')} placeholder="Wolverine Wireless" className={inputClass()} />
          </Field>
          <Field label="Support number">
            <input
              required
              type="tel"
              inputMode="tel"
              value={fields.phoneNumber}
              onChange={set('phoneNumber')}
              placeholder="+1 734 555 0142"
              className={inputClass('font-mono text-[14px]')}
            />
          </Field>
        </div>

        <Field label="What do you need help with?">
          <input
            required
            value={fields.userGoal}
            onChange={set('userGoal')}
            placeholder="Talk to someone about an incorrect $40 charge"
            className={inputClass()}
          />
        </Field>

        <Field label="Details the agent may share" hint="Optional. Only used if the menu asks for it. Never PINs or passwords.">
          <textarea value={fields.userContext} onChange={set('userContext')} rows={2} placeholder="Account holder name, order number…" className={inputClass('resize-none')} />
        </Field>

        <Field label="Your phone" hint="We call you here when a representative answers.">
          <input
            required
            type="tel"
            inputMode="tel"
            value={fields.userPhoneNumber}
            onChange={set('userPhoneNumber')}
            placeholder={orch?.demoUserNumber || '+1 555 555 0100'}
            className={inputClass('font-mono text-[14px]')}
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {!online && isActive && (
          <p className="rounded-lg bg-hold-soft px-3 py-2 text-sm text-ink-2">
            The call agent is offline. Requests will wait 20 seconds, then fail. Start it with <code className="font-mono text-[13px]">pnpm dev:orchestrator</code>.
          </p>
        )}

        <button
          type="submit"
          disabled={disabled}
          className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-[15px] font-semibold text-bg transition hover:bg-ink/90 active:scale-[0.99] disabled:opacity-50"
        >
          {submitting === 'form' ? <LoaderCircle className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
          Get me a human
        </button>
      </form>
    </section>
  );
}

function inputClass(extra = '') {
  return `w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/80 transition focus:border-ai focus:bg-surface focus:outline-none focus:ring-3 focus:ring-ai/15 ${extra}`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

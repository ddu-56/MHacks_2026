'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUp, Globe, Mail, PhoneCall, Sparkles, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { TabId } from './OmniTabs';

export interface TriagePreset {
  id: string;
  chipLabel: string;
  query: string;
  provider: string;
  category: string;
  recommendedChannel: TabId;
  channelName: string;
  confidence: number;
  reasoning: string;
  policyNote: string;
  prefillData: Record<string, any>;
}

export const PRESETS: TriagePreset[] = [
  {
    id: 'amazon-return',
    chipLabel: 'Amazon: Broken Mouse Return',
    query: 'Return my Logitech wireless mouse on Amazon order #112-9842 because the scroll wheel is broken.',
    provider: 'Amazon',
    category: 'Return & Refund',
    recommendedChannel: 'browser',
    channelName: 'Web & Browser Agent',
    confidence: 0.98,
    reasoning: 'Amazon does not accept email tickets for returns. They enforce an in-app multi-step return wizard. The browser agent will reuse your local Chrome session to bypass 2FA/login and extract the return QR code.',
    policyNote: 'Covered under Amazon standard 30-day return policy for defective hardware.',
    prefillData: {
      service: 'Amazon',
      orderNumber: '#112-9842-88192',
      item: 'Logitech MX Master 3S Wireless Mouse',
      reason: 'Defective / Does not work (Broken scroll wheel)',
      refundMethod: 'Original Payment Card',
      dropoff: 'UPS Store (No box or label required)',
    },
  },
  {
    id: 'delta-claim',
    chipLabel: 'Delta: Flight Delay Compensation',
    query: 'File a formal claim with Delta Air Lines for a 4-hour maintenance delay on Flight DL1842 to get $150 compensation.',
    provider: 'Delta Air Lines',
    category: 'Statutory Claim & Dispute',
    recommendedChannel: 'email',
    channelName: 'Email Ticket Dispatch',
    confidence: 0.95,
    reasoning: 'Airlines mandate written submission with flight numbers and ticket references for delay compensation. Dispatching a formal legal ticket directly to their customer claims desk creates an enforceable audit trail.',
    policyNote: 'Grounds: Controllable carrier delay exceeding 3 hours under DOT passenger protection standards.',
    prefillData: {
      recipientEmail: 'ticket-support@delta.com',
      recipientName: 'Delta Air Lines Customer Claims & Care',
      senderName: 'Alex Morgan',
      senderEmail: 'alex.morgan.flyer@gmail.com',
      subject: 'FORMAL CLAIM: Compensation Request for 4-Hour Controllable Delay - Flight DL1842',
      orderNumber: 'DL1842 / E-Ticket 006-249102941',
      requestedAmount: '$150.00',
    },
  },
  {
    id: 'xfinity-fee',
    chipLabel: 'Xfinity: Unreturned Equipment Fee',
    query: 'Dispute an unexpected $30 unreturned router fee from Xfinity since I returned it to the store last month.',
    provider: 'Xfinity / Comcast',
    category: 'Billing Dispute',
    recommendedChannel: 'email',
    channelName: 'Email Ticket Dispatch',
    confidence: 0.91,
    reasoning: 'Billing adjustments for returned equipment require submitting return receipt numbers in writing to prevent account collections while the equipment scan is investigated.',
    policyNote: 'Reference store return slip #XF-8819 from Sept 14th.',
    prefillData: {
      recipientEmail: 'billing-disputes@xfinity.com',
      recipientName: 'Xfinity Customer Financial Services',
      senderName: 'Alex Morgan',
      senderEmail: 'alex.morgan@gmail.com',
      subject: 'DISPUTE: Erroneous $30.00 Unreturned Equipment Charge (Account #8492-10-449)',
      orderNumber: 'Account #8492-10-449',
      requestedAmount: '$30.00 Credit',
    },
  },
  {
    id: 'wolverine-call',
    chipLabel: 'Wolverine Wireless: Incorrect Charge',
    query: 'Get me a human at Wolverine Wireless about an incorrect $40 charge on my cellular bill.',
    provider: 'Wolverine Wireless',
    category: 'Urgent Billing Dispute',
    recommendedChannel: 'phone',
    channelName: 'Phone & Hold Queue',
    confidence: 0.96,
    reasoning: 'Wolverine Wireless operates a voice-only IVR menu for instant account credits. HoldLess will dial, navigate the phone tree, sit through hold music, and ring your phone when a live representative answers.',
    policyNote: 'Simulated customer service IVR ready on the local telecom line.',
    prefillData: {
      companyName: 'Wolverine Wireless',
      phoneNumber: '+1 734 555 0142',
      userGoal: 'Talk to someone about an incorrect $40 charge.',
      userContext: 'Account #WW-9941, unauthorized roaming add-on',
    },
  },
];

interface AdvisorHomeProps {
  onSelectAction: (channel: TabId, prefillData: Record<string, any>) => void;
}

export function AdvisorHome({ onSelectAction }: AdvisorHomeProps) {
  const [query, setQuery] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<TriagePreset | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (!query.trim() || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (res.ok) {
        setSelectedPreset(await res.json());
        return;
      }
    } catch {
      // fall through to keyword presets
    } finally {
      setAnalyzing(false);
    }
    // No Gemini key or Gemini failed: keyword-match a demo preset.
    const lower = query.toLowerCase();
    if (lower.includes('amazon') || lower.includes('return') || lower.includes('mouse')) {
      setSelectedPreset(PRESETS[0]!);
    } else if (lower.includes('delta') || lower.includes('flight') || lower.includes('airline')) {
      setSelectedPreset(PRESETS[1]!);
    } else if (lower.includes('xfinity') || lower.includes('comcast') || lower.includes('router')) {
      setSelectedPreset(PRESETS[2]!);
    } else {
      setSelectedPreset(PRESETS[3]!);
    }
  };

  const ChannelIcon =
    selectedPreset?.recommendedChannel === 'browser'
      ? Globe
      : selectedPreset?.recommendedChannel === 'email'
        ? Mail
        : PhoneCall;

  return (
    <div
      className={`relative isolate mx-auto flex w-full max-w-3xl flex-col gap-8 transition-all ${
        selectedPreset ? 'pt-6 pb-20' : 'flex-1 justify-center pb-10'
      }`}
    >
      {/* Soft glow behind the prompt, Gemini-style */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 h-[480px] bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--ai)_18%,transparent),transparent_65%)]"
      />

      <section className="flex flex-col items-center gap-8">
        <h1 className="text-center text-3xl font-normal tracking-tight text-ink text-balance sm:text-5xl">
          What should we resolve for you?
        </h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAnalyze();
          }}
          className="flex w-full items-end gap-2 rounded-[28px] border border-line bg-surface py-2 pl-5 pr-2 shadow-card transition focus-within:border-ai/40"
        >
          <textarea
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAnalyze();
              }
            }}
            aria-label="Describe your customer service problem"
            placeholder="Ask HoldLess to return, dispute, or call…"
            className="field-sizing-content max-h-48 min-h-11 w-full min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[16px] text-ink placeholder:text-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={analyzing || !query.trim()}
            aria-label="Analyze"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg transition hover:bg-ink/85 disabled:bg-sunken disabled:text-muted"
          >
            {analyzing ? <Sparkles className="size-4 breathe" /> : <ArrowUp className="size-5" />}
          </button>
        </form>

        <div className="flex flex-wrap justify-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setQuery(p.query)}
              className="rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-[13px] text-ink-2 transition hover:border-line-strong hover:text-ink"
            >
              {p.chipLabel}
            </button>
          ))}
        </div>
      </section>

      {/* AI Recommendation Result Card */}
      {selectedPreset && (
        <section className="rounded-3xl border border-ai/30 bg-surface p-6 shadow-card sm:p-8 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-ai text-white">
                <Sparkles className="size-4" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-ink">
                AI Recommendation: {selectedPreset.provider}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-human-soft px-2.5 py-0.5 text-xs font-medium text-human-strong border border-human/20">
                {(selectedPreset.confidence * 100).toFixed(0)}% Confidence
              </span>
              <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-ink-2">
                {selectedPreset.category}
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-6 sm:grid-cols-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Recommended Modality
              </span>
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-line bg-sunken p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ai text-white">
                  <ChannelIcon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-ink text-[16px]">{selectedPreset.channelName}</h3>
                  <p className="text-xs text-muted">Automated protocol for {selectedPreset.provider}</p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-line/60 bg-bg p-3.5 text-xs text-ink-2 flex items-start gap-2.5">
                <CheckCircle2 className="size-4 text-human shrink-0 mt-0.5" />
                <span>{selectedPreset.policyNote}</span>
              </div>
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Strategy & Rationale
                </span>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                  {selectedPreset.reasoning}
                </p>
              </div>

              <div className="mt-6 pt-2">
                <button
                  type="button"
                  onClick={() => onSelectAction(selectedPreset.recommendedChannel, selectedPreset.prefillData)}
                  className="group flex w-full items-center justify-between gap-3 rounded-2xl bg-ai px-5 py-3.5 text-sm font-semibold text-white shadow-md transition hover:bg-ai/90 active:scale-[0.99]"
                >
                  <span className="flex items-center gap-2">
                    <ChannelIcon className="size-4" />
                    <span>Proceed to {selectedPreset.channelName}</span>
                  </span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ArrowRight, Globe, Mail, PhoneCall, Sparkles, CheckCircle2, ShieldAlert } from 'lucide-react';
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
  const [query, setQuery] = useState(PRESETS[0]!.query);
  const [selectedPreset, setSelectedPreset] = useState<TriagePreset>(PRESETS[0]!);
  const [analyzing, setAnalyzing] = useState(false);

  const handleSelectPreset = (p: TriagePreset) => {
    setSelectedPreset(p);
    setQuery(p.query);
  };

  const handleAnalyze = () => {
    setAnalyzing(true);
    setTimeout(() => {
      setAnalyzing(false);
      // Find matching preset or default to first
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
    }, 400);
  };

  const ChannelIcon =
    selectedPreset.recommendedChannel === 'browser'
      ? Globe
      : selectedPreset.recommendedChannel === 'email'
        ? Mail
        : PhoneCall;

  return (
    <div className="flex flex-col gap-8">
      {/* Hero Section */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider text-ai">
          <Sparkles className="size-4" />
          <span>Gemini Autonomous Concierge</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl text-balance">
          What customer service problem do you want resolved?
        </h1>
        <p className="mt-2 text-[15px] text-ink-2 max-w-2xl text-balance">
          Explain your goal in plain words. Our AI evaluates company policies, detects whether in-app
          wizards, formal email tickets, or phone queues are required, and executes on your behalf.
        </p>

        {/* Omnibar Input */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="relative flex flex-col rounded-2xl border border-line-strong bg-bg p-2 transition-within focus-within:border-ai focus-within:ring-3 focus-within:ring-ai/15">
            <textarea
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Return broken coffee maker on Amazon, dispute flight delay with Delta, or dispute charge on Wolverine Wireless..."
              className="w-full resize-none bg-transparent p-2 text-[15px] text-ink placeholder:text-muted/80 focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-line/60 pt-2 px-1">
              <span className="text-xs text-muted">Press analyze to generate optimal resolution strategy</span>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing || !query.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-bg transition hover:bg-ink/90 disabled:opacity-50"
              >
                <Sparkles className="size-3.5" />
                {analyzing ? 'Evaluating policies…' : 'Analyze & Recommend'}
              </button>
            </div>
          </div>

          {/* Quick preset chips */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-medium text-muted">Try presets:</span>
            {PRESETS.map((p) => {
              const active = selectedPreset.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'border-ai bg-ai-soft text-ai font-semibold'
                      : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {p.chipLabel}
                </button>
              );
            })}
          </div>
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

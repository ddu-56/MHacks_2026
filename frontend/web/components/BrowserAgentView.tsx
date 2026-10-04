'use client';

import { useState } from 'react';
import {
  Globe,
  Play,
  LoaderCircle,
  CheckCircle2,
  ShieldCheck,
  QrCode,
  Laptop,
  ArrowRight,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';

interface BrowserAgentViewProps {
  initialData?: Record<string, any>;
}

export function BrowserAgentView({ initialData }: BrowserAgentViewProps) {
  const [service, setService] = useState(initialData?.service ?? 'Amazon');
  const [orderNumber, setOrderNumber] = useState(initialData?.orderNumber ?? '#112-9842-88192');
  const [item, setItem] = useState(initialData?.item ?? 'Logitech MX Master 3S Wireless Mouse');
  const [reason, setReason] = useState(initialData?.reason ?? 'Defective / Does not work (Broken scroll wheel)');
  const [useLocalProfile, setUseLocalProfile] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isCompleted, setIsCompleted] = useState(false);

  const STEPS = [
    { title: 'Launch Chrome Session', detail: 'Connecting via Playwright with local Chrome profile (session cookies active)' },
    { title: 'Open Order History', detail: 'Navigating to amazon.com/gp/css/order-history (bypassing 2FA/login)' },
    { title: 'Locate Item & Trigger Return', detail: `Found "${item}" — clicking 'Return or replace items'` },
    { title: 'Apply Return Reason & Policy', detail: `Selecting '${reason}' — no restocking fee applies` },
    { title: 'Confirm UPS Dropoff & QR Code', detail: 'Selected: UPS Store (no box or label needed) — extracting QR confirmation' },
  ];

  const handleRunDemo = () => {
    setIsRunning(true);
    setIsCompleted(false);
    setCurrentStep(1);

    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= STEPS.length) {
          clearInterval(stepInterval);
          setIsRunning(false);
          setIsCompleted(true);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);
  };

  const handleReset = () => {
    setIsRunning(false);
    setIsCompleted(false);
    setCurrentStep(0);
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-10">
      {/* Configuration Form */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-7">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-ai text-white">
              <Globe className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">Web & Browser Agent</h2>
              <p className="text-xs text-muted">Automated in-app portal navigation</p>
            </div>
          </div>
          <span className="rounded-full border border-line bg-sunken px-2.5 py-0.5 text-xs font-medium text-ink-2">
            Playwright Core
          </span>
        </div>

        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleRunDemo();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2">Service Portal</label>
            <input
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-ink focus:border-ai focus:outline-none focus:ring-3 focus:ring-ai/15"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-ink-2">Order / Reference #</label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-xs text-ink focus:border-ai focus:outline-none focus:ring-3 focus:ring-ai/15"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-ink-2">Target Item</label>
              <input
                type="text"
                value={item}
                onChange={(e) => setItem(e.target.value)}
                className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-xs text-ink focus:border-ai focus:outline-none focus:ring-3 focus:ring-ai/15"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2">Return Reason / Explanation</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-ink focus:border-ai focus:outline-none focus:ring-3 focus:ring-ai/15"
            />
          </div>

          {/* Local Chrome Profile Option */}
          <div className="rounded-2xl border border-ai/30 bg-ai-soft/50 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useLocalProfile}
                onChange={(e) => setUseLocalProfile(e.target.checked)}
                className="mt-1 size-4 rounded text-ai focus:ring-ai"
              />
              <div className="text-xs">
                <span className="font-semibold text-ink flex items-center gap-1.5">
                  <Laptop className="size-3.5 text-ai" />
                  Reuse Local Chrome Profile Session
                </span>
                <p className="mt-1 text-ink-2 leading-relaxed">
                  Attaches to your existing Chrome profile (<code className="font-mono text-[11px]">~/Library/Application Support/Google/Chrome</code>). Reuses active session cookies so no 2FA or password logins are needed.
                </p>
              </div>
            </label>
          </div>

          <div className="mt-2 flex gap-3">
            <button
              type="submit"
              disabled={isRunning}
              className="flex-1 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-5 text-sm font-semibold text-bg transition hover:bg-ink/90 disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>Navigating Amazon Portal…</span>
                </>
              ) : (
                <>
                  <Play className="size-4 fill-current" />
                  <span>Run Web Return Agent</span>
                </>
              )}
            </button>
            {isCompleted && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex size-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink-2 hover:bg-sunken"
                title="Reset simulation"
              >
                <RotateCcw className="size-4" />
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Live Agent Terminal / Stepper */}
      <section className="flex flex-col gap-6">
        <div className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-7">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <h3 className="text-base font-semibold text-ink">Autonomous Execution Track</h3>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className={`size-2 rounded-full ${
                  isRunning ? 'bg-hold animate-ping' : isCompleted ? 'bg-human' : 'bg-muted'
                }`}
              />
              {isRunning ? 'Agent in Browser' : isCompleted ? 'Return Complete' : 'Standing By'}
            </span>
          </div>

          {/* Stepper list */}
          <div className="mt-6 flex flex-col gap-4">
            {STEPS.map((s, index) => {
              const stepNum = index + 1;
              const isPast = currentStep > stepNum || isCompleted;
              const isCurrent = currentStep === stepNum && isRunning;
              return (
                <div
                  key={s.title}
                  className={`flex items-start gap-3.5 rounded-2xl border p-4 transition-all ${
                    isPast
                      ? 'border-human/30 bg-human-soft/30 text-ink'
                      : isCurrent
                        ? 'border-ai bg-ai-soft/60 text-ink shadow-sm'
                        : 'border-line/60 bg-bg/50 text-muted opacity-60'
                  }`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      isPast
                        ? 'bg-human text-white'
                        : isCurrent
                          ? 'bg-ai text-white animate-pulse'
                          : 'border border-line bg-surface text-muted'
                    }`}
                  >
                    {isPast ? <CheckCircle2 className="size-4" /> : stepNum}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{s.title}</p>
                    <p className="mt-0.5 text-xs text-ink-2">{s.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Completed Return Card */}
          {isCompleted && (
            <div className="mt-6 rounded-2xl border border-human/40 bg-surface p-5 shadow-sm">
              <div className="flex items-center gap-2 text-human-strong font-semibold text-sm">
                <CheckCircle2 className="size-4 text-human" />
                <span>Return Successfully Initiated on Amazon</span>
              </div>
              <div className="mt-4 flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-dashed border-line-strong bg-sunken p-4">
                <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-white p-2 shadow-sm border border-line">
                  <QrCode className="size-20 text-ink" />
                </div>
                <div className="text-xs text-ink-2 leading-relaxed">
                  <p className="font-semibold text-ink text-sm">Return Code: RET-8849-AMZN</p>
                  <p className="mt-1">
                    Drop-off: <strong>The UPS Store</strong> (No box or shipping label needed).
                  </p>
                  <p className="mt-0.5">
                    Show this QR code on your phone when dropping off. Full refund of <strong>$79.99</strong> will credit upon first scan.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

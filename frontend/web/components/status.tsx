import { Check } from 'lucide-react';
import { PHASES, phaseOf, STATUS_LABELS, isTerminal, type CallStatus } from '@holdless/shared';
import { TONE_CLASSES, toneOf } from '@/lib/format';

export function StatusPill({ status, size = 'sm' }: { status: CallStatus; size?: 'sm' | 'lg' }) {
  const tone = TONE_CLASSES[toneOf(status)];
  const live = !isTerminal(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${tone.text} ${tone.bg} ${tone.border} ${
        size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <span className={`size-1.5 rounded-full ${tone.dot} ${live ? 'breathe' : ''}`} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Six-step progress: Requested → Dialing → Navigating IVR → Waiting → Human found → Connected. */
export function PhaseStepper({ status, compact = false }: { status: CallStatus; compact?: boolean }) {
  const current = phaseOf(status);
  const failed = status === 'FAILED';
  const finished = status === 'COMPLETED' || status === 'USER_CONNECTED';

  if (compact) {
    return (
      <div className="flex gap-1" aria-label={`Step ${current + 1} of ${PHASES.length}`}>
        {PHASES.map((p, i) => (
          <span
            key={p}
            className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
              failed ? 'bg-danger/40' : i < current || (i === current && finished) ? 'bg-ink/70' : i === current ? phaseColor(i) : 'bg-line'
            }`}
          />
        ))}
      </div>
    );
  }

  return (
    <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6" aria-label="Call progress">
      {PHASES.map((p, i) => {
        const done = !failed && (i < current || (i === current && finished));
        const active = !failed && i === current && !finished;
        return (
          <li key={p} className="relative flex flex-col gap-2 pr-2">
            <div className="flex items-center gap-2">
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-all duration-500 ${
                  done
                    ? 'border-ink bg-ink text-bg'
                    : active
                      ? `${phaseBorder(i)} bg-surface ${phaseText(i)}`
                      : 'border-line-strong bg-surface text-muted'
                }`}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`hidden h-px flex-1 sm:block ${done ? 'bg-ink/60' : 'bg-line'}`} aria-hidden />
            </div>
            <span className={`text-[13px] leading-tight ${active ? `font-semibold ${phaseText(i)}` : done ? 'text-ink' : 'text-muted'}`}>
              {p}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function phaseColor(i: number) {
  return i === 3 ? 'bg-hold' : i >= 4 ? 'bg-human' : i === 2 ? 'bg-ai' : 'bg-ink/50';
}
function phaseBorder(i: number) {
  return i === 3 ? 'border-hold' : i >= 4 ? 'border-human' : i === 2 ? 'border-ai' : 'border-ink';
}
function phaseText(i: number) {
  return i === 3 ? 'text-hold' : i >= 4 ? 'text-human-strong' : i === 2 ? 'text-ai' : 'text-ink';
}

export { isTerminal, STATUS_LABELS };

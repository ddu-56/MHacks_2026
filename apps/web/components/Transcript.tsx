'use client';

import type { TranscriptSegment } from '@holdless/db';
import { ms, useFreshRows } from '@/lib/format';

const SPEAKER: Record<string, { label: string; cls: string }> = {
  AUTOMATED_SYSTEM: { label: 'Phone menu', cls: 'text-ai' },
  HUMAN_REP: { label: 'Representative', cls: 'text-human-strong' },
  UNKNOWN: { label: 'Unknown', cls: 'text-muted' },
  AI: { label: 'HoldLess', cls: 'text-ink' },
  USER: { label: 'You', cls: 'text-ink' },
};

export function Transcript({ segments, live }: { segments: readonly TranscriptSegment[]; live: boolean }) {
  const recent = [...segments]
    .sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0) || Number(a.id - b.id))
    .slice(-8);
  const fresh = useFreshRows(recent.map((s) => s.id.toString()));
  return (
    <section aria-labelledby="transcript" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="transcript" className="text-base font-semibold">
          What we’re hearing
        </h2>
        {live && (
          <span className="eq flex h-3.5 items-end gap-[3px]" aria-label="Listening">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="block h-full w-[3px] rounded-full bg-ai" />
            ))}
          </span>
        )}
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. Transcribed speech from the call appears here.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {recent.map((s) => {
            const sp = SPEAKER[s.speakerType] ?? SPEAKER.UNKNOWN!;
            return (
              <li key={s.id.toString()} className={fresh(s.id.toString()) ? 'row-in' : undefined}>
                <span className={`text-xs font-semibold ${sp.cls}`}>{sp.label}</span>
                <p className="text-[15px] leading-snug text-ink">{s.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

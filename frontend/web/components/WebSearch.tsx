'use client';

import { useState } from 'react';
import { Search, X, Sparkles } from 'lucide-react';

type Result = { answer?: string; sources?: { uri: string; title: string }[]; error?: string };

export function WebSearch() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const search = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      setResult(await res.json());
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full sm:w-80" onKeyDown={(e) => e.key === 'Escape' && setResult(null)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 shadow-card transition focus-within:border-ai/40"
      >
        {loading ? <Sparkles className="size-4 shrink-0 text-ai breathe" /> : <Search className="size-4 shrink-0 text-muted" />}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the web"
          placeholder="Search for companies"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
        />
      </form>

      {result && (
        <div
          role="region"
          aria-label="Web search results"
          className="absolute right-0 top-full z-40 mt-2 max-h-[70dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-card animate-fade-in"
        >
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label="Close results"
            className="float-right grid size-7 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
          {result.error ? (
            <p className="text-sm text-danger">{result.error}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{result.answer || 'No answer found.'}</p>
              {!!result.sources?.length && (
                <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                  {result.sources.map((s) => (
                    <li key={s.uri}>
                      <a
                        href={s.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="block max-w-56 truncate rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-2 hover:text-ai"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

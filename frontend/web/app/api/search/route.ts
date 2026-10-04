// Web search via Gemini with Google Search grounding. Uses the shared GEMINI_API_KEY.
export async function POST(req: Request) {
  const { query } = (await req.json().catch(() => ({}))) as { query?: unknown };
  if (typeof query !== 'string' || !query.trim() || query.length > 500) {
    return Response.json({ error: 'Query must be 1–500 characters.' }, { status: 400 });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    // Mock result until GEMINI_API_KEY is set.
    return Response.json({
      answer: `(Mock result) Here's what the web says about "${query}": most companies list support hours, return windows, and claim forms on their help center. Add GEMINI_API_KEY to .env for live results.`,
      sources: [
        { uri: 'https://www.google.com/search?q=' + encodeURIComponent(query), title: 'Google: ' + query },
        { uri: 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(query), title: 'Wikipedia search' },
      ],
    });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Search the web and answer concisely:\n${query}` }] }],
      tools: [{ google_search: {} }],
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch((err: Error) => ({ ok: false, status: 504, text: async () => err.message }) as const);

  if (!res.ok) return Response.json({ error: `Search failed: ${await res.text()}` }, { status: 502 });

  const data = await (res as Response).json();
  const cand = data.candidates?.[0];
  const answer = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c: { web?: { uri: string; title: string } }) => c.web)
    .filter(Boolean);
  return Response.json({ answer, sources });
}

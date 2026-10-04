import { gemini, geminiKey } from '@/lib/gemini';

// Web search via Gemini with Google Search grounding. Uses the shared GEMINI_API_KEY.
export async function POST(req: Request) {
  const { query } = (await req.json().catch(() => ({}))) as { query?: unknown };
  if (typeof query !== 'string' || !query.trim() || query.length > 500) {
    return Response.json({ error: 'Query must be 1–500 characters.' }, { status: 400 });
  }
  if (!geminiKey()) {
    // Mock result until GEMINI_API_KEY is set.
    return Response.json({
      answer: `(Mock result) Here's what the web says about "${query}": most companies list support hours, return windows, and claim forms on their help center. Add GEMINI_API_KEY to .env for live results.`,
      sources: [
        { uri: 'https://www.google.com/search?q=' + encodeURIComponent(query), title: 'Google: ' + query },
        { uri: 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(query), title: 'Wikipedia search' },
      ],
    });
  }

  try {
    const { text, grounding } = await gemini(
      {
        contents: [{ parts: [{ text: `Search the web and answer concisely:\n${query}` }] }],
        tools: [{ google_search: {} }],
      },
      600,
    );
    const sources = (grounding?.groundingChunks ?? [])
      .map((c: { web?: { uri: string; title: string } }) => c.web)
      .filter(Boolean);
    return Response.json({ answer: text, sources });
  } catch (err) {
    return Response.json({ error: `Search failed: ${(err as Error).message}` }, { status: 502 });
  }
}

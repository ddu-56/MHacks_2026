// Minimal Gemini REST client shared by the API routes. Server-only: reads GEMINI_API_KEY.
// Cost guards: thinking off/low and a hard cap on output tokens for every call.

export const geminiKey = () => process.env.GEMINI_API_KEY || '';

export async function gemini(body: Record<string, any>, maxOutputTokens = 1024) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey() },
    body: JSON.stringify({
      ...body,
      generationConfig: {
        ...body.generationConfig,
        maxOutputTokens,
        thinkingConfig: model.startsWith('gemini-3') ? { thinkingLevel: 'low' } : { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const cand = (await res.json()).candidates?.[0];
  const text: string = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
  return { text, grounding: cand?.groundingMetadata };
}

import { gemini, geminiKey } from '@/lib/gemini';

const PROMPT = `You are HoldLess, a customer-service advocate. Read the user's complaint and pick the best channel:
- "browser": the company only allows self-service in its website/app (e.g. Amazon returns, Uber/DoorDash disputes).
- "email": written proof or an audit trail matters (airline delay compensation, warranty claims, billing adjustments).
- "phone": urgent outages, fraud, or companies that only resolve things by voice.
Only use details the user actually gave; leave unknown fields as empty strings. Never invent order numbers, emails, or phone numbers.
Fill only the prefill fields relevant to the chosen channel:
- browser: service, orderNumber, item, reason
- email: recipientName, subject, orderNumber, requestedAmount
- phone: companyName, userGoal, userContext`;

const str = { type: 'STRING' };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    provider: str,
    category: str,
    recommendedChannel: { type: 'STRING', enum: ['browser', 'email', 'phone'] },
    confidence: { type: 'NUMBER' },
    reasoning: str,
    policyNote: str,
    prefillData: {
      type: 'OBJECT',
      properties: Object.fromEntries(
        ['service', 'orderNumber', 'item', 'reason', 'recipientName', 'subject', 'requestedAmount', 'companyName', 'userGoal', 'userContext'].map((k) => [k, str]),
      ),
    },
  },
  required: ['provider', 'category', 'recommendedChannel', 'confidence', 'reasoning', 'policyNote', 'prefillData'],
};

const CHANNEL_NAME = { browser: 'Web & Browser Agent', email: 'Email Ticket Dispatch', phone: 'Phone & Hold Queue' } as const;

export async function POST(req: Request) {
  const { query } = (await req.json().catch(() => ({}))) as { query?: unknown };
  if (typeof query !== 'string' || !query.trim() || query.length > 1000) {
    return Response.json({ error: 'Query must be 1–1000 characters.' }, { status: 400 });
  }
  // No key → client falls back to its keyword-matched presets.
  if (!geminiKey()) return Response.json({ error: 'GEMINI_API_KEY not set' }, { status: 503 });

  try {
    const { text } = await gemini(
      {
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ parts: [{ text: query }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
      },
      800,
    );
    const r = JSON.parse(text);
    const channel = r.recommendedChannel as keyof typeof CHANNEL_NAME;
    // Drop empty strings so the forms keep their own defaults.
    const prefillData = Object.fromEntries(Object.entries(r.prefillData ?? {}).filter(([, v]) => v));
    return Response.json({
      id: 'gemini',
      chipLabel: r.provider,
      query,
      provider: r.provider,
      category: r.category,
      recommendedChannel: channel,
      channelName: CHANNEL_NAME[channel] ?? channel,
      confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0)),
      reasoning: r.reasoning,
      policyNote: r.policyNote,
      prefillData,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

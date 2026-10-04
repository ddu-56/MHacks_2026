// Sends the email ticket through Resend. For safety, mail only ever goes to DEMO_INBOX_EMAIL
// (your own inbox); the company address in the form is shown in the email, never sent to.
// No RESEND_API_KEY → simulated receipt.

const isEmail = (s: unknown): s is string => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
const isText = (s: unknown, max: number): s is string => typeof s === 'string' && !!s.trim() && s.length <= max;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (
    !isEmail(b.recipientEmail) || !isText(b.recipientName, 200) || !isText(b.senderName, 200) ||
    !isEmail(b.senderEmail) || !isText(b.subject, 300) || !isText(b.body, 10_000)
  ) {
    return Response.json({ error: 'Fill in every field with a valid value.' }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  const inbox = process.env.DEMO_INBOX_EMAIL;
  if (!key || !inbox) {
    return Response.json({ id: `sim_${Date.now().toString(36)}`, sentTo: inbox || 'your inbox (set DEMO_INBOX_EMAIL)', simulated: true });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'HoldLess Concierge <onboarding@resend.dev>',
      to: [inbox],
      reply_to: b.senderEmail,
      subject: b.subject,
      text: `[HoldLess demo — intended for ${b.recipientName} <${b.recipientEmail}>]\n\n${b.body}`,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err: Error) => err);

  if (res instanceof Error) return Response.json({ error: `Email failed: ${res.message}` }, { status: 502 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ error: `Resend ${res.status}: ${data.message ?? 'unknown error'}` }, { status: 502 });
  return Response.json({ id: data.id, sentTo: inbox, simulated: false });
}

'use client';

import { useState } from 'react';
import {
  Mail,
  Send,
  LoaderCircle,
  CheckCircle2,
  Copy,
  Check,
  ShieldCheck,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

interface EmailTicketViewProps {
  initialData?: Record<string, any>;
}

export function EmailTicketView({ initialData }: EmailTicketViewProps) {
  const [recipientEmail, setRecipientEmail] = useState(
    initialData?.recipientEmail ?? 'support@service-provider.com',
  );
  const [recipientName, setRecipientName] = useState(
    initialData?.recipientName ?? 'Customer Claims & Service Department',
  );
  const [senderName, setSenderName] = useState(initialData?.senderName ?? 'Alex Morgan');
  const [senderEmail, setSenderEmail] = useState(initialData?.senderEmail ?? 'alex.morgan@example.com');
  const [subject, setSubject] = useState(
    initialData?.subject ?? 'FORMAL DISPUTE: Resolution Request Regarding Account Overcharge',
  );

  const defaultBody = `Dear ${recipientName},

I am writing to formally request a full resolution regarding the matter referenced below. 

Case / Reference: ${initialData?.orderNumber ?? 'REF-8492-9102'}
Requested Resolution: ${initialData?.requestedAmount ?? 'Full refund / Account credit'}

Statement of Facts:
On the date of service, an unexpected fee was charged to my account without proper authorization or notice. Pursuant to your published consumer guarantee policies and applicable fair billing standards, I am entitled to a full correction of this item.

I request that this adjustment be applied to the payment method on file within five (5) business days. Please provide written confirmation once the credit has posted.

Sincerely,
${senderName}
${senderEmail}`;

  const [body, setBody] = useState(defaultBody);
  const [isSending, setIsSending] = useState(false);
  const [receipt, setReceipt] = useState<{
    id: string;
    deliveredAt: string;
    recipient: string;
    simulated: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    setError('');
    try {
      const res = await fetch('/api/email/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipientEmail, recipientName, senderName, senderEmail, subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
      setReceipt({
        id: data.id,
        deliveredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        recipient: data.sentTo,
        simulated: data.simulated,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-10">
      {/* Letter Composer */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-7">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-human text-white">
              <Mail className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">Formal Email Ticket Dispatch</h2>
              <p className="text-xs text-muted">Legal paper trail & direct inbox delivery</p>
            </div>
          </div>
          <span className="rounded-full border border-human/20 bg-human-soft px-2.5 py-0.5 text-xs font-medium text-human-strong">
            Sends to your inbox
          </span>
        </div>

        {/* Demo Tip */}
        <div className="mt-4 rounded-2xl border border-line/60 bg-sunken p-3.5 text-xs text-ink-2 flex items-start gap-2.5">
          <Sparkles className="size-4 text-ai shrink-0 mt-0.5" />
          <span>
            <strong>Demo safety:</strong> the ticket is delivered to your own inbox (<code>DEMO_INBOX_EMAIL</code>), never to the company address below. Without <code>RESEND_API_KEY</code> it&apos;s simulated.
          </span>
        </div>

        <form onSubmit={handleDispatch} className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-ink-2">Recipient Support Email</label>
              <input
                required
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="support@company.com or your email"
                className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-xs text-ink focus:border-human focus:outline-none focus:ring-3 focus:ring-human/15"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-ink-2">Department / Organization</label>
              <input
                required
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-ink focus:border-human focus:outline-none focus:ring-3 focus:ring-human/15"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-ink-2">Sender Name</label>
              <input
                required
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-ink focus:border-human focus:outline-none focus:ring-3 focus:ring-human/15"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-ink-2">Sender Email (Reply-To)</label>
              <input
                required
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-xs text-ink focus:border-human focus:outline-none focus:ring-3 focus:ring-human/15"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2">Subject Line</label>
            <input
              required
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm font-medium text-ink focus:border-human focus:outline-none focus:ring-3 focus:ring-human/15"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-ink-2">Formal Ticket Body</label>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
              >
                {copied ? <Check className="size-3 text-human" /> : <Copy className="size-3" />}
                <span>{copied ? 'Copied' : 'Copy markdown'}</span>
              </button>
            </div>
            <textarea
              required
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full resize-y rounded-xl border border-line bg-bg p-3.5 font-mono text-xs leading-relaxed text-ink focus:border-human focus:outline-none focus:ring-3 focus:ring-human/15"
            />
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <div className="mt-2">
            <button
              type="submit"
              disabled={isSending}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-5 text-sm font-semibold text-bg transition hover:bg-ink/90 active:scale-[0.99] disabled:opacity-50"
            >
              {isSending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>Dispatching to Mail Server…</span>
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  <span>Dispatch Ticket</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Dispatch Receipt & History */}
      <section className="flex flex-col gap-6">
        <div className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-7">
          <h3 className="text-base font-semibold text-ink border-b border-line pb-4">
            Delivery Receipt & Status
          </h3>

          {!receipt ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-2">
              <Mail className="size-8 text-muted/60" />
              <p className="mt-3 text-sm font-medium text-ink">No ticket dispatched yet</p>
              <p className="mt-1 text-xs text-muted">
                Hit &ldquo;Dispatch Ticket&rdquo; to send this message and get a message ID.
              </p>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-4 animate-fade-in">
              <div className="rounded-2xl border border-human/30 bg-human-soft/40 p-4">
                <div className="flex items-center gap-2 text-human-strong font-semibold text-sm">
                  <CheckCircle2 className="size-4 text-human" />
                  <span>{receipt.simulated ? 'Simulated send' : 'Sent to your inbox'}</span>
                </div>
                <p className="mt-1 text-xs text-ink-2">
                  {receipt.simulated
                    ? 'No email was sent. Add RESEND_API_KEY and DEMO_INBOX_EMAIL to .env to send for real.'
                    : 'Accepted by Resend for delivery. Check your inbox (and spam folder).'}
                </p>
              </div>

              <div className="rounded-2xl border border-line bg-sunken p-4 text-xs flex flex-col gap-2 font-mono">
                <div className="flex justify-between border-b border-line/60 pb-1.5">
                  <span className="text-muted">Message ID:</span>
                  <span className="font-semibold text-ink">{receipt.id}</span>
                </div>
                <div className="flex justify-between border-b border-line/60 pb-1.5">
                  <span className="text-muted">Sent At:</span>
                  <span className="text-ink">{receipt.deliveredAt}</span>
                </div>
                <div className="flex justify-between pt-0.5">
                  <span className="text-muted">{receipt.simulated ? 'Would send to:' : 'Sent to:'}</span>
                  <span className="text-ink truncate max-w-[200px]">{receipt.recipient}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

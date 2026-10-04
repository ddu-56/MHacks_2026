# Omnichannel Backend Architecture & Implementation Plan

_Drafted: 2026-10-03 for MHacks 2026_

This document outlines the backend design for expanding **HoldLess** into an omnichannel customer advocate. It covers:
1. **Gemini Triage & Channel Recommender**
2. **Web / Browser Agent using Local Chrome Profile Reuse (Playwright)**
3. **Real Email / Ticket Dispatching to Real Inboxes (Resend / SMTP)**
4. **SpacetimeDB Unified Event Schema**

---

## 1. Gemini Triage & Channel Recommender

When the user enters a natural language complaint or customer service request on the home screen, Gemini categorizes the task and determines the optimal resolution channel.

### System Prompt & Reasoning Logic
```typescript
export interface TriageResult {
  provider: string;               // e.g. "Amazon", "Delta Air Lines", "Xfinity", "Anker"
  category: 'refund' | 'dispute' | 'support' | 'cancellation' | 'outage';
  summary: string;
  recommendedChannel: 'browser' | 'email' | 'phone';
  confidence: number;            // 0.0 - 1.0
  reasoning: string;             // User-facing explanation
  policyContext?: string;        // e.g. "Amazon 30-day return policy; non-returnables require damage photo"
  extractedDetails: {
    orderNumber?: string;
    accountNumber?: string;
    amount?: number;
    urgency: 'low' | 'medium' | 'high';
  };
  suggestedAction: {
    title: string;
    buttonLabel: string;
    prefilledTarget: string;     // URL, email, or phone
    prefilledPayload: Record<string, any>;
  };
}
```

### Channel Selection Matrix
* **`browser` (Web / In-App Agent)**:
  * Selected when the service explicitly prohibits email tickets and only allows self-service workflows through an in-app portal (e.g. Amazon returns, Uber ride disputes, DoorDash missing items).
* **`email` (Formal Ticket Dispatch)**:
  * Selected when written proof, serial numbers, photos, legal consumer rights, or an audit paper trail is necessary (e.g. Airline EU261 / DOT delay compensation, hardware warranty claims, merchant disputes, billing adjustments).
* **`phone` (Voice IVR Runner)**:
  * Selected when an urgent active outage exists, the company only accepts live verbal authorization, or voice queue wait time is the only path (e.g. ISP outages, banking fraud desk, Wolverine Wireless).

---

## 2. Web / Browser Agent: Local Chrome Profile Reuse

### Why Local Chrome Profile Reuse?
Major platforms (Amazon, Walmart, Apple) deploy sophisticated anti-bot fingerprinting and mandate 2-Factor Authentication (SMS OTP or app notification) for fresh browser logins. 

By launching **Playwright** with the user's **existing local Chrome User Data Directory (`userDataDir`)**:
1. The browser opens with the user's **existing authenticated sessions and active cookies**.
2. **No login credentials or passwords are typed or stored**.
3. **No 2FA prompts** appear because the device profile is already trusted by Amazon.

### Implementation Blueprint (Playwright)

```typescript
// backend/orchestrator/src/browser/runner.ts
import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import os from 'node:os';

export interface BrowserAgentOptions {
  task: 'amazon_return' | 'portal_navigation';
  itemQuery: string;
  returnReason: string;
  headless?: boolean;
}

export function getLocalChromeUserDataDir(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    // macOS Chrome profile
    return path.join(home, 'Library/Application Support/Google/Chrome');
  } else if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data');
  }
  return path.join(home, '.config/google-chrome');
}

export async function launchAuthenticatedBrowser(options: BrowserAgentOptions) {
  const userDataDir = getLocalChromeUserDataDir();
  
  // Note: Chrome must either be closed or started with a separate debug profile
  // or a temporary cloned session directory to avoid profile lock collisions.
  const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: options.headless ?? false, // Headful mode is visually stunning for demo!
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--profile-directory=Default'
    ],
  });

  const page: Page = context.pages()[0] || await context.newPage();
  
  try {
    // Step 1: Navigate to Orders
    await page.goto('https://www.amazon.com/gp/css/order-history', { waitUntil: 'domcontentloaded' });
    
    // Step 2: Gemini DOM Analyzer or Selector Engine
    // The runner captures a DOM snapshot or screenshot and asks Gemini for the exact selector
    // to locate the target order and click "Return or replace items".
    
    // Step 3: Fill Return Reason
    // Auto-selects "Defective / Does not work" -> enters explanation -> selects UPS Dropoff.
    
    // Step 4: Extract Return Confirmation & QR code
    const qrElement = await page.waitForSelector('img[alt*="Return QR"], .return-qr-code', { timeout: 15000 });
    const qrBuffer = await qrElement.screenshot();
    
    return {
      status: 'SUCCESS',
      qrCodeBase64: qrBuffer.toString('base64'),
    };
  } finally {
    await context.close();
  }
}
```

### Safety & Sandboxing Precautions
* **Cloned Session Scratchpad**: Instead of locking the primary Chrome profile directly (which causes `Profile in use` errors if Chrome is open), the runner clones the cookie jar and local storage into a temporary directory in `scratch/`.
* **Zero Credential Retention**: Passwords and credit card details are never scraped or stored.

---

## 3. Real Email / Ticket Dispatcher (To Real Inboxes)

For merchant disputes, warranty claims, and formal refund requests, the system drafts a legally grounded, professional escalation letter and dispatches it directly to a real recipient email.

### Recommended Provider: Resend
* **Why Resend?**
  * Instant setup: zero SMTP port blocking, fast delivery in <300ms.
  * Native REST API: can be dispatched directly with `fetch('https://api.resend.com/emails')`.
  * Free tier allows sending emails to your verified account/team email immediately for real-time inbox testing.
* **SMTP Fallback**:
  * If preferred, standard Nodemailer using standard Gmail / Outlook SMTP app passwords can be used.

### Dispatch Payload & Gemini Letter Generator

```typescript
// backend/orchestrator/src/email/dispatcher.ts
export interface EmailTicketPayload {
  recipientEmail: string;       // e.g. target support inbox or the user's email for testing
  recipientName: string;        // e.g. "Amazon Customer Relations" or "Delta Claims"
  senderName: string;
  senderEmail: string;
  subject: string;
  orderReference: string;
  bodyMarkdown: string;
}

export async function dispatchEmailTicket(payload: EmailTicketPayload, resendApiKey: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'HoldLess Concierge <onboarding@resend.dev>',
      to: [payload.recipientEmail],
      reply_to: payload.senderEmail,
      subject: payload.subject,
      text: payload.bodyMarkdown,
      html: renderEmailHtml(payload),
    }),
  });

  const data = await response.json();
  return {
    success: response.ok,
    messageId: data.id,
    sentAt: new Date().toISOString(),
  };
}
```

---

## 4. SpacetimeDB Unified Event Schema

To keep the UI real-time and reactive without polling, SpacetimeDB will track both phone calls and digital tickets/agent sessions.

```rust
// Proposed SpacetimeDB table additions:

// 1. Dispatched support tickets
#[spacetimedb::table(name = support_ticket, public)]
pub struct SupportTicket {
  #[primary_key]
  pub id: u64,
  pub user_id: Identity,
  pub provider_name: String,
  pub recipient_email: String,
  pub subject: String,
  pub status: String,           // DRAFT, DISPATCHED, DELIVERED, REPLIED
  pub message_id: Option<String>,
  pub created_at: Timestamp,
  pub delivered_at: Option<Timestamp>,
}

// 2. Browser automation sessions
#[spacetimedb::table(name = browser_session, public)]
pub struct BrowserSession {
  #[primary_key]
  pub id: u64,
  pub user_id: Identity,
  pub service: String,          // "Amazon", "Xfinity", etc.
  pub status: String,           // INITIALIZING, NAVIGATING, SELECTING_ITEM, COMPLETED, FAILED
  pub current_step: String,
  pub result_payload: Option<String>, // e.g. QR code URL or return reference ID
  pub started_at: Timestamp,
  pub completed_at: Option<Timestamp>,
}
```

---

## 5. Phased Backend Rollout

1. **Step 1 (Now)**:
   * Build the **Frontend Tabbed Interface** & **Advisor Home** so the UX is clear, interactive, and functional.
   * Provide built-in simulation mocks for email dispatch and browser returns to verify all user flows.
2. **Step 2**:
   * Add `/api/triage` route calling `@google/genai` with structured output schema.
3. **Step 3**:
   * Add `/api/email/dispatch` connecting to Resend or SMTP.
4. **Step 4**:
   * Wire Playwright with local Chrome profile cloning for headful Amazon return demonstration.

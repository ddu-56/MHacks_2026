# Omnichannel Backend Plan

_Revised: 2026-10-03 for MHacks 2026. Replaces the first draft (Rust schema, Chrome-profile reuse on Amazon, emails to real company inboxes)._

HoldLess expands from "wait on hold for me" to "get this resolved for me": Gemini reads a complaint, picks the best channel (phone, email or browser), and the matching agent does the work. The **phone flow stays the centerpiece of the demo**. Email and browser add breadth without adding risk.

## Ground rules

1. **Nothing contacts a real company.** Email goes only to our own inbox (`DEMO_INBOX_EMAIL`). The browser agent only drives a fake Wolverine Wireless portal. The phone flow already uses the fake Wolverine Wireless line.
2. **Every request is a row in SpacetimeDB.** The browser requests, the orchestrator does the work, and the dashboard subscribes, exactly like calls. That's the sponsor story: one live state for every channel.
3. **Simulated means labeled.** Anything not real shows a visible "Simulated" badge.
4. **The model never chooses a destination.** Phone numbers, email addresses and URLs come from a directory (`COMPANY_DIRECTORY` in `packages/shared`) or from the user, never from Gemini.
5. **API keys live in the orchestrator only.** No side effects in Next.js API routes.

## Channel selection

| Channel | When Gemini picks it | Demo target |
|---|---|---|
| `phone` | Urgent outages, fraud, or companies that only resolve things by voice | Wolverine Wireless IVR (existing) |
| `email` | Written proof or an audit trail matters: billing adjustments, warranty claims, delay compensation | Your own inbox via Resend |
| `browser` | Self-service-only portals: returns, ride/delivery disputes | Fake Wolverine Wireless account portal |

---

## Phase 0: Align what exists (~20 min, do first)

- **Label the browser flow as simulated.** In `BrowserAgentView.tsx` and `AdvisorHome.tsx`, remove the wording "attaches to your existing Chrome profile", "bypassing 2FA/login" and "Return Successfully Initiated on Amazon". Add a "Simulated" badge, like the phone flow's "Simulated line".
- Keep the current email safety behavior (`/api/email/dispatch` only sends to `DEMO_INBOX_EMAIL`) until Phase 2 replaces the route.

## Phase 1: One task model for every channel (~1.5 h, backend)

All in the TypeScript module at `backend/spacetimedb/src/index.ts`.

**Tables**
- `support_task`: `id`, `userId`, `channel` (`phone | email | browser`), `provider`, `query`, `summary`, `status`, `explanation` (short and user-facing, no model reasoning), `confidence`, `linkedCallId` (phone tasks link to the existing `call_session`), `result` (short and non-sensitive, e.g. a return reference), `errorMessage`, `createdAt`, `updatedAt`, `endedAt`.
- `task_event`: same shape as `call_event`, keyed by `taskId`, so the existing timeline component works for every channel.
- `task_draft` (email only): `taskId`, `recipientName`, `recipientEmail` (shown in the email, never sent to), `subject`, `body`.

**Status rules**, defined in `packages/shared` and enforced in the module like call transitions:
- Email: `REQUESTED → TRIAGED → DRAFTED → APPROVED → SENDING → SENT`
- Browser: `REQUESTED → TRIAGED → RUNNING → COMPLETED`
- Phone: `REQUESTED → TRIAGED`, then the existing call takes over through `linkedCallId`
- Any live status can move to `FAILED` or `CANCELLED`.

**Reducers**
- Browser: `requestTask(query)`, `confirmChannel(taskId, channel)`, `approveTask(taskId, editedDraft)`, `cancelTask(taskId)`.
- Orchestrator only: `recordTriage`, `saveDraft`, `updateTaskStatus`, `appendTaskEvent`, `completeTask`, `failTask`.

## Phase 2: Triage and email in the orchestrator (~1.5 h)

**Triage**
- The orchestrator subscribes to `REQUESTED` tasks and runs Gemini through the existing client in `backend/orchestrator/src/ai/`, which already picks the model and falls back to rules.
- The output is checked against a shared zod schema, like `validateDecision` on the phone side: a fixed category list, a channel from the list, confidence 0–1, an explanation of at most 240 characters, and prefill fields limited to what the user actually wrote.
- Below about 0.7 confidence, the UI shows "Confirm channel" instead of starting automatically.
- The keyword presets in `AdvisorHome.tsx` move into a rule-based triage fallback, so the app works without a key and still goes through SpacetimeDB.
- Policy notes are either grounded with Google Search (show the sources) or labeled "suggested". Never present them as fact.

**Phone**
- A triaged phone task creates a call through the existing `requestCall` path and stores `linkedCallId`. No changes to the call engine.

**Email**
- Gemini drafts the letter into `task_draft`. The user edits it and presses **Approve**.
- The orchestrator sends it through Resend to `DEMO_INBOX_EMAIL`, using the task id as an idempotency key so retries never double-send.
- The status moves to `SENT` with the message id. Stage moment: the email arriving on your phone, live.
- Without `RESEND_API_KEY`, the send is simulated and labeled.

**Cleanup**
- Delete `frontend/web/app/api/triage` and `frontend/web/app/api/email/dispatch`.
- `/api/search` can stay: it only reads and keeps no state. Add a simple rate limit if the app is ever exposed beyond localhost.

## Phase 3: Browser agent

> **Status (2026-10-03):** built, targeting **real Amazon at the team's request**, with these safeguards: a dedicated Chrome profile (you sign in yourself), no evasion flags, blocked purchase and payment controls, and an approval gate before submitting. See the README section "Browser agent: Amazon returns". The fake-portal design below remains the fallback for rehearsals (`test/fixtures/mock-amazon.ts`).

### Original fake-portal design

- Serve a small **Wolverine Wireless account portal** with no login: an orders list, a return wizard (item, reason, drop-off method) and a confirmation page with a return code.
- A visible Playwright Chrome window, with **its own temporary profile**, completes the return using fixed steps. Gemini only picks which order matches the request, from the known list, and its pick is validated before use.
- Each step becomes a `task_event`, and the return code is stored as the task `result`.
- If time runs out, keep the labeled simulation; the demo doesn't depend on this.

## Phase 4: Tests and rehearsal (~45 min)

- Tests:
  - triage validation, including malformed or low-confidence output
  - per-channel status rules
  - email task end to end with Resend stubbed, including the idempotency key
  - authorization: a browser can't move a task forward
  - the browser runner against the fake portal, if built
- Stage script: one request → Gemini picks a channel → **live phone call (main event)** → one email arriving in your inbox. Run `pnpm stdb:reset` before going on stage.

## Who does what

- **Frontend:** Phase 0 labels. Switch the tabs from local state and API responses to `useTable` subscriptions on `support_task`, `task_event` and `task_draft`. Add the Confirm channel and Approve buttons.
- **Backend:** Phases 1–2, then Phase 3 if there's time.

## Not doing (and why)

| Idea from the first draft | Why it's out |
|---|---|
| Reusing the user's local Chrome profile | Chrome ≥136 ignores the automation (remote-debugging) switches on the default profile ([Chromium](https://issues.chromium.org/issues/417456892)), and a cloned profile can't read the original's encrypted cookies |
| Automating real Amazon with bot-detection evasion | Puts the user's real account at risk under the site's terms, takes irreversible actions, and contradicts the spec ("avoid real companies and real consumer disputes") |
| Emailing real company inboxes | Resend's test sender only delivers to the account owner; LLM-written legal claims need review; not appropriate for a demo |
| Rust table definitions | The module is TypeScript |
| Side-effect API routes in Next.js | Keeps state outside SpacetimeDB and spreads API keys across services |

**Estimate:** about 4–5 h for Phases 0–2 and 4, plus up to 2 h for Phase 3.

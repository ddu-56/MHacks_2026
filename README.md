# HoldLess

**AI waits on customer service so you don't have to.** Say "get me a human at Wolverine Wireless about an incorrect charge". HoldLess places the call, works the phone menu, sits on hold, and rings your phone the moment a real person picks up.

## Problem

Reaching a person at a company means 2–40 minutes of phone trees and hold music. You can't walk away, because if you miss the moment a representative answers, you start over.

## Solution

HoldLess handles everything *before* a human is available, then gets out of the way:

1. Understands who you want to reach and why.
2. Dials the support line (Twilio).
3. Listens to the IVR (ElevenLabs Scribe realtime STT).
4. Picks the menu option that best matches your goal (Google Gemini, structured output, validated) and presses keys.
5. Detects the hold queue and waits.
6. Detects a live representative (multi-signal classifier) and briefly asks them to hold.
7. Calls you. You press 1 (so voicemail can never be bridged in) and you're conferenced straight to the representative.
8. Stops listening. It never negotiates or talks to the rep on your behalf.

Every step is a state transition in **SpacetimeDB**, so the dashboard updates live.

## Architecture

```
            ┌──────────────┐        ┌───────────────────┐
  User ───▶ │ Next.js web  │        │ iMessage (Photon  │ ◀── "Get me billing at…"
            │  dashboard   │        │  Spectrum)        │
            └──────┬───────┘        └─────────┬─────────┘
   request_call /  │ subscribe (live rows)     │
   cancel_call     ▼                           ▼
            ┌─────────────────────────────────────────────┐
            │                 SpacetimeDB                  │
            │ call_session · call_event · transcript_seg.  │
            │ call_action · agent_status · user_context    │
            │ orchestrator (heartbeat) · watchdog (sched.) │
            │  every transition = one transactional reducer│
            └──────────────────────┬──────────────────────┘
                 subscribe + call  │ reducers (only the registered orchestrator)
                                   ▼
            ┌─────────────────────────────────────────────┐
            │      Call orchestrator (Node/TypeScript)     │
            │  CallRunner state machine per call           │
            │  IvrAgent (Gemini → validate → act)          │
            │  Human/hold detector · ContextProvider       │
            │  TelephonyProvider: Mock | Twilio            │
            └───────┬───────────────────────┬─────────────┘
         TwiML/REST │ media WS (μ-law)       │ STT / TTS
                    ▼                        ▼
               ┌─────────┐            ┌────────────┐
               │ Twilio  │            │ ElevenLabs │
               └────┬────┘            └────────────┘
                    ▼
     Customer service line (demo: "Wolverine Wireless" IVR, served by the orchestrator)
```

### Why SpacetimeDB matters here

SpacetimeDB acts as the realtime shared state and coordination layer for support calls. The web interface, telephony service, and AI system all observe and modify the same persistent call state, so call progress and agent actions sync instantly.

Concretely:

- **The call is the state machine.** `call_session.status` changes only through reducers (`updateCallStatus`, `markHumanDetected`, `markUserConnected`, `failCall`, …), and all of them go through one `transition()` function. It enforces the legal transition graph (`packages/shared/src/states.ts`, imported straight into the module) and stamps milestones (`holdStartedAt`, `humanDetectedAt`, `connectedAt`). An illegal jump such as `ON_HOLD → USER_CONNECTED` is rejected by the database.
- **SpacetimeDB is the queue.** The web app calls `requestCall`. The orchestrator is subscribed, sees the `REQUESTED` row and claims it with `claimCall`. Nothing talks to the orchestrator directly, so iMessage requests take the same path.
- **Authorization lives in the module.** Only the registered orchestrator identity may drive calls. Browsers can only request and cancel.
- **Liveness.** The orchestrator heartbeats into the `orchestrator` table, which the header shows as "Call agent online". A scheduled `watchdog` reducer fails requests nobody claims, so the UI never spins forever.
- **Append-only history.** `call_event` (with idempotency keys for duplicate webhooks), `transcript_segment` and `call_action` power the timeline, transcript and agent panel through subscriptions. There's no polling anywhere.

## Repository layout

```
apps/web            Next.js 16 + Tailwind 4 dashboard (spacetimedb/react hooks)
apps/orchestrator   Node service: CallRunner, Gemini agent, detectors, Twilio/mock providers,
                    ElevenLabs voice, Wolverine Wireless IVR (TwiML), iMessage channel
spacetimedb/        SpacetimeDB TypeScript module (tables + reducers)
packages/shared     State machine, vocab, IVR decision schema + validator, demo script
packages/db         Generated SpacetimeDB client bindings
docs/               progress.md, demo-script.md
```

## Setup

Prerequisites: Node 22+, pnpm 10, and the SpacetimeDB CLI (`curl -sSf https://install.spacetimedb.com | sh`).

```bash
pnpm install
cp .env.example .env            # mock mode works with no keys at all

spacetime start                 # terminal 1: local SpacetimeDB on :3000
pnpm stdb:deploy                # publish module + regenerate bindings
pnpm dev                        # web on :3001 + orchestrator on :4000
```

Open http://localhost:3001 and click **Run demo**.

Useful scripts: `pnpm stdb:reset` (wipe data and republish), `pnpm test`, `pnpm typecheck`.

## Environment variables

See [`.env.example`](.env.example). Summary:

| Variable | Purpose |
|---|---|
| `TELEPHONY_MODE` | `mock` (no calls), `hybrid` (simulated company line, real calls to people) or `twilio` (all real) |
| `DEMO_MODE` | Short holds, **Run demo** button |
| `NEXT_PUBLIC_SPACETIMEDB_HOST/MODULE`, `SPACETIMEDB_HOST/MODULE` | SpacetimeDB connection |
| `PUBLIC_BASE_URL` | Public HTTPS tunnel to the orchestrator (Twilio webhooks + media WebSocket) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Outbound calling |
| `WOLVERINE_IVR_NUMBER`, `DEMO_REP_PHONE_NUMBER`, `USER_PHONE_NUMBER` | Demo line, teammate rep, your phone |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | IVR reasoning (blank = rule-based agent) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Realtime STT + TTS (blank = Twilio transcription + `<Say>`) |
| `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` | iMessage via Photon Spectrum (blank = off) |
| `HUMAN_CONFIDENCE_THRESHOLD`, `POSSIBLE_HUMAN_THRESHOLD` | Handoff thresholds (0.8 / 0.5) |

## Mock mode

`TELEPHONY_MODE=mock` (the default) runs the Wolverine Wireless phone tree in-process, using the same script as the real Twilio IVR (`packages/shared/src/wolverine.ts`). It emits transcripts sentence by sentence, as streaming STT would, plus hold music signals, announcements, the representative's greeting, and a simulated user answering. Everything else is real: SpacetimeDB, the CallRunner, validation, detection and the dashboard. With no `GEMINI_API_KEY` the deterministic rule-based agent makes the decisions, and the header says so. The demo takes about 30 seconds end to end.

## Hybrid demo (free Twilio trial, one number)

The company's phone tree, hold queue and greeting are simulated. **The calls to people are real.** When the representative is detected, HoldLess rings your actual phone. You press 1 and you're connected to either:

- a **teammate playing the rep** (`DEMO_REP_PHONE_NUMBER`): they're rung at the same moment, hear a short brief, wait with hold music, and you're conferenced together; or
- the **scripted rep "Sarah"** (no rep number, or the teammate doesn't pick up within 15 seconds).

Setup:

1. Create a Twilio account. The trial is fine and gives you one number.
2. In the console, verify your phone (and your teammate's) under **Phone Numbers → Verified Caller IDs**. Trial accounts can only call verified numbers.
3. `brew install cloudflared && cloudflared tunnel --url http://localhost:4000`, then set `PUBLIC_BASE_URL` to the printed URL.
4. In `.env`, set `TELEPHONY_MODE=hybrid`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `USER_PHONE_NUMBER` and, optionally, `DEMO_REP_PHONE_NUMBER`.
5. Restart `pnpm dev` and click **Run demo**.

On a trial, each callee first hears Twilio's "trial account, press any key" notice. Press any key, then press 1 at the HoldLess briefing. The dashboard labels these calls **Simulated company line · real callback**.

## Twilio demo (real phones)

1. Buy two Twilio numbers: one for HoldLess (`TWILIO_PHONE_NUMBER`) and one for the fake company (`WOLVERINE_IVR_NUMBER`).
2. Start a tunnel to the orchestrator, e.g. `ngrok http 4000` or `cloudflared tunnel --url http://localhost:4000`, and set `PUBLIC_BASE_URL` to it.
3. In the Twilio console, set the Wolverine number's **Voice → A call comes in** webhook to `POST {PUBLIC_BASE_URL}/ivr/wolverine`.
4. Set `TELEPHONY_MODE=twilio`, `USER_PHONE_NUMBER` (your cell) and optionally `DEMO_REP_PHONE_NUMBER` (a teammate's cell). Without a teammate, a scripted rep ("Sarah") answers.
5. Add `GEMINI_API_KEY` and `ELEVENLABS_API_KEY` for the full experience, then run `pnpm dev`.
6. Click **Run demo**. HoldLess dials Wolverine, presses 3 (Billing), then 2 (Dispute a charge), and waits through the hold music. When your teammate answers ("Hi, thanks for holding, my name is…"), your phone rings. Press 1 and you're talking to them.

On a Twilio trial account, verify the user and rep numbers first.

How the Twilio leg works: the support call runs `<Start><Stream>` to fork the company's audio to `wss://…/twilio/media`. That audio goes to ElevenLabs Scribe and a hold-music energy classifier, or to Twilio real-time transcription as a fallback. Key presses and speech are sent by updating the call's TwiML (`<Play digits>`, `<Play>` ElevenLabs audio). The fork re-attaches over REST if it ever drops. On handoff, the rep goes into a `<Conference>` with hold music. The user's call plays a briefing and requires **press 1**, and then joins that conference.

## Sponsor technologies

- **SpacetimeDB:** the system of record and realtime bus. It holds the state machine, authorization, heartbeat and watchdog (see above).
- **Twilio:** outbound calls, media streams, DTMF via TwiML, conference bridging, and the hosted demo IVR.
- **ElevenLabs:** Scribe v2 realtime STT on the live phone audio (μ-law passthrough), plus TTS for the user briefing, the rep courtesy message and any SPEAK action.
- **Google Gemini:** IVR reasoning with JSON-schema structured output. Prompt in `apps/orchestrator/src/ai/prompts/ivr-agent.md`. Every response is validated by `validateDecision` before it can touch the phone line.
- **Photon Spectrum:** iMessage front door. Text a request, get status texts and a live link back.

## Safety boundaries

- Actions are an enum (`WAIT`, `PRESS_KEY`, `SPEAK`, `TRANSFER_TO_USER`, `END_CALL`). Model text never reaches Twilio directly.
- Key presses must be offered by the menu. Multi-digit entries and spoken numbers must come from details the user gave. Credentials (PINs, passwords, SSNs) are refused and handed to the user.
- Low confidence means wait, never guess. Repeated low confidence, IVR loops or too many menu levels stop the call.
- Bridging requires a confidence of 0.8 or higher **and** a concrete human cue (introduction, "how can I help"). Queue announcements like "thank you for holding, your call is important" can't trigger it.
- Only short, user-readable explanations are stored, never model reasoning.
- After the bridge, the AI stops listening entirely.

## Testing

```bash
pnpm test     # shared: validation, state machine, parsing · orchestrator: rules, detection,
              # Gemini agent (stubbed), Twilio webhooks (stubbed REST), IVR TwiML, full mock flow
```

`apps/orchestrator/test/flow.test.ts` is the deterministic spec scenario: goal "incorrect charge" → presses **3**, then **2** → `ON_HOLD` → "Hi, thanks for holding. My name is Sarah…" → `HUMAN_DETECTED` → `USER_CONNECTED`. `spacetime.int.test.ts` runs against the live local module (reducer validation and authorization) and skips itself when no server is running.

## Known limitations

- Twilio and ElevenLabs paths (including hybrid mode) are covered by stubbed tests and the docs, but haven't been exercised against live credentials in this repo yet. Mock mode is fully exercised.
- Hold-music detection uses energy, not ML. It works for the demo line; real-world queues will need tuning.
- Public tables mean any connected client can read every call. Real use needs per-user views and SpacetimeAuth.
- A call can't survive an orchestrator restart. In-flight calls are marked failed rather than resumed.
- The company directory only knows the fictional Wolverine Wireless. Other companies need an explicit number.
- iMessage replies go to whoever texted. The callback number comes from the sender handle or `USER_PHONE_NUMBER`.

## Future work

Gmail/calendar `ContextProvider`s (the interface already exists), per-user auth and views, resumable calls, learned hold/human audio classifiers, callback-queue handling ("press 1 to receive a callback"), and a company directory with known IVR shortcuts.

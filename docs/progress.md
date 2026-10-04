# Progress

_Last updated: 2026-10-03_

## Completed
- **Phase 1:** pnpm monorepo. SpacetimeDB TS module (7 tables, 15 reducers, scheduled watchdog, orchestrator auth + heartbeat). Shared state machine/types. Generated bindings. Next.js dashboard with live subscriptions. Mock call flow end to end.
- **Phase 2:** Gemini IVR agent (structured JSON output, prompt file, model auto-select, timeout and fallback). Deterministic rule-based agent. `validateDecision` gate. User-readable action summaries.
- **Phase 3:** Twilio provider (outbound call, `<Start><Stream>` media fork, DTMF via TwiML update, status webhooks, stream self-healing). Wolverine Wireless IVR served as TwiML with synthesized hold music.
- **Phase 4:** Multi-signal human detector (heuristics + LLM blend, threshold + supporting cue). Rep parked in conference. User call with briefing + press-1 gate. Conference bridge. AI stops listening.
- **Phase 5:** ElevenLabs Scribe realtime STT (μ-law passthrough) and TTS for briefing / courtesy message / SPEAK. Twilio transcription + `<Say>` fallback.
- **Phase 6:** Polished dashboard (stepper, live timeline, transcript, agent activity, human meter, hold/handoff moments, dark mode, mobile).
- **Phase 7:** Photon Spectrum iMessage channel (request by text, milestone texts, live link). `ContextProvider` interface.
- **Phase 8 (Omnichannel Expansion):** Added top-level tabbed switcher (`OmniTabs`) with AI Advisor home screen (`AdvisorHome`), Web & Browser Agent tab (`BrowserAgentView` for Amazon returns and portal navigation), Email & Ticket Dispatcher tab (`EmailTicketView` for direct inbox delivery), and preserved Phone Queue & Activity history views. Drafted comprehensive backend architecture plan in `docs/OMNICHANNEL_BACKEND_PLAN.md`.
- **Hybrid mode:** `TELEPHONY_MODE=hybrid` (simulated company line + real Twilio calls to the user and optional teammate rep, scripted-rep fallback, readable trial-account errors). Works on a free Twilio trial with one number.
- **Tests:** 16 shared + 33 orchestrator (incl. full mock flow, stubbed Twilio webhooks, live SpacetimeDB reducer test).

- **Browser agent (Amazon returns):** `support_task`/`task_event` tables + reducers, Playwright agent with a dedicated Chrome profile, sign-in handoff, approval gate, console at `localhost:4000/agent`. Verified end to end against a local Amazon stand-in and checked against real amazon.com's sign-in redirect.

## Currently working
- Reviewing backend architecture for Local Chrome Profile reuse & Email dispatch API.

## Blockers
- No Twilio, Gemini, ElevenLabs or Photon credentials in this environment, so real-phone, live-Gemini, live-Scribe and iMessage paths are unverified against live services. Mock mode is verified end to end in the browser.

## Next steps
1. Review `docs/OMNICHANNEL_BACKEND_PLAN.md` for Chrome profile reuse and Email API rollout.
2. Twilio trial: verify phones, start cloudflared, run the hybrid demo (README → Hybrid demo). Full Twilio demo needs an upgraded account and a second number.
2. Tune `UTTERANCE_GAP_MS` and the hold-music energy threshold on real audio.
3. Rehearse with `docs/demo-script.md`. Run `pnpm stdb:reset` before going on stage.

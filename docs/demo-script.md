# 3-minute demo script

**Before going on stage:** `pnpm stdb:reset`, restart `pnpm dev`, and check that the header shows four green chips (SpacetimeDB live · Call agent online · Twilio · Gemini). Your phone is on ring, and your teammate (the "rep") has their phone ready.

| Time | Say | Show |
|---|---|---|
| 0:00 | "Calling customer service means 20 minutes of phone menus and hold music, and you can't walk away." | Dashboard |
| 0:20 | "With HoldLess you just say who you need." Type *Get me a human at Wolverine Wireless about an incorrect charge.* | The form fills itself |
| 0:35 | Click **Run demo**. "It's dialing a real phone line right now." | Call page: Dialing → Navigating IVR |
| 0:50 | "It's listening to the menu with ElevenLabs. Gemini picks **Billing**, then **Dispute a charge**, and it explains why." | Timeline, agent activity, transcript |
| 1:10 | "Now it's on hold, so I'm not." | Amber hold banner, hold timer ticking |
| 1:30 | Teammate answers: "Hi, thanks for holding, my name is Sam. How can I help?" | Human meter jumps. **Representative found** (green moment) |
| 1:40 | "My phone is ringing." Answer, press 1. | CALLING_USER → BRIDGING → **You're connected** |
| 1:50 | Talk to the teammate live for a few seconds. "The AI has left the call. It never negotiates for me." | Agent: "Handed off" |
| 2:10 | "Every transition is a SpacetimeDB reducer, and the browser, the phone agent and iMessage all share that one live state." | Timeline: "synced from SpacetimeDB" |
| 2:30 | Optional: text the iMessage number "Get me billing at Wolverine Wireless about my incorrect charge" | Status texts arrive |

**On a Twilio trial:** use `TELEPHONY_MODE=hybrid`. Same script, but the 0:35–1:30 portion runs on the simulated company line (say so). Your phone ringing and the conversation at 1:40 are real calls. Press any key at Twilio's trial notice, then press 1.

**Fallbacks:**
- If phones are flaky, set `TELEPHONY_MODE=mock`. The same flow runs in about 30 seconds with no calls.
- If the teammate misses the call, the IVR falls back to the scripted rep "Sarah".

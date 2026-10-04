# Gemini API Setup (Triage + Web Search)

The web app uses Google Gemini in two places:

| Feature | Route | What it does | Without a key |
|---|---|---|---|
| Triage | `POST /api/triage` | Reads the complaint on the home screen and picks provider, category, channel (browser / email / phone) and form prefill | Falls back to keyword-matched demo presets |
| Web search | `POST /api/search` | Top-right search bar; Gemini + Google Search grounding, returns an answer with source links | Returns a mock answer |

Both routes call the Gemini REST API through `frontend/web/lib/gemini.ts`. The key stays on the server and is never sent to the browser.
The orchestrator (phone menu agent) reads the same key from the same `.env`.

## 1. Get a free API key

1. Go to <https://aistudio.google.com> and sign in with a Google account.
2. Click **Get API key** → **Create API key**. Let it create a new Google Cloud project.
3. **Do not** click "Set up billing". A project without billing is on the **free tier**: requests are rate-limited, and you cannot be charged.

## 2. Add the key to `.env`

All apps read one `.env` file at the **repo root**.

```bash
cd MHacks_2026            # repo root
cp .env.example .env      # skip if .env already exists
```

Edit `.env`:

```bash
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=             # optional; blank = gemini-2.5-flash
```

Check that git will not commit it:

```bash
git check-ignore .env     # should print ".env"
```

## 3. Restart and test

Next.js reads `.env` only at startup, so restart the web dev server (`pnpm dev` / `pnpm --filter @holdless/web dev`).

```bash
# Triage: should return JSON with provider "Spotify", not a demo preset
curl -s -X POST localhost:3001/api/triage \
  -H 'content-type: application/json' \
  -d '{"query":"Spotify charged me twice this month"}'

# Search: answer should NOT start with "(Mock result)"
curl -s -X POST localhost:3001/api/search \
  -H 'content-type: application/json' \
  -d '{"query":"Delta flight delay compensation policy"}'
```

In the UI: type a complaint that isn't one of the preset chips. If the card names the right company, Gemini is working.

## Troubleshooting

| Response | Meaning | Fix |
|---|---|---|
| `{"error":"GEMINI_API_KEY not set"}` (503) | Server didn't see the key | Key must be in the **root** `.env`; restart the dev server |
| `Gemini 400 ... API key not valid` | Typo or deleted key | Copy the key again from AI Studio |
| `Gemini 429 ...` | Free-tier rate limit hit | Wait a minute (per-minute limit) or until tomorrow (daily limit). The UI falls back to presets automatically |
| `Gemini 404 ... model not found` | `GEMINI_MODEL` is wrong | Leave it blank to use `gemini-2.5-flash` |
| `Gemini 400 ... thinking` | Model doesn't accept the thinking setting | Leave `GEMINI_MODEL` blank, or use a `gemini-2.5-*` / `gemini-3-*` model |

## Cost control

**The free tier is the main protection: a key in a project without billing cannot be charged.** When the limits are hit, calls fail with 429 and the app falls back to mock/preset output.

Built-in limits (in code):

- Gemini is called only when you press Enter, never while you type.
- Input is capped at 1,000 characters (triage) and 500 (search).
- Output is capped at 800 tokens (triage) and 600 (search).
- "Thinking" is off on 2.5 models (low on 3.x models), which cuts hidden token usage.
- It uses the Flash model by default, the cheap tier.

Notes:

- **Web search is the most expensive call.** Google Search grounding is billed per search beyond a free daily allowance on paid projects. On the free tier it's only rate-limited.
- Check usage on AI Studio's usage / rate-limit page.

### If you ever enable billing

1. **Google Cloud Console → Billing → Budgets & alerts**: set a budget (e.g. $5). Budget alerts **only send email; they do not stop spending.**
2. **APIs & Services → Generative Language API → Quotas**: lower the requests-per-day quota. That cap is what actually stops requests.
3. Never put the key in client code (`NEXT_PUBLIC_*`), screenshots or commits. A leaked key is the most common cause of a surprise bill. If one leaks, delete it in AI Studio and create a new one.

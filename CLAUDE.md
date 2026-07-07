# MagnaFlow Parts Bot — Project Handoff

## What This Is

A chat + voice bot that qualifies a customer's vehicle (year/make/model/engine/submodel/lift) and returns the exact MagnaFlow SKU, price, sound level, install difficulty, and product link. Built for demo against a seeded slice of the catalog. Schema is ACES/PIES-ready — a full data drop requires no structural changes.

## Repo

https://github.com/V1-Brian/magnaflow-bot

Clone to get started:
```bash
git clone https://github.com/V1-Brian/magnaflow-bot.git
cd magnaflow-bot
```

All repos live in `C:\Dev Projects\` — clone there.

---

## Completed

### Project scaffold
- Full monorepo created at `C:\Dev Projects\magnaflow-bot\`
- Pushed to GitHub under `V1-Brian/magnaflow-bot` (public repo, `master` branch)

### Backend (`backend/`)
- `src/index.js` — Express entry point, CORS, static audio serving, health check
- `src/routes/chat.js` — POST `/chat` with in-memory session store
- `src/routes/voice.js` — Twilio webhook routes (`/voice/inbound`, `/voice/respond`)
- `src/services/claude.js` — Two-pass Claude API: extract vehicle params, then qualify + respond
- `src/services/fitment.js` — Postgres fitment lookup with progressive narrowing
- `src/services/tts.js` — ElevenLabs TTS synthesis, saves to `/tmp`, returns URL for Twilio
- `src/services/cache.js` — Cloudflare Workers KV fetch for pre-cached product pages
- `src/prompts/system.js` — Full Claude system prompt with qualification flow, rules, tone
- `src/db/schema.sql` — PostgreSQL schema: `vehicles`, `parts`, `fitment`, `part_attributes`
- `src/db/seed.js` — Demo seed: 10 vehicles, 4 parts, 8 fitment mappings, attributes
- `src/db/import-aces.js` — ACES XML + PIES XML importer (run when MagnaFlow provides data)
- `backend/.env.example` — All required env vars documented
- `backend/package.json` — Dependencies: `@anthropic-ai/sdk`, `express`, `pg`, `twilio`, etc.

### Frontend (`frontend/`)
- `src/App.jsx` — Root component
- `src/main.jsx` — React DOM entry point
- `src/components/ChatWidget.jsx` — Full chat UI, session ID, fetch to backend
- `src/components/MessageBubble.jsx` — User/bot message bubbles (MagnaFlow red `#CC0000`)
- `src/components/PartCard.jsx` — SKU result card with price, sound, install, product link
- `src/components/VoiceButton.jsx` — Browser Web Speech API mic toggle
- `src/index.css` — Base reset
- `frontend/index.html` — Vite HTML shell
- `frontend/vite.config.js` — Vite + React plugin
- `frontend/package.json` — Dependencies: React 18, Vite, uuid
- `frontend/.env.example` — `VITE_API_URL` documented

### Scripts
- `scripts/cache-pages.js` — Pre-caches 4 MagnaFlow product pages into Cloudflare KV

### Deployment fixes applied
- `frontend/package.json` — moved `vite` and `@vitejs/plugin-react` from `devDependencies` to `dependencies` (Vercel runs `npm install --production` and was missing the build tool)
- `vercel.json` — added at repo root with explicit `buildCommand`, `outputDirectory`, and `installCommand` pointing into `frontend/` so deployment config is in source control and not dependent on Vercel dashboard settings

### Bot behavior fixes applied
- `backend/src/prompts/system.js` — bot now opens with one broad "tell me about your vehicle" question and only follows up on missing fields, instead of asking year → make → model sequentially
- `backend/src/services/claude.js` — extraction pass now marks `ready: true` as soon as year + make + model are known; sound preference no longer blocks the fitment lookup (it is a post-lookup filter, not a pre-lookup requirement)

### Database
- Schema initialized and demo data seeded against Render Postgres (as of 2026-07-07)
- 10 vehicles, 4 parts, 8 fitment mappings, 8 part attributes
- Verified: `SELECT count(*) FROM fitment` → 8

---

## Environment Setup (New Machine)

### Backend
```bash
cd backend
cp .env.example .env
# Fill in: DATABASE_URL, ANTHROPIC_API_KEY, CF_*, ELEVENLABS_*, TWILIO_*, PUBLIC_BASE_URL
npm install
```

> **Important:** Append `?sslmode=require` to `DATABASE_URL` when connecting from a local machine to Render Postgres, or the Node pg client will get ECONNRESET. Example:
> `DATABASE_URL=postgresql://user:pass@host/db?sslmode=require`
> Render's dashboard injects this automatically for server-side connections — only needed locally.

### Frontend
```bash
cd frontend
cp .env.example .env
# Set VITE_API_URL=https://your-render-service.onrender.com
npm install
```

---

## Deployment

The project has two separately deployed services. Deploy in this order — frontend depends on knowing the backend URL first.

### 1. Render PostgreSQL (database)

1. render.com → **New → PostgreSQL** → free tier → create
2. Copy the **External Database URL**
3. Paste it as `DATABASE_URL` in `backend/.env` (append `?sslmode=require` for local use)
4. Initialize the schema and seed demo data:
   ```bash
   psql $DATABASE_URL -f backend/src/db/schema.sql
   cd backend && npm install && npm run seed
   ```
5. Verify: `psql $DATABASE_URL -c "SELECT count(*) FROM fitment;"` → should return **8**

### 2. Render Web Service (backend)

1. render.com → **New → Web Service** → connect `V1-Brian/magnaflow-bot`
2. Settings:
   - **Root directory:** `backend`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
3. Add all env vars from `backend/.env.example` in the Render dashboard
4. Deploy — confirm: `GET https://your-service.onrender.com/health` returns `{"ok":true}`

> **Free tier cold start:** Render spins down after 15 min of inactivity. First request after idle takes ~30s. Fine for testing — upgrade to the $7/mo always-on tier before a live demo.

> **Twilio / ElevenLabs are voice-channel only.** They're not needed to get the web chat bot live. `TWILIO_*` and `ELEVENLABS_*` can stay blank until you tackle Priority 2 (voice channel) below — the chat flow works fully without them.

### 3. Vercel (frontend)

1. vercel.com → **Add New Project** → import `V1-Brian/magnaflow-bot`
2. Leave **Root Directory** as repo root — `vercel.json` handles routing to `frontend/` automatically
3. Add env var: `VITE_API_URL=https://your-render-service.onrender.com`
4. Framework preset: **Vite**
5. Deploy

Vercel auto-deploys on every push to `master` — no manual steps needed after this.

---

## Next Steps

### Priority 1 — Verify the live deployment

#### 1. End-to-end smoke test
Run the three demo scenarios after deploying:
- 2019 Tacoma TRD Off-Road 3.5L, stock → SKU 19293 (and 19291 as alt)
- Same truck, mention a 3-inch lift → SKU 19583
- 2021 F-150 XLT 5.0L → SKU 19835

Test tip: open with the full vehicle description in one message — the bot should ask at most one follow-up before returning results.

---

### Priority 2 — Expand demo catalog data

Currently only 4 parts are seeded. Other vehicles in the DB (Silverado, Mustang, Wrangler, Ram 1500) have no fitment mappings and will return empty. Options:

- **Manual:** Add real MagnaFlow SKUs from magnaflow.com for the seeded vehicles into `backend/src/db/seed.js`
- **ACES/PIES import:** When MagnaFlow provides data files, run `npm run import-aces` — no schema changes needed

---

### Priority 3 — Voice channel

#### Wire Twilio inbound number
- Buy or configure a Twilio phone number
- Set the webhook to `POST https://your-render-service.onrender.com/voice/inbound`
- Test by calling the number — bot should greet and ask about the vehicle

#### ElevenLabs TTS (optional upgrade from Twilio Polly)
- In `backend/src/routes/voice.js`, uncomment the ElevenLabs block and comment out the `twiml.say` line
- Set `PUBLIC_BASE_URL` in env (must be publicly reachable — your Render URL)
- Ensure `/tmp` audio files are being served via `/audio` static middleware

#### Vapi.ai alternative (faster voice path)
- Create account at vapi.ai
- Create assistant, paste in the system prompt from `backend/src/prompts/system.js`
- Set server URL to `https://your-render-service.onrender.com/chat`
- Assign a phone number — no Twilio code changes needed

---

### Priority 4 — Production hardening

#### Replace in-memory sessions with Redis or Postgres
- `backend/src/routes/chat.js` and `voice.js` both use `new Map()` for session state
- This works for a single-instance demo but resets on every deploy and doesn't scale
- Replace with a Redis `SET`/`GET` with a 30-minute TTL, or a `sessions` table in Postgres

#### Rate limiting
- Add `express-rate-limit` to the `/chat` route
- Reasonable demo limit: 30 requests/minute per IP

#### Auth / embed token (if embedding on a client site)
- The `/chat` endpoint is currently open
- Add a shared secret header check or JWT if embedding on a public-facing site

#### Error observability
- Add Sentry or equivalent to catch Claude API errors, DB timeouts, Twilio failures
- The current `console.error` fallbacks are sufficient for a demo but not production

#### Streaming responses
- The current Claude call uses `client.messages.create` (blocking)
- For a snappier chat feel, switch to `client.messages.stream` and stream tokens to the frontend via SSE or WebSocket

---

### Priority 5 — UX polish

#### Loading states and typing indicator
- `ChatWidget.jsx` shows `"..."` while loading — replace with an animated dots component

#### Mobile embed / iframe packaging
- Wrap `ChatWidget` in a shadow DOM or iframe-ready bundle so it can be dropped onto any client site with one script tag

#### Sound preference UI
- Add three buttons (Mild / Moderate / Aggressive) that appear after make/model is confirmed
- Pre-fills the answer so the customer doesn't have to type it

#### Part comparison view
- When multiple SKUs are returned, show them side-by-side in `PartCard` with a "Compare" toggle

---

## Key Files Quick Reference

| File | Purpose |
|---|---|
| `backend/src/prompts/system.js` | Claude system prompt — edit qualification flow and tone here |
| `backend/src/services/claude.js` | Two-pass Claude orchestration — extraction + response |
| `backend/src/db/schema.sql` | Database schema — authoritative structure |
| `backend/src/db/seed.js` | Demo data — add vehicles/parts/fitment here for the demo |
| `backend/src/services/fitment.js` | SQL query logic — tune vehicle matching here |
| `frontend/src/components/ChatWidget.jsx` | Main chat UI — session, message loop, state |
| `vercel.json` | Vercel build config — routes to frontend/, do not move or delete |

## Claude Model

Uses `claude-sonnet-4-6` for both the extraction pass and the customer-facing response pass. The extraction pass is capped at 512 tokens (JSON only). The response pass is capped at 1024 tokens.

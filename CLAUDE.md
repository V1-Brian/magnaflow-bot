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

---

## Environment Setup (New Machine)

### Backend
```bash
cd backend
cp .env.example .env
# Fill in: DATABASE_URL, ANTHROPIC_API_KEY, CF_*, ELEVENLABS_*, TWILIO_*, PUBLIC_BASE_URL
npm install
```

### Frontend
```bash
cd frontend
cp .env.example .env
# Set VITE_API_URL=https://your-render-service.onrender.com
npm install
```

---

## Next Steps (Not Started)

### Priority 1 — Required to run the demo

#### 1. Provision Render PostgreSQL
- Create a new Render Postgres instance
- Copy the external `DATABASE_URL` into `backend/.env`
- Run schema: `psql $DATABASE_URL -f backend/src/db/schema.sql`
- Run seed: `cd backend && npm run seed`
- Verify: `psql $DATABASE_URL -c "SELECT count(*) FROM fitment;"`  — should return 8

#### 2. Deploy backend to Render
- Create a new Render Web Service pointed at the GitHub repo
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Add all env vars from `.env.example` in the Render dashboard
- Confirm `/health` returns `{"ok":true}`

#### 3. Deploy frontend to Vercel
- Import `V1-Brian/magnaflow-bot` into Vercel
- Set root directory: `frontend`
- Add env var: `VITE_API_URL=https://your-render-service.onrender.com`
- Deploy and verify the chat widget loads and sends messages

#### 4. End-to-end smoke test
Run the three demo scenarios from the README:
- 2019 Tacoma TRD Off-Road 3.5L, stock → SKU 19293
- Same truck, 3-inch lift → SKU 19583
- 2021 F-150 5.0L → SKU 19835

---

### Priority 2 — Voice channel

#### 5. Wire Twilio inbound number
- Buy or configure a Twilio phone number
- Set the webhook to `POST https://your-render-service.onrender.com/voice/inbound`
- Test by calling the number — bot should greet and ask for vehicle year

#### 6. ElevenLabs TTS (optional upgrade from Twilio Polly)
- In `backend/src/routes/voice.js`, uncomment the ElevenLabs block and comment out the `twiml.say` line
- Set `PUBLIC_BASE_URL` in env (must be publicly reachable — your Render URL)
- Ensure `/tmp` audio files are being served via `/audio` static middleware
- Test call end-to-end with ElevenLabs voice

#### 7. Vapi.ai alternative (faster voice path)
- Create account at vapi.ai
- Create assistant, paste in the system prompt from `backend/src/prompts/system.js`
- Set server URL to `https://your-render-service.onrender.com/chat`
- Assign a phone number — no Twilio code changes needed

---

### Priority 3 — Data and catalog

#### 8. ACES/PIES import when MagnaFlow provides data
- Drop ACES XML into `data/aces.xml`
- Drop PIES XML into `data/pies.xml`
- Run: `cd backend && npm run import-aces`
- No schema changes required — bot immediately has full catalog

#### 9. Cloudflare KV page cache
- Fill in `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`, `CF_API_TOKEN` in env
- Run: `node scripts/cache-pages.js`
- Optionally wire `cache.js` into the chat route to serve cached product pages to Claude as additional context

---

### Priority 4 — Production hardening

#### 10. Replace in-memory sessions with Redis or Postgres
- `backend/src/routes/chat.js` and `voice.js` both use `new Map()` for session state
- This works for a single-instance demo but resets on every deploy and doesn't scale
- Replace with a Redis `SET`/`GET` with a 30-minute TTL, or a `sessions` table in Postgres

#### 11. Rate limiting
- Add `express-rate-limit` to the `/chat` route
- Reasonable demo limit: 30 requests/minute per IP

#### 12. Auth / embed token (if embedding on a client site)
- The `/chat` endpoint is currently open
- Add a shared secret header check or JWT if embedding on a public-facing site

#### 13. Error observability
- Add Sentry or equivalent to catch Claude API errors, DB timeouts, Twilio failures
- The current `console.error` fallbacks are sufficient for a demo but not production

#### 14. Streaming responses
- The current Claude call uses `client.messages.create` (blocking)
- For a snappier chat feel, switch to `client.messages.stream` and stream tokens to the frontend via SSE or WebSocket

---

### Priority 5 — UX polish

#### 15. Loading states and typing indicator
- `ChatWidget.jsx` shows `"..."` while loading — replace with an animated dots component

#### 16. Mobile embed / iframe packaging
- Wrap `ChatWidget` in a shadow DOM or iframe-ready bundle so it can be dropped onto any client site with one script tag

#### 17. Sound preference UI
- Add three buttons (Mild / Moderate / Aggressive) that appear after make/model is confirmed
- Pre-fills the answer so the customer doesn't have to type it

#### 18. Part comparison view
- When multiple SKUs are returned, show them side-by-side in `PartCard` with a "Compare" toggle

---

## Key Files Quick Reference

| File | Purpose |
|---|---|
| `backend/src/prompts/system.js` | Claude system prompt — edit qualification flow and tone here |
| `backend/src/db/schema.sql` | Database schema — authoritative structure |
| `backend/src/db/seed.js` | Demo data — add vehicles/parts/fitment here for the demo |
| `backend/src/services/fitment.js` | SQL query logic — tune vehicle matching here |
| `backend/src/services/claude.js` | Two-pass Claude orchestration — extraction + response |
| `frontend/src/components/ChatWidget.jsx` | Main chat UI — session, message loop, state |

## Claude Model

Uses `claude-sonnet-4-6` for both the extraction pass and the customer-facing response pass. The extraction pass is capped at 512 tokens (JSON only). The response pass is capped at 1024 tokens.

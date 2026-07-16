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
- `src/db/schema.sql` — PostgreSQL schema: `vehicles`, `parts`, `fitment`, `part_attributes`, `qualifiers`, `fitment_qualifiers`, `recommendation_log`
- `src/db/migrations/001_qualifiers_and_log.sql` — additive migration for the already-provisioned Render DB (schema.sql is CREATE TABLE-only and fails on existing tables — run this instead against a live install)
- `src/db/data/catalog.json` — catalog data (vehicles/parts/fitment/qualifiers/attributes) — `seed.js` loads from here, this is what you edit to add vehicles
- `src/db/seed.js` — loads `data/catalog.json` and idempotently upserts everything (safe to re-run)
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

### Verification (`qa/`)
Separate package (own `package.json` + Playwright dependency) so Chromium never has to ship with the customer-facing Render web service. This layer only checks catalog *data* against the live site — it never touches Claude or the chat pipeline.
- `qa/verify-fitment.js` — `verifyVehicle(...)` drives MagnaFlow's real "Shop by Vehicle" tool for one vehicle+qualifier combo and diffs the SKUs it lists against what we expect
- `qa/run-catalog-check.js` — offline batch check of the entire `catalog.json` against the live site; run with `npm run verify-catalog` (from `qa/`), writes a JSON mismatch report
- `qa/spot-check.js` — samples a few unchecked rows from `recommendation_log` (real customer recommendations) and verifies them against the live site; intended to run as its own scheduled job (e.g. a Render Cron Job), not inside the chat web service
- Not wired up yet: no Render Cron Job has been created for `spot-check.js`. Confirm Render plan/resources before scheduling it — see Priority 2 below.

### Conversational test suite (`backend/test/conversations/`)
Separate from `qa/` — this drives the real `chat()` pipeline directly (real Claude extraction + response calls, real Postgres lookup), asserting on the final SKUs. Built after two live bugs (markdown-fenced JSON breaking extraction, a qualifier answer overwriting the customer's stated trim) turned out to be invisible to `qa/`'s data-only checks, since both lived entirely in the conversation layer.
- `backend/test/conversations/cases.js` — scripted multi-turn conversations with expected/rejected SKUs, or `expectNoFitmentYet: true` for cases that should ask a clarifying question or decline cleanly
- `backend/test/conversations/run.js` — runner; from `backend/`: `npm run test:conversations` (or `npm run test:conversations "ram"` to filter by name substring while iterating)
- **Requires `ANTHROPIC_API_KEY` and `DATABASE_URL` in `backend/.env`** — it makes real Anthropic API calls (~2 per conversational turn) and writes to the live `recommendation_log` table (harmless, low-volume)
- 10/10 passing as of 2026-07-07, covering: Tacoma/F-150 golden paths, both Ram qualifier answers, a not-yet-answered qualifier, a vehicle not in the catalog, and trim-ambiguity for both a real fitment case (Camaro SS-only SKU) and a data-completeness case (Ram)

### Deployment fixes applied
- `frontend/package.json` — moved `vite` and `@vitejs/plugin-react` from `devDependencies` to `dependencies` (Vercel runs `npm install --production` and was missing the build tool)
- `vercel.json` — added at repo root with explicit `buildCommand`, `outputDirectory`, and `installCommand` pointing into `frontend/` so deployment config is in source control and not dependent on Vercel dashboard settings

### Bot behavior fixes applied
- `backend/src/prompts/system.js` — bot now opens with one broad "tell me about your vehicle" question and only follows up on missing fields, instead of asking year → make → model sequentially
- `backend/src/services/claude.js` — extraction pass now marks `ready: true` as soon as year + make + model are known; sound preference no longer blocks the fitment lookup (it is a post-lookup filter, not a pre-lookup requirement)

### Catalog expansion + fitment qualifiers (2026-07-07)
- Catalog grew from 10 vehicles / 4 parts to **88 vehicles / 65 parts / 154 fitment rows**, sourced by research agents reading real magnaflow.com product pages (not scraped/crawled — magnaflow.com disallows `/search` in robots.txt and the vehicle picker is JS-rendered) — covers Toyota (Tacoma/4Runner/Tundra), Ford (F-150/Super Duty/Bronco/Mustang), Chevy/GMC (Silverado/Sierra/Colorado/Canyon/Camaro), Jeep (Wrangler/Gladiator), Ram (1500/2500/3500), Dodge Challenger.
- Goal: a good-enough demo to secure the real ACES/PIES data feed from MagnaFlow — once that lands, catalog and qualifier coverage expand for free via `import-aces.js` with no schema changes.
- **Fitment qualifiers**: some fitment isn't determined by year/make/model/engine alone — e.g. Ram sold two structurally different Ram 1500 trucks in parallel for 2019-2023 (redesigned coil-spring "DT" body vs carryover leaf-spring "Classic" body), with different real SKUs for the same nominal vehicle. New `qualifiers` + `fitment_qualifiers` tables model this generically (ACES-style: qualifier type/value pairs attached at the fitment level). `fitment.js`'s `lookupParts()` now returns `{ matches, needsQualifier }` — if candidate parts disagree on an unanswered qualifier, it surfaces a clarifying question instead of guessing. `claude.js` and `system.js` were updated so the bot asks that question before presenting any parts. Only this one Ram case is seeded with real qualifier data (by design — not researched across the whole catalog since real ACES data will supersede it).
- `backend/src/db/data/catalog.json` is the new source of truth for seed data; `seed.js` was rewritten to load from it and upsert idempotently (safe to re-run, unlike the old array-index-based version).

### Extraction reliability fixes (2026-07-07)
Found via live testing, not code review — worth understanding before touching `claude.js` or `fitment.js` again:
- **The vehicle-extraction pass was silently broken since the original build.** It parsed Claude's response as raw JSON text, but Claude routinely wraps tool-style output in markdown code fences (` ```json ... ``` `), so `JSON.parse` failed on effectively every message with no logging — meaning the fitment DB was likely never actually consulted in production before this fix. Replaced with forced tool-use (`tool_choice: { type: 'tool', name: 'extract_vehicle_params' }`); the SDK returns an already-parsed object, eliminating this failure mode rather than patching around it.
- **Qualifier answers were overwriting the customer's already-stated trim.** Answering "it's the Classic" correctly set `qualifiers.rear_suspension` but also overwrote `submodel` from "Tradesman" to "Classic", breaking the DB match. Fixed via tighter tool-schema descriptions telling the model qualifier answers never belong in `submodel`/`model`.
- **Trim/body-style/drive-type/engine-config ambiguity when unspecified.** If the customer doesn't state one of these and it isn't pinned down, `lookupParts` now checks whether any candidate part fails to cover every value seen for that field — if so, everything is held back and the customer is asked, the same way an unanswered qualifier works. Confirmed via catalog analysis that this matters for real (2019 Camaro: SKU 19265 is SS-only) and not just for one seeded example. This deliberately costs an extra clarifying question in cases where the divergence is really just incomplete cross-linking in the demo seed data (e.g. Ram) rather than a genuine fitment difference — accepted trade-off, see `backend/test/conversations/cases.js` for the reasoning.
- **Make-name normalization.** Extraction returned `"Chevy"` while the catalog stores `"Chevrolet"`; the exact-match query silently returned zero rows. Tool schema now instructs the model to normalize to the manufacturer's full name.
- `lookupParts` also dedupes its `matches` by SKU — the same part can legitimately match through more than one fitment row (e.g. shared across trims), and should never be shown to the customer twice.

### Database
- Schema initialized and demo data seeded against Render Postgres (as of 2026-07-07)
- 88 vehicles, 65 parts, 154 fitment rows, 2 qualifiers (rear suspension: leaf/coil spring, Ram 1500 vs Classic)
- Verify after reseeding: `psql $DATABASE_URL -c "SELECT count(*) FROM fitment;"` → should return **154**

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

> **Running the conversational test suite locally** requires both `DATABASE_URL` and `ANTHROPIC_API_KEY` populated in `backend/.env` — see "Conversational test suite" under Completed above. Without `ANTHROPIC_API_KEY` set, `npm run test:conversations` fails immediately on the first real Claude call.

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
5. Verify: `psql $DATABASE_URL -c "SELECT count(*) FROM fitment;"` → should return **154**

> **Updating an already-provisioned DB:** `schema.sql` is CREATE TABLE-only and will fail with "relation already exists" if you re-run it against a DB that's already been initialized. To bring an existing install up to date with new tables (`qualifiers`, `fitment_qualifiers`, `recommendation_log`), run `psql $DATABASE_URL -f backend/src/db/migrations/001_qualifiers_and_log.sql` instead — it's additive and safe to re-run. Then `npm run seed` as usual (it's idempotent — safe to re-run any time `catalog.json` changes).

### 2. Render Web Service (backend)

1. render.com → **New → Web Service** → connect `V1-Brian/magnaflow-bot`
2. Settings:
   - **Root directory:** `backend`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
3. Add all env vars from `backend/.env.example` in the Render dashboard
4. Deploy — confirm: `GET https://your-service.onrender.com/health` returns `{"ok":true}`

> **Free tier cold start:** Render spins down after 15 min of inactivity. First request after idle takes ~30s. Fine for testing — upgrade to the $7/mo always-on tier before a live demo.

> **Twilio / ElevenLabs are voice-channel only.** They're not needed to get the web chat bot live. `TWILIO_*` and `ELEVENLABS_*` can stay blank until you tackle Priority 3 (voice channel) below — the chat flow works fully without them.

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

#### 0. Run the conversational test suite first
From `backend/` (with `DATABASE_URL` and `ANTHROPIC_API_KEY` in `.env`): `npm run test:conversations`. Catches extraction/qualifier bugs against real Claude + Postgres before you ever touch the live chat — cheaper and faster than manual round-tripping through the widget and Render logs. Add a case here any time a live bug turns up (see `backend/test/conversations/cases.js` for examples and reasoning).

#### 1. End-to-end smoke test
Run the three demo scenarios after deploying:
- 2019 Tacoma TRD Off-Road 3.5L, stock → SKU 19293 (and 19291 as alt)
- Same truck, mention a 3-inch lift → SKU 19583
- 2021 F-150 XLT 5.0L → SKU 19835

Test tip: open with the full vehicle description in one message — the bot should ask at most one follow-up before returning results.

#### 2. Qualifier smoke test
Ask about a "2021 Ram 1500 Tradesman 5.7L" — the bot should ask whether it's the redesigned Ram 1500 or a "Ram 1500 Classic" (leaf vs coil rear suspension) before giving a SKU, instead of guessing. This exercises the new `qualifiers`/`fitment_qualifiers` mechanism end-to-end.

#### 3. Run the offline catalog check
From `qa/`: `npm install && npm run verify-catalog` — drives MagnaFlow's real site for every vehicle/qualifier combo in `catalog.json` and reports any SKU mismatches. Playwright's first run needs Chromium installed (`postinstall` handles this). Selectors in `qa/verify-fitment.js` are a best-effort mapping of the site's flow — if a run errors out on a missing element, inspect the live site and adjust the locators there.

---

### Priority 2 — Wire up live spot-checks (optional)

`claude.js` already logs every resolved recommendation to `recommendation_log`. `qa/spot-check.js` samples a few unchecked rows and verifies them against the live site, but nothing calls it yet on a schedule.

- Add a Render Cron Job pointed at `node qa/spot-check.js` (its own build — `npm install` inside `qa/`, not the backend service) so Chromium never touches the customer-facing web service
- Confirm Render plan/resources can handle a scheduled Playwright run before enabling — do this deliberately, not as a side effect of another change

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
| `backend/src/services/claude.js` | Two-pass Claude orchestration — extraction + response, qualifier ambiguity handling |
| `backend/src/db/schema.sql` | Database schema — authoritative structure for a fresh install |
| `backend/src/db/migrations/001_qualifiers_and_log.sql` | Additive migration for the already-provisioned Render DB |
| `backend/src/db/data/catalog.json` | Catalog data — add vehicles/parts/fitment/qualifiers here, not in seed.js |
| `backend/src/db/seed.js` | Loads `data/catalog.json` into Postgres, idempotent |
| `backend/src/services/fitment.js` | SQL query logic — tune vehicle matching + qualifier resolution here |
| `frontend/src/components/ChatWidget.jsx` | Main chat UI — session, message loop, state |
| `vercel.json` | Vercel build config — routes to frontend/, do not move or delete |
| `qa/verify-fitment.js` | Playwright check of one vehicle against the live MagnaFlow site |
| `qa/run-catalog-check.js` | Offline batch verification of the whole catalog — run after catalog changes |
| `qa/spot-check.js` | Samples `recommendation_log` for live spot-checks — not yet on a schedule |
| `backend/test/conversations/cases.js` | Scripted multi-turn conversations + expected SKUs — add a case here after any live bug |
| `backend/test/conversations/run.js` | Runs the conversational suite against the real Claude + Postgres pipeline |

## Claude Model

Uses `claude-sonnet-4-6` for both the extraction pass and the customer-facing response pass. The extraction pass is capped at 512 tokens (JSON only). The response pass is capped at 1024 tokens.

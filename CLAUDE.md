# MagnaFlow Parts Bot — Project Handoff

## What This Is

A chat + voice bot that qualifies a customer's vehicle (year/make/model/engine/submodel/lift) and returns the exact MagnaFlow SKU, price, sound level, install difficulty, and product link. Built for demo against a seeded slice of the catalog. Schema is ACES/PIES-ready — a full data drop requires no structural changes.

**Current state is fitment lookup, not AI-native.** The bot today is a conversational wrapper around a structured DB query — a customer could get the same result from magnaflow.com's own vehicle picker. See [`AI_FEATURES_ROADMAP.md`](./AI_FEATURES_ROADMAP.md) for a set of scoped feature ideas (VIN/photo vehicle ID, sound-clip matching, compliance concierge, fitment confidence transparency, etc.) that would use vision/reasoning/synthesis in ways a static site structurally can't — pick one up from a fresh session and spec it out from there.

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
- 11/11 passing as of 2026-07-21, covering: Tacoma/F-150 golden paths, both Ram qualifier answers, a not-yet-answered qualifier, a vehicle not in the catalog, trim-ambiguity for both a real fitment case (Camaro SS-only SKU) and a data-completeness case (Ram), and the lift-status regression case (see below)

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

### Chat UX fixes (2026-07-17)
- Bot replies were raw text in a plain `<div>` — Claude's markdown (`**bold**`, `-` lists) rendered as literal asterisks with no line breaks. `frontend/src/components/MessageBubble.jsx` now renders through `react-markdown`.
- Fitment-clarifying questions are only presented as clickable buttons (`frontend/src/components/OptionButtons.jsx`) when they're a genuine fitment **qualifier** (e.g. Ram 1500 leaf vs. coil rear suspension) — something the customer often can't name unprompted. Vehicle-identifying ambiguity (trim, body style, drive type, engine config — things the customer already knows about their own vehicle) is left as a normal typed follow-up, no buttons. `lookupParts()` in `fitment.js` now tags each pending `needsQualifier` entry with `kind: 'qualifier' | 'vehicle_field'`; `claude.js` only turns `kind: 'qualifier'` entries into `clarifyingOptions`.
- If more than one detail is unresolved at once, only the first (`needsQualifier[0]`) is asked about per turn — both in the hidden prompt sent to Claude and in what's exposed to the frontend — instead of merging multiple questions into one confusing prompt with a mixed button list.
- `backend/src/routes/chat.js` and `chat()` in `claude.js` now return `clarifyingOptions` alongside `reply`/`fitmentResults`.
- Returned parts (`fitmentResults`) were kept in separate `lastFitment` state in `ChatWidget.jsx`, always rendered after the *entire* message list — so they stayed pinned below all messages instead of scrolling away with the turn that returned them. Parts are now attached to the specific assistant message (`message.parts`) and rendered inline right after that bubble.
- The open-ended follow-up questions (engine size, trim, lifted/stock, catalytic-converter fields) had no rule against bundling several into one message. `system.js` now explicitly says to ask about only one missing detail per turn — this is prompt-only (Claude's judgment, not enforced in code), so verify it holds with the conversational test suite or a live multi-field vehicle before relying on it.

### Extraction reliability fixes (2026-07-07)
Found via live testing, not code review — worth understanding before touching `claude.js` or `fitment.js` again:
- **The vehicle-extraction pass was silently broken since the original build.** It parsed Claude's response as raw JSON text, but Claude routinely wraps tool-style output in markdown code fences (` ```json ... ``` `), so `JSON.parse` failed on effectively every message with no logging — meaning the fitment DB was likely never actually consulted in production before this fix. Replaced with forced tool-use (`tool_choice: { type: 'tool', name: 'extract_vehicle_params' }`); the SDK returns an already-parsed object, eliminating this failure mode rather than patching around it.
- **Qualifier answers were overwriting the customer's already-stated trim.** Answering "it's the Classic" correctly set `qualifiers.rear_suspension` but also overwrote `submodel` from "Tradesman" to "Classic", breaking the DB match. Fixed via tighter tool-schema descriptions telling the model qualifier answers never belong in `submodel`/`model`.
- **Trim/body-style/drive-type/engine-config ambiguity when unspecified.** If the customer doesn't state one of these and it isn't pinned down, `lookupParts` now checks whether any candidate part fails to cover every value seen for that field — if so, everything is held back and the customer is asked, the same way an unanswered qualifier works. Confirmed via catalog analysis that this matters for real (2019 Camaro: SKU 19265 is SS-only) and not just for one seeded example. This deliberately costs an extra clarifying question in cases where the divergence is really just incomplete cross-linking in the demo seed data (e.g. Ram) rather than a genuine fitment difference — accepted trade-off, see `backend/test/conversations/cases.js` for the reasoning.
- **Make-name normalization.** Extraction returned `"Chevy"` while the catalog stores `"Chevrolet"`; the exact-match query silently returned zero rows. Tool schema now instructs the model to normalize to the manufacturer's full name.
- `lookupParts` also dedupes its `matches` by SKU — the same part can legitimately match through more than one fitment row (e.g. shared across trims), and should never be shown to the customer twice.

### Lift-status text/data inconsistency fix (2026-07-21)
Live bug report: asking about a 2022 Jeep Wrangler 6.4L, the bot asked "stock height or lifted?" while `fitmentResults` had already come back with both SKUs (19582, 19598) — a text/data contradiction, not a wrong-SKU risk (both parts are correct regardless of lift status). Root cause: `system.js` phrased lift-status as a blocking pre-lookup question while the code had never actually gated on it (lift, like sound preference, is a post-lookup filter). Fixed by aligning the wording. Regression case added to `backend/test/conversations/cases.js` (the Jeep Wrangler 392 case).

### Simulated-customer test harness (2026-07-21)
The conversational suite above only asserts on final SKUs — it didn't catch the lift-status bug above because the SKUs themselves were correct; the bug was purely in the bot's prose contradicting its own data. To catch this class of bug, `backend/test/simulated-customers/` adds an LLM-plays-customer + LLM-judge harness: a customer persona (`scenarios.js`) improvises naturally through the real `chat()` pipeline (not a fixed script), and a separate forced-tool-use judge call grades the full transcript against a rubric (text/data consistency, one-question-at-a-time, qualifier-button correctness, fabrication, correct SKUs, tone/competitor-avoidance).
- Run via `npm run test:simulated` from `backend/` (optionally filtered by name substring, same as `test:conversations`). Requires `ANTHROPIC_API_KEY` + `DATABASE_URL`.
- **Deliberately not run on every commit or as part of CI** — it's ~2-3x the API cost of the conversational suite (customer-simulator calls + judge calls on top of the normal extraction/response calls) and takes 15-25 minutes for the full 10-scenario set. Run it after any change to `system.js`, `claude.js`'s extraction schema, or `fitment.js`'s matching logic — that's where every bug below was found.
- **Judges can hallucinate** — confirmed directly (a judge once claimed the bot bundled two questions in a turn that, re-read verbatim, only asked one). `run.js`'s `verifyIssueQuotes()` requires every judge-reported issue to include a verbatim quote and cross-checks it against the actual transcript text, tagging anything unverifiable as `[UNVERIFIED QUOTE — possible judge hallucination]` rather than trusting judge prose at face value. Always re-read the real transcript before treating a judge finding as a confirmed bug — several were not (see below).
- The judge's `noFabrication` check is calibrated against `system.js`'s own sanctioned sound-level/install-difficulty translation phrases (fed into the judge prompt directly), and its `toneAppropriate` check is told explicitly that MagnaFlow is the bot's own brand, not a competitor — both were sources of false-positive findings before being fixed.

**Real bugs found and fixed via 5 iterative rounds of full-suite runs** (each finding was cross-checked against the actual catalog/SQL/transcript before being treated as real — several judge findings turned out to be scenario-ground-truth mistakes or harness artifacts instead, see below):
- **Fabrication on empty lookups (most severe).** `getFitmentContext` in `claude.js` returned `null` for two different situations — "still gathering info" and "confirmed zero matches" — and `chat()` couldn't tell them apart, so a genuinely empty lookup gave the response pass no signal at all. Claude would sometimes invent a full fake SKU/price/product URL instead of saying "no match," directly contradicting the system prompt's own "never guess" rule. Fixed by having `getFitmentContext` return an explicit `noMatchFound` flag and injecting a system note forbidding invention whenever it's true.
- **Submodel/model corruption from qualifier-style answers.** When a customer's only stated detail was an answer to a qualifier question (e.g. "it's the Classic"), extraction wrote that word into `submodel` (and, in one regression, `model`) even though no real trim had ever been stated — breaking the exact-match query against the catalog's actual value ("Tradesman") even after the real qualifier was answered correctly. This recurred **twice** in `model` specifically despite explicit prompt guidance, because Claude's own automotive world-knowledge ("Ram 1500 Classic" is a real, well-known nameplate) kept overriding generic instructions — a general "don't overwrite" rule wasn't enough; only a forceful, named prohibition ("never write `model: \"1500 Classic\"`, no matter how confident you are") stopped it. Lesson for future extraction-schema edits: assume the model's real-world knowledge will fight generic normalization instructions, and be prepared to name the specific wrong value explicitly.
- **Generation/chassis-code confusion.** The bot asked "is it a JK, JL, or JT?" (Jeep Wrangler generation codes, not trim names) and extraction stored the answer as `submodel`, which never matches the catalog's real trim strings ("Rubicon 392"). Fixed by telling the bot to ask for the trim instead, and telling extraction those codes aren't trims.
- **"F-250"/"Rubicon" false negatives.** Customers naturally say "F-250" or "Rubicon" while the catalog stores the fuller official name ("F-250 Super Duty", "Rubicon 392"). First attempted as an extraction-prompt normalization rule — this is what caused the model-corruption regression above (a "normalize to the fuller name" instruction generalizes dangerously well to "1500 Classic" too). The safe fix ended up split: `submodel` normalization stayed in the extraction prompt (narrowly scoped to "append 392 once the engine is known as 6.4L", which doesn't generalize the same way), while `model` matching moved to the SQL layer instead (`fitment.js` now does a prefix match on `model`, not exact). **Verified safe before implementing** — dumped every distinct `model`/`submodel` value in the catalog and checked for prefix collisions; `model` has none, but `submodel` does (e.g. "Rubicon" is a prefix of "Rubicon 392" *and* a real, different vehicle in its own right — a 3.6L V6 Rubicon genuinely exists — so prefix-matching submodel would conflate two different engines' parts and was correctly avoided).
- **Readiness gate too coarse.** `ready` only requires year+make+model, so a lookup could come back empty simply because engine wasn't known yet (not because the vehicle doesn't exist), and the new `noMatchFound` signal was firing prematurely. Fixed by requiring `engineLiters` to be known before declaring a confident "no match."
- **Withholding results generalized beyond lift/sound.** The original lift-status fix only covered lift and sound preference explicitly; the same bug recurred for engine ("I have a match, but I need one more detail first" while `fitmentResults` was already populated). Generalized the system.js rule to cover any field, not just those two.
- **Fabricated escalation contact info.** The bot has no real phone number or contact channel anywhere in its data, but the prompt said "offer to escalate to a human advisor" with nothing concrete to point to — so it invented phone numbers (once a nonsensical "1-800-regardless"). Fixed by telling it explicitly it has no real contact info and to point to MagnaFlow's own website generically instead of inventing a number.
- **Invented excuses for limitations.** When declining to show a part, the bot sometimes invented a specific-sounding reason ("probably a cab/bed configuration gap," "there may be options my system isn't showing") rather than admitting it doesn't know why. Added an explicit rule against this.

**Two of my own scenario-design mistakes, corrected** (worth noting so future scenario authors don't repeat them): one scenario's `expectSkus` included SKU 19206 for a cat-back-specific request — 19206 is a real match for that vehicle, but it's an axle-back product, so its absence was correct, not a bug. Another's `rejectSkus` included a SKU that was genuinely correct for the customer's own (later self-corrected) initial engine statement — showing it before the correction was right, not a bug. Both are reminders to check ground truth against the actual catalog fields (not just "does this SKU exist for this vehicle") before trusting a judge failure.

**Known residual limitations, not fully solved this session** (real but lower-severity than the above — none of them produce a *wrong* SKU, the worst outcomes are an unnecessary "no match" or an embellished sound description):
- **Sound/spec embellishment.** Despite an explicit "only state what's in the data" rule, Claude still occasionally adds unsupported editorial color (e.g. "no drone, no obnoxious startup bark," comparative "more refined tone" between two products with the identical `sound_level` value). Tried multiple rounds of prompt tightening with diminishing returns — this looks like an inherent tendency to elaborate helpfully rather than a fixable prompt gap. Lower risk than a wrong SKU, but worth another look if a client flags it.
- **Extraction non-determinism across turns.** Since extraction re-runs fresh from the full conversation history every turn, it can occasionally give a different answer for unchanged context — observed as a transient false "no match" that flips back to a correct match one turn later with no new customer input. Doesn't produce a wrong SKU (worst case: a customer is confusingly told "no match," then immediately corrected), but is a trust/UX wrinkle. A real fix would mean caching the last confirmed match per conversation rather than trusting a fresh extraction every turn — not attempted this session.
- **Bare ambiguous model names** (e.g. a customer saying just "Super Duty" without specifying F-250 vs. F-350) have no disambiguation path — `model` isn't one of `fitment.js`'s `AMBIGUITY_DIMENSIONS` (only submodel/body_style/drive_type/engine_config are), so an unresolvable model-level ambiguity currently just returns zero rows rather than prompting a clarifying question. Fails safe (no wrong part shown) but could ask for retrieval a step earlier.
- Occasional two-question bundling still slips through despite the explicit one-at-a-time rule, most often "here's your part... also, stock or lifted?" appended in the same turn as a result. Same category as sound embellishment — prompt-adherence, not a code bug.

### Catalog verification against the live site (2026-07-21)
`qa/verify-fitment.js` was originally written blind (selectors never validated against the live DOM) — running it for real turned up both a genuine catalog error and a string of tool bugs. Full batch now passes **82/83 (98.8%)** against the live site.
- **Real catalog error found and fixed:** SKU 19835 (one of the three original "golden path" demo SKUs) was linked to a `body_style: "SuperCrew"` 2021 F-150, but MagnaFlow's own product page explicitly and repeatedly states it's engineered specifically for regular-cab trucks, and it never appeared in the site's own results for any other cab/trim combination. Corrected to `"Regular Cab"` and reseeded. This one had been sitting in CLAUDE.md's smoke-test doc, the conversational test suite, and the live catalog since before this session — a good example of why live verification matters even for "obviously fine" original data.
- **The site's vehicle picker is a custom multi-step `<vehicle-menu>` accordion**, not plain `<select>` inputs — year → make → model → engine → part type → then a variable set of additional fields depending on the vehicle (body type + bed length for trucks, trim for others). The final "Shop By Vehicle" submit link only enables once every field, including dynamically-added ones, has a value.
- **Tool bugs found and fixed along the way** (all in `qa/verify-fitment.js`): `String(5.0) === "5"` in JS silently turned engine search text into "5L", which is a substring of "V6 3.5L" — collapsing to a wrong-engine test entirely. The same substring-matching risk applied to model ("1500" ⊂ "1500 Classic") and trim ("XL" ⊂ "XLT") — switched to exact (trimmed) text matching throughout. HD trucks are formatted with a space on the site ("Silverado 2500 HD") vs. our catalog's "Silverado 2500HD". Not every product's URL slug encodes engine displacement (some are named generically) — requiring it wrongly excluded real matches. Two separate timing races where a dynamically-rendered field (part-type options, a second required field appearing only after trim selection) wasn't actively waited for, causing false "nothing here" results.
- **One remaining "mismatch" is confirmed not a catalog error:** SKU 15092 (2012 Camaro SS 6.2L axle-back) — its own product page confirms the fitment is genuine, but it appears sold out/discontinued on the live site and so doesn't surface in the active browse collection. An inventory/availability question, not a wrong-fitment risk.
- The results page always shows every engine's products together for a given year/make/model (confirmed empirically — it doesn't filter by engine at all), so the tool's `unexpected` field is informational only (possible completeness gaps worth a manual look) and never fails the match on its own — only a genuinely `missing` expected SKU does, since that's the actual safety-critical question ("does this SKU we'd recommend really exist for this vehicle").

### Part-type UX pass (2026-07-23)
Prompted by a client-review question about two SKUs on a 2021 Wrangler Rubicon (19620, 19592) sharing the "Overland Series" name — confirmed against the live site as a genuine cat-back/axle-back pair, not a duplicate, but the bot wasn't explaining that distinction on its own.
- **Opening message now invites a part-type preference alongside vehicle details**, formatted as separate short lines instead of one dense sentence (`backend/src/prompts/system.js`). Still a single opening message — the existing "one detail per follow-up" rule applies only to later turns, not this initial invitation. `partType` extraction and SQL filtering (`fitment.js`) already existed before this; this just invites the customer to state it up front instead of only capturing it if mentioned unprompted.
- **Duplicate-looking parts now get their distinction called out first.** When multiple matches share a series name (or could otherwise read as duplicates), `system.js` now tells the bot to lead with what's actually different — part type (cat-back vs. axle-back) before sound/price. Verified on 3 live reruns of the Wrangler Rubicon case.
- **Decided against a proactive "want me to narrow this down?" follow-up** after showing multiple part types — matches the existing show-everything-by-default philosophy (same pattern as sound preference). `system.js` has an explicit rule against asking this.
- **New: part-type dead-end fix.** Inviting a part-type preference up front surfaced a real gap: if a customer asks for a type that doesn't exist for their exact vehicle (e.g. "axle-back" for a 2019 Tacoma TRD Off-Road, which only has cat-back in the catalog), the bot previously said "no confirmed match, contact a human advisor" — misleading, since matching parts exist just under a different type. `lookupParts()` in `fitment.js` now re-queries without the `partType` filter when the filtered query returns zero matches (and no qualifier is pending), returning `otherPartTypeMatches` if the vehicle matches something else. `claude.js` and `system.js` were updated so the bot says so plainly and offers to show what IS available (part type/series only, no price/SKU/link) rather than dead-ending — only presents full details if the customer says yes.
- Conversational test suite re-run after all of the above: 11/11 passing, no regressions.
- **Confirmed, not a bug:** the seeded catalog has zero catalytic converter parts (`direct-fit-cat`/`universal-cat`) despite the extraction schema and system prompt actively asking about CARB/EFN/state-of-registration details for them — 65 parts break down as 49 cat-back / 10 axle-back / 6 replacement-exhaust only. A customer asking specifically for a catalytic converter will always dead-end today. Worth flagging to the client before they test that path live.

### VIN photo vehicle ID (2026-07-21)
First AI-native feature from `AI_FEATURES_ROADMAP.md` (#1) — a customer can photograph their VIN plate instead of typing year/make/model/engine.
- **New: `backend/src/services/vin.js`** — `readVinFromImage()` uses Claude vision (forced tool-use, same pattern as `EXTRACT_VEHICLE_PARAMS_TOOL` in `claude.js`) to read the 17-character VIN off a photo; validated server-side against the ISO 3779 format (`/^[A-HJ-NPR-Z0-9]{17}$/`, excludes I/O/Q) before trusting it. `decodeVin()` calls NHTSA's free, keyless vPIC API (`vpic.nhtsa.gov/api/vehicles/DecodeVinValuesExtended`) — the authoritative US VIN registry — rather than asking Claude to recall VIN-decode tables from training data.
- **Deliberately does not trust NHTSA's trim/Series field**, even when present — it isn't guaranteed to match our catalog's `submodel` naming, and per the client's explicit feedback trim should never be guessed. `buildVinSummaryMessage()` only includes year/make/model/engine/drive type/body style. This means the existing trim-ambiguity qualifier flow (Ram Classic, Camaro SS/ZL1) still runs exactly as before whenever trim actually matters — VIN scanning is additive, not a bypass.
- **Zero changes to `claude.js`/`fitment.js`.** The decoded facts are converted into one natural-language sentence (e.g. *"I scanned my VIN — it decoded to: 2021 RAM 1500, 5.7L V8, 4WD, Crew Cab."*) and passed into the existing `chat(history, userMessage)` exactly like typed text — extraction, fitment lookup, and the one-at-a-time qualifier/vehicle-field follow-up logic all apply unchanged.
- **New route: `POST /chat/vin-photo`** in `backend/src/routes/chat.js`, sharing the same in-memory `sessions` Map as `POST /chat`. Body is `{ sessionId, imageBase64, imageMediaType }` (JSON, not multipart — no new dependency needed since `node-fetch` was already present for the NHTSA call). Bumped `express.json()`'s limit to `8mb` in `index.js` to fit a base64-encoded photo.
- Unreadable photo or failed NHTSA decode both fail gracefully with a friendly retry/type-instead message, without touching session history or burning a full `chat()` call.
- **New: `frontend/src/components/VinPhotoButton.jsx`** — mirrors `VoiceButton.jsx`'s existing pattern (single callback prop, `useState` busy flag, same inline-style shape); triggers a hidden `<input type="file" accept="image/*" capture="environment">`.
- `ChatWidget.jsx` downscales the photo client-side via canvas (max 1600px, JPEG quality 0.8) before base64-encoding, shows the photo as a thumbnail in the user's chat bubble via a new `imageDataUrl` prop on `MessageBubble.jsx`, and reuses the same qualifier-button/part-card rendering as a normal turn.
- **Verified:** field-mapping logic unit-tested against a hard-coded sample NHTSA response (confirms trim omission, "Not Applicable"/slash-synonym cleanup, and null-summary fallback for a garbage decode); frontend wiring verified end-to-end with a mock backend + headless Chromium (photo select → thumbnail render → qualifier buttons → click → normal `/chat` flow).
- **Not verified in-session** (flagging honestly): real Claude vision OCR accuracy on an actual VIN photo (no `ANTHROPIC_API_KEY` configured locally this session) and a live call to `vpic.nhtsa.gov` (DNS blocked from this sandboxed dev environment specifically — general internet worked fine, so this is very likely a sandbox allowlist limitation, not a real outage). **Do one live end-to-end test with a real VIN photo through the deployed Render backend before relying on this in a demo.**

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

### Priority 0 — Before the client demo (do this first)

Everything below came out of the most recent round of changes (VIN photo
scan, one-at-a-time follow-up questions, qualifier-vs-vehicle-field button
split) — none of it has been verified against real Claude or a real
deployment yet, only against mocked responses in a sandboxed dev
environment that had no `ANTHROPIC_API_KEY` and couldn't reach
`vpic.nhtsa.gov` at all.

1. **Test the VIN photo scan feature with a real phone photo** through the
   live deployed app. This is the newest and least-verified part of the
   demo — confirm Claude's vision call actually reads a real VIN plate
   accurately, and that the NHTSA decode call succeeds (this specific
   network path has never actually been exercised, only code-reviewed).
2. ~~Re-run the smoke tests below (Priority 1, items 1–2) live~~ — **done
   2026-07-21** via the new `backend/test/simulated-customers/` harness (5
   rounds of real-Claude runs, not mocks). Qualifier-button correctness now
   holds reliably. One-question-at-a-time mostly holds but still slips
   occasionally (e.g. "here's your part... also, stock or lifted?" in one
   message) — see "Simulated-customer test harness" under Completed for the
   full list of what was found and fixed vs. what remains a known,
   lower-severity residual limitation.
3. **Run the conversational test suite** (Priority 1, item 0 below) —
   fastest way to catch a regression across all of the above before
   clicking through it live by hand. Needs `ANTHROPIC_API_KEY` added to
   `backend/.env` in addition to `DATABASE_URL`. 11/11 passing as of
   2026-07-21.
4. **Confirm the Render web service isn't still on the free tier**, or
   send it a warm-up request ~1 minute before the client joins. Free tier
   spins down after 15 minutes idle — a client's first message could
   otherwise sit for ~30 seconds looking broken.

Once these pass, continue with the rest of Priority 1 below as time
allows — none of it is as urgent as the four items above.

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
From `qa/`: `npm install && npm run verify-catalog` — drives MagnaFlow's real site for every vehicle/qualifier combo in `catalog.json` and reports any SKU mismatches. Playwright's first run needs Chromium installed (`postinstall` handles this). Validated end-to-end on 2026-07-21 (82/83 passing, see "Catalog verification against the live site" under Completed) — if a future run errors out, it's more likely the site changed than the tool being fundamentally wrong; check the specific error against the live site before assuming a deep rewrite is needed.
- **Politeness:** runs at 8s between requests (`REQUEST_DELAY_MS` in `run-catalog-check.js`) — a full 83-case run takes ~35-45 minutes. This is a real, deliberate delay after empirically triggering rate limiting/bot detection at 2s that silently returned empty results partway through a run. Don't lower it without re-testing a full batch.
- **Don't run this on a machine that might sleep mid-run** — a suspended network connection mid-request throws (usually recoverable, the runner catches per-case errors and continues, but you'll want to re-check whichever case failed).

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
| `AI_FEATURES_ROADMAP.md` | Scoped ideas for AI-native features beyond fitment lookup — start here for the next big feature push |
| `backend/src/services/vin.js` | VIN photo → Claude vision OCR → NHTSA decode → natural-language summary fed into the normal chat pipeline |
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
| `backend/test/simulated-customers/scenarios.js` | LLM-customer personas + ground truth for the deeper conversational-quality harness |
| `backend/test/simulated-customers/run.js` | Runs customer-simulator + real chat() + LLM judge; expensive, not run on every commit — see write-up above |

## Claude Model

Uses `claude-sonnet-4-6` for both the extraction pass and the customer-facing response pass. The extraction pass is capped at 512 tokens (JSON only). The response pass is capped at 1024 tokens.

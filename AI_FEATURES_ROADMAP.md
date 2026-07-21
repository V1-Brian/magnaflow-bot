# AI Feature Roadmap — Beyond Fitment Lookup

## Why this doc exists

The bot as built (through 2026-07-17) is a conversational wrapper around a
structured fitment query: extract year/make/model/engine, run a `WHERE`
clause, return a SKU. That's a real UX improvement over a dropdown-based
"shop by vehicle" tool, but a customer can replicate the same result by
going directly to magnaflow.com and using the vehicle picker. Nothing in
the current build does something a form and a database *couldn't* do.

The ideas below are aimed specifically at the gap: places where an LLM's
actual capabilities — reading unstructured/ambiguous input (photos, VINs,
audio), synthesizing scattered expertise, reasoning about confidence and
trust instead of returning a binary yes/no — solve a real aftermarket
purchasing pain point that a static site structurally cannot. Pick one,
open a new session, and spec it out in detail from here.

---

## 1. Kill vehicle ambiguity at the source — vision, not follow-up questions

The qualifier/trim-disambiguation system (Ram 1500 vs. Classic, Camaro SS
vs. ZL1) exists because customers often can't accurately self-report their
own vehicle. That's more directly solvable than asking better questions.

- **✅ Shipped (2026-07-21): VIN photo → decode.** Customer photographs the
  VIN plate; Claude vision reads the 17-character VIN, NHTSA's free vPIC
  API decodes it to year/make/model/engine/drive type/body style, and the
  result feeds into the *same* chat/fitment/qualifier pipeline as typed
  text — no new code path through extraction or fitment. Trim/submodel is
  deliberately **not** pulled from the VIN decode (NHTSA's Series/Trim
  field isn't guaranteed to match our catalog's naming, and the client
  confirmed trim should never be guessed) — so the existing trim-ambiguity
  follow-up still runs whenever it matters. See `backend/src/services/vin.js`
  and the "VIN photo vehicle ID" entry in `CLAUDE.md` for the full
  implementation writeup, including what's verified vs. what still needs a
  live end-to-end test with a real photo before a demo.
- **Photo-based trim/badge recognition** as a fallback when there's no VIN
  handy — distinguishing trims by exterior cues, or identifying an
  already-installed aftermarket exhaust from tip shape so the bot doesn't
  recommend a duplicate axle-back on top of one.
- **Emissions sticker OCR.** The EFN/executive order number and emissions
  standard live on an under-hood sticker nobody memorizes. Photograph it;
  read it automatically instead of asking the customer to recall a code
  under time pressure.
- **Feasibility:** High. Claude's vision capability is already available
  on the same API key this project uses — no new vendor. VIN decoding
  needs a lookup step (NHTSA vPIC API is free; manufacturer-specific
  tables may be needed for full trim/engine granularity).

## 2. Sound as a matchable thing, not a 3-word label

"Mild / moderate / aggressive" is a website filter with adjectives. What a
customer actually wants is "make it sound like *that*."

- **Reference-clip matching.** Customer pastes a YouTube link or describes
  a car they've heard ("I want it to sound like my buddy's Mustang GT").
  Match against a library of the manufacturer's own dyno/drive-by demo
  clips via audio embeddings — turning "aggressive" into "closest real
  match to what you're picturing," not a static label.
- **Drone/resonance warnings tied to the specific chassis.** Certain
  vehicle+exhaust combos are notorious for highway-speed cabin drone — a
  real, frequently-complained-about issue that generic sound labels never
  surface. Synthesizing that from owner forums/reviews into "heads up:
  this combo drones at ~2200 RPM on the highway" is genuine expertise, and
  the kind of thing that prevents returns.
- **Feasibility:** Medium-high. Needs an audio corpus (manufacturer demo
  clips are usually public) and an embedding/similarity step. Generative
  audio synthesis of an *approximate* exhaust note was considered and
  rejected as a v1 idea — real acoustic accuracy is unlikely to be
  trustworthy; matching against real recorded clips is the more honest
  version of "sound identity."

## 3. Tribal knowledge synthesis

The actual pain point in aftermarket installs often isn't "which SKU
fits" — it's "what am I about to discover halfway through that nobody
warned me about." E.g. "on this generation Tacoma you have to drop the
spare tire to reach the rear hanger bolt." That knowledge exists, scattered
across forum threads and YouTube comments, for most popular vehicle+part
combos.

- Synthesize it into one tailored install brief per SKU+vehicle: tools
  needed, a real time estimate, the one gotcha that trips people up —
  instead of a boilerplate "bolt-on, ~1 hour" every catalog already says.
- **Feasibility:** Medium. Needs a sourcing/ingestion strategy for forum
  and video-comment content (scraping/licensing questions apply) — this is
  the most research-heavy option here.

## 4. Confidence transparency instead of a binary answer

The catalog is admittedly partial (88 vehicles, research-sourced from live
product pages, not a full ACES/PIES data drop yet). Right now the bot
presents every match with equal, false certainty.

- Surface fitment provenance to the customer: "manufacturer-confirmed fit"
  vs. "inferred from a broader match — worth double-checking your fitment
  guide before ordering." Turns an honest data gap into a trust-building
  feature instead of a liability, precisely because most sites hide this
  uncertainty entirely.
- **Feasibility:** Low effort, high value. `catalog.json` already has the
  structural hooks (which rows came from real product-page research vs.
  broader inference) — this is mostly a data-tagging + prompt change, not
  new infrastructure.

## 5. Compliance concierge, proactively — not reactively asked

Catalytic converter law is genuinely confusing: Federal EPA vs. CARB, and
the list of CARB-adopting states keeps growing (CO, WA, NY, ME, etc.).

- Instead of collecting "what state are you in, what's your EFN" as form
  fields, proactively explain *why* it matters and what happens if it's
  gotten wrong (fix-it ticket, failed smog check, a shop refusing
  installation) — delivering actual expertise, not just gating a lookup.
- **Feasibility:** Medium. Mostly a system-prompt / knowledge-base
  addition (state-by-state CARB adoption status), no new architecture.

## 6. Post-purchase companion, not a one-and-done lookup

The highest-leverage pain point may not even be at purchase time — it's
"check engine light came on after I installed this."

- A P0420 code paired with "which exact part did this customer buy" (via
  `recommendation_log`) is enough for the same chat to do real diagnostic
  reasoning (loose connection vs. wrong-spec O2 sensor placement vs. needs
  a spacer) instead of the relationship ending at checkout.
- **Feasibility:** Medium. Needs a way to re-identify the customer/order
  in a later session (currently sessions are ephemeral, see Priority 4 in
  `CLAUDE.md`) and a troubleshooting knowledge base per common part type.

---

## Suggested build order (impact × feasibility)

1. ~~**VIN-photo decode**~~ (#1) — ✅ shipped 2026-07-21. **Emissions-sticker
   OCR (still open)** — same #1 idea, same photo-capture pattern, not yet
   built: reads the EFN/executive-order number and emissions standard off
   an under-hood sticker instead of asking the customer to recall it.
2. **Confidence transparency** (#4) — nearly free, mostly a data-tagging
   and prompt change against data already in `catalog.json`.
3. **Compliance concierge** (#5) — mostly a knowledge/prompt addition.
4. **Sound-clip matching** (#2) — high customer-visible differentiation,
   needs an audio corpus + embedding pipeline.
5. **Tribal knowledge synthesis** (#3) — most research-heavy, needs a
   content-sourcing strategy.
6. **Post-purchase companion** (#6) — valuable but depends on solving
   session/identity persistence first (see Priority 4 in `CLAUDE.md`).

Pick one, start a new session, and spec the data model / API surface /
prompt changes needed before writing code.

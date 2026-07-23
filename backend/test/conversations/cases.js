// Each case scripts a realistic multi-turn conversation through the real chat()
// pipeline (real Claude extraction + response calls, real Postgres lookup) and
// asserts on the final fitmentResults. This is what catches bugs living between
// "customer typed a sentence" and "structured params came out of extraction" —
// the qa/ Playwright harness only checks catalog data against the live site and
// never exercises this layer at all.
export const CASES = [
  {
    name: 'Tacoma TRD Off-Road, stock',
    turns: ['I have a 2019 Toyota Tacoma TRD Off-Road with the 3.5L V6, totally stock.'],
    expectSkus: ['19293', '19291'],
  },
  {
    name: 'Tacoma TRD Pro, lifted',
    turns: ['2019 Toyota Tacoma TRD Pro, 3.5L V6, I have a 3 inch lift on it.'],
    expectSkus: ['19583'],
  },
  {
    name: 'F-150 XLT 5.0L',
    turns: ['2021 Ford F-150 XLT with the 5.0L V8'],
    expectSkus: ['19835'],
  },
  {
    name: 'Ram 1500 Tradesman — answers "Classic"',
    turns: [
      '2021 Ram 1500 Tradesman, 5.7L HEMI',
      "It's the Ram 1500 Classic — the older body style with leaf springs in the back.",
    ],
    expectSkus: ['15363'],
    rejectSkus: ['19430', '19429'],
  },
  {
    name: 'Ram 1500 Tradesman — answers "redesigned"',
    turns: [
      '2021 Ram 1500 Tradesman, 5.7L HEMI',
      "It's the newer redesigned Ram 1500, not the Classic — coil springs in the back.",
    ],
    expectSkus: ['19430'],
    rejectSkus: ['15363'],
  },
  {
    name: 'Ram 1500 Tradesman — qualifier not yet answered, should not guess',
    turns: ['2021 Ram 1500 Tradesman, 5.7L HEMI'],
    expectNoFitmentYet: true,
  },
  {
    name: 'Vehicle not in catalog — should decline cleanly, not invent a SKU',
    turns: ['2015 Honda Civic EX, 1.8L, looking for a cat-back'],
    expectNoFitmentYet: true,
  },
  {
    // No trim given, so this spans every 2021 Ram 1500 5.7L trim (Rebel + Tradesman).
    // 19429 only fits Rebel in our data (not Tradesman) — genuine fitment difference or
    // just an incomplete cross-link from seeding, we can't tell from here. Per the
    // 2026-07-07 decision: when trim isn't given and any candidate part doesn't cover
    // every trim in play, hold everything back and ask, rather than risk showing a part
    // that doesn't actually fit. So this should now ask for trim, not return SKUs
    // directly — a deliberate behavior change from an earlier version of this test.
    name: 'Ram 1500, no trim given — should ask for trim before presenting parts',
    turns: [
      '2021 Ram 1500, 5.7L HEMI',
      'Coil spring rear suspension — the redesigned one, not the Classic.',
    ],
    expectNoFitmentYet: true,
  },
  {
    // The confirmed real case: 19265 is SS-only per its own product page; ZL1 doesn't
    // get it. Trim not given, so this should hold back and ask which trim before
    // showing anything — same mechanism as the Ram case above, but here it's guarding
    // against a genuine fitment difference, not just a data-linking gap.
    name: 'Camaro 6.2L, no trim given — should ask for trim (SS vs ZL1 fitment differs)',
    turns: ['2019 Chevy Camaro, 6.2L V8, looking for an exhaust'],
    expectNoFitmentYet: true,
  },
  {
    name: 'Camaro SS 6.2L — trim given, should resolve directly',
    turns: ['2019 Chevy Camaro SS, 6.2L V8'],
    expectSkus: ['19265', '19336', '19266'],
  },
  {
    // Live bug found 2026-07-21: reply text asked "is it stock or lifted?" while the API
    // had already returned both SKUs in fitmentResults — a text/data contradiction (not a
    // wrong-SKU risk, both parts are correct regardless of lift status). Root cause was
    // system.js phrasing "always ask this" for lift status like it gates the lookup, when
    // the code has never treated it as anything but a post-lookup filter (same as sound
    // preference). Fixed by aligning the wording; this locks in that fitmentResults comes
    // back on the very first message, not withheld pending a lift-status answer.
    name: 'Jeep Wrangler 392 6.4L — results present on first message, not withheld for lift status',
    turns: ['2022 Jeep Wrangler, 6.4L'],
    expectSkus: ['19582', '19598'],
  },
  {
    // Live bug found 2026-07-23: the catalog stored "EcoDiesel" in the submodel field as
    // a workaround, since fitment.js had no ambiguity dimension for engine displacement on
    // its own (only trim/body style/drive type/engine config) — the gas and diesel 2021
    // Wranglers share the same engine_config ("V6"), so nothing else distinguished them.
    // The bot asked "Rubicon or EcoDiesel?" as if picking a trim, which is wrong (a real
    // Rubicon can have either engine). Fixed via a merged engine (displacement + config)
    // ambiguity dimension. This case locks in that a bare "2021 Jeep Wrangler" with no
    // engine given holds back results and asks — not just for this catalog, but for any
    // future data with multiple engine options on the same trim, which real ACES data will
    // have far more of than this demo catalog does.
    name: 'Jeep Wrangler, no engine given — should ask about engine, not guess or mislabel as trim',
    turns: ['2021 Jeep Wrangler'],
    expectNoFitmentYet: true,
  },
  {
    name: 'Jeep Wrangler EcoDiesel — engine answered naturally, should resolve to the diesel-specific SKU',
    turns: ['2021 Jeep Wrangler', 'the ecodiesel one'],
    expectSkus: ['19505'],
    rejectSkus: ['19620', '19592', '19388'],
  },
  {
    name: 'Jeep Wrangler 3.6L gas — engine given directly, should resolve to the gas SKUs',
    turns: ['2021 Jeep Wrangler, 3.6L V6'],
    expectSkus: ['19620', '19592', '19388'],
    rejectSkus: ['19505'],
  },
  {
    // Live bug found 2026-07-23: with no part type specified, the bot returned all 3 SKUs
    // (two Overland Series, one Street) but the reply text didn't explain that two of them
    // are different part types (cat-back vs. axle-back) sharing a series name — read as
    // duplicates. Fixed in system.js (explain the distinction before sound/price) and by
    // no longer restating full specs in prose (PartCard already renders them, so repeating
    // them buried the distinction). This case locks in that all matching part types are
    // still returned together, not narrowed to one without being asked — the same shape of
    // bug (multiple part types under one series) will recur under real PIES data too.
    name: 'Jeep Wrangler Rubicon, no part type given — should return all part types, not just one',
    turns: ['2021 Jeep Wrangler Rubicon'],
    expectSkus: ['19620', '19592', '19388'],
  },
];

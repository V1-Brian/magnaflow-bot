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
    // Rebel's fitment (19430, 19429) was never qualifier-gated — in reality Rebel only
    // ever existed in the redesigned coil-spring body, so it has no "Classic" variant —
    // meaning it always shows up regardless of the qualifier answer. Confirmed correct
    // via direct DB query on 2026-07-07: NOT a bug, a real consequence of only
    // qualifier-gating the Tradesman trim in this demo catalog (see catalog.json notes).
    name: 'Ram 1500, no trim given — answers "coil spring"',
    turns: [
      '2021 Ram 1500, 5.7L HEMI',
      'Coil spring rear suspension — the redesigned one, not the Classic.',
    ],
    expectSkus: ['19429', '19430'],
    rejectSkus: ['15363'],
  },
];

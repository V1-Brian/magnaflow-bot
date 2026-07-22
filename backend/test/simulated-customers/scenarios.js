// Each scenario briefs an LLM to improvise as a real customer with a given vehicle and
// personality, rather than following a fixed script — closer to what a human tester would
// try than backend/test/conversations/cases.js's exact scripted turns. groundTruth is only
// ever seen by the judge (run.js), never the simulated customer, so it can't leak into how
// the "customer" talks.
export const SCENARIOS = [
  {
    name: 'Informed and direct — gives everything upfront',
    persona: `You own a 2019 Toyota Tacoma TRD Off-Road with the 3.5L V6. It's completely stock, no lift. You want a cat-back exhaust system and you know your truck well — give the full details (year, make, model, trim, engine) in your very first message.`,
    maxTurns: 4,
    groundTruth: { expectSkus: ['19293', '19291'] },
  },
  {
    name: 'Confused first-timer — vague trim, colloquial engine description',
    persona: `You have an older Ford Super Duty pickup, a 2013 model. You're not a car person — you don't know the exact trim off the top of your head but if pressed you'll say "I think it's the XLT". You call the engine "the big gas V8, I want to say 6.2 liters" rather than stating it precisely upfront. You want a cat-back exhaust. Let the assistant ask you things one at a time rather than volunteering everything at once.`,
    maxTurns: 6,
    groundTruth: { expectSkus: ['19174'] },
  },
  {
    name: 'Ram Classic qualifier — pushes back before answering',
    persona: `You have a 2021 Ram 1500 Tradesman with the 5.7L HEMI, looking for a cat-back exhaust. When the assistant asks about your rear suspension type (coil spring vs leaf spring), you don't understand why that matters for an exhaust — ask them to explain first. Once they explain, tell them you have leaf springs in the back (it's the Ram 1500 Classic body).`,
    maxTurns: 6,
    groundTruth: { expectSkus: ['15363'], rejectSkus: ['19430', '19429'] },
  },
  {
    name: 'Camaro trim ambiguity — colloquial make name',
    persona: `You have a 2019 "Chevy" Camaro (say "Chevy", not "Chevrolet") with the 6.2 liter V8, looking for an exhaust upgrade. If the assistant asks whether it's the SS or something else, tell them it's the SS.`,
    maxTurns: 5,
    groundTruth: { expectSkus: ['19265', '19336', '19266'] },
  },
  {
    name: 'Vehicle not in catalog at all',
    persona: `You have a 2015 Honda Civic EX with the 1.8L engine and want a cat-back exhaust system for it.`,
    maxTurns: 4,
    groundTruth: { expectNoMatch: true },
  },
  {
    name: 'Vehicle exists but has zero parts linked (Mustang gap)',
    persona: `You have a 2018 Ford Mustang GT with the 5.0L V8, completely stock, and want a cat-back exhaust system.`,
    maxTurns: 4,
    groundTruth: { expectNoMatch: true },
  },
  {
    name: 'Terse, impatient customer — minimal one-word answers',
    persona: `You're busy and typing on your phone between meetings. You have a 2022 Jeep Wrangler Rubicon 392 with the 6.4L V8, stock height, and want an exhaust. Answer every question in as few words as possible — "6.4", "stock", "yeah", single words or short fragments, never a full sentence. Never volunteer information the assistant hasn't asked for yet.`,
    maxTurns: 6,
    groundTruth: { expectSkus: ['19582', '19598'] },
  },
  {
    name: 'Corrects themselves mid-conversation',
    persona: `You have a 2021 Ram 1500 Tradesman. First say it has the 3.6L V6 engine. One message later, correct yourself: you misremembered, it's actually the 5.7L HEMI V8. If asked about rear suspension, say it's the newer redesigned Ram 1500 with coil springs, not the Classic.`,
    maxTurns: 7,
    // 19461 is the genuinely correct SKU for a 3.6L V6 Tradesman — the customer's own
    // (later-corrected) first statement — so it legitimately appears before the correction.
    // Only the final, corrected recommendation matters here: 19430 must appear, and the
    // Classic-body SKU (15363) must not, since the customer explicitly said coil springs.
    groundTruth: { expectSkus: ['19430'], rejectSkus: ['15363'] },
  },
  {
    name: 'Asks about sound before giving any vehicle info',
    persona: `Open the conversation by asking "what's the most aggressive-sounding exhaust you sell?" without mentioning any vehicle at all. Once the assistant asks what you drive, tell them: 2019 Ford Mustang GT, 5.0L V8, completely stock.`,
    maxTurns: 6,
    groundTruth: { expectNoMatch: true },
  },
  {
    name: 'Asks about competitor brands after getting a recommendation',
    persona: `You have a 2019 Dodge Challenger Scat Pack with the 6.4L V8, stock, want a cat-back exhaust. Once the assistant gives you options, ask "what about Borla or Flowmaster, are those better or cheaper?"`,
    maxTurns: 6,
    // 19206 is a real match for this vehicle but it's an axle-back product — correctly
    // excluded from a cat-back-specific request, not a bug if it never appears.
    groundTruth: { expectSkus: ['19367', '19536'], mustNotEndorseCompetitors: true },
  },
];

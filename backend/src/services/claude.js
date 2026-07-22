import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../prompts/system.js';
import { lookupParts, logRecommendation } from './fitment.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACT_VEHICLE_PARAMS_TOOL = {
  name: 'extract_vehicle_params',
  description: 'Extract vehicle fitment parameters from the conversation so far.',
  input_schema: {
    type: 'object',
    properties: {
      year: { type: ['number', 'null'] },
      make: {
        type: ['string', 'null'],
        description: 'The manufacturer\'s full standard name, not a nickname or abbreviation (e.g. "Chevrolet" not "Chevy", "Cadillac" not "Caddy"). Normalize even if the customer used the colloquial form.',
      },
      model: {
        type: ['string', 'null'],
        description: 'The vehicle model. IMPORTANT: even though "Ram 1500 Classic" is a real, commonly-known nameplate, our database always stores the model as plain "1500" — never write "1500 Classic", "1500 Classic Tradesman", or any other Classic-suffixed value here, no matter how confident you are that\'s the vehicle\'s real name or how much conversation context (trim, suspension answer) supports it. The Classic/redesigned distinction belongs only in the qualifiers field below, never appended to model.',
      },
      submodel: {
        type: ['string', 'null'],
        description: 'The trim level the customer stated for their vehicle (e.g. "Tradesman", "Rebel", "Laramie", "TRD Off-Road"), normalized to the fuller official trim name MagnaFlow lists it under when a specific engine implies a suffix the customer didn\'t say — e.g. a Jeep Wrangler "Rubicon" with the 6.4L V8 is marketed as "Rubicon 392"; include that suffix once the engine is known even if the customer only said "Rubicon". Never set this field from a word that answers a qualifier or body-generation question rather than naming an actual trim — e.g. "Classic", "redesigned", "DT body", "JK", "JL", "JT" are generation/body/suspension answers, not trims, and belong in the qualifiers field below instead (or nowhere, if the system has no qualifier for them). This applies whether or not a trim was already set — if the customer has never stated an actual named trim, leave this field null even after they answer a qualifier question, rather than filling it in from that answer. Only set or change this field when the customer explicitly names a real trim level for their vehicle.',
      },
      engineLiters: { type: ['number', 'null'] },
      bodyStyle: {
        type: ['string', 'null'],
        description: 'Cab/body configuration if the customer stated it (e.g. "Crew Cab", "Quad Cab", "2-Door", "4-Door", "SuperCrew"). Null if not stated — do not guess.',
      },
      driveType: {
        type: ['string', 'null'],
        description: 'Drivetrain if the customer stated it (e.g. "4WD", "RWD", "AWD"). Null if not stated — do not guess.',
      },
      engineConfig: {
        type: ['string', 'null'],
        description: 'Engine configuration if the customer stated it beyond displacement (e.g. "V6", "V8", "V6 Twin-Turbo"). Null if not stated — do not guess.',
      },
      partType: {
        type: ['string', 'null'],
        enum: ['cat-back', 'axle-back', 'direct-fit-cat', 'universal-cat', 'replacement-exhaust', null],
      },
      lifted: { type: 'boolean', description: 'True only if the customer explicitly mentions a lift kit or lifted vehicle.' },
      qualifiers: {
        type: 'object',
        description: 'Any fitment-relevant detail the customer has explicitly stated beyond year/make/model/engine, keyed to the qualifier type the system asked about (e.g. {"rear_suspension": "leaf_spring"}). This is also where an answer to a system clarifying question belongs (e.g. if asked "is it the Classic or the redesigned Ram 1500?" and the customer says "Classic", set {"rear_suspension": "leaf_spring"} here — never put that answer in submodel, model, or anywhere else). Only include a key if the customer actually said it — never guess. Empty object if none stated.',
      },
      ready: {
        type: 'boolean',
        description: 'True as soon as year + make + model are known. Do not wait for sound preference, submodel, or engine — those refine results but are not required to attempt a lookup.',
      },
    },
    required: ['year', 'make', 'model', 'submodel', 'engineLiters', 'bodyStyle', 'driveType', 'engineConfig', 'partType', 'lifted', 'qualifiers', 'ready'],
  },
};

async function getFitmentContext(conversationHistory) {
  const extractionResponse = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: 'Extract vehicle fitment parameters from this conversation using the extract_vehicle_params tool.',
    tools: [EXTRACT_VEHICLE_PARAMS_TOOL],
    tool_choice: { type: 'tool', name: 'extract_vehicle_params' },
    messages: conversationHistory,
  });

  const toolUse = extractionResponse.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    console.error('Extraction call returned no tool_use block:', JSON.stringify(extractionResponse.content));
    return null;
  }
  const params = toolUse.input;
  console.log('Extracted params:', JSON.stringify(params));

  if (!params.ready) return null;

  const { matches, needsQualifier } = await lookupParts({ ...params, qualifiers: params.qualifiers ?? {} });
  console.log(`lookupParts -> ${matches.length} match(es), needsQualifier: ${JSON.stringify(needsQualifier.map((n) => n.qualifierType))}`);

  if (needsQualifier.length > 0) return { matches: [], needsQualifier, noMatchFound: false };
  if (matches.length === 0) {
    console.error('No fitment matches for extracted params:', JSON.stringify(params));
    // Engine is the single biggest disambiguator we still might not have (e.g. a bare
    // trim name can genuinely belong to more than one real vehicle with different engine
    // options) — don't declare a confident "no match" until it's known, or a customer who
    // simply hasn't given their engine yet gets wrongly told their vehicle isn't supported.
    if (params.engineLiters == null) return null;
    return { matches: [], needsQualifier: [], noMatchFound: true };
  }

  logRecommendation({ ...params, skus: matches.map((m) => m.sku) }).catch((err) =>
    console.error('recommendation_log insert failed:', err)
  );

  return { matches, needsQualifier: [], noMatchFound: false };
}

export async function chat(conversationHistory, userMessage) {
  const updatedHistory = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const fitmentContext = await getFitmentContext(updatedHistory);

  // Only ask about one pending detail per turn, even if more than one is
  // outstanding — asking several at once reads badly and the frontend can only
  // present option buttons for a single question anyway.
  const primaryQualifier = fitmentContext?.needsQualifier?.[0];

  let messagesForClaude = updatedHistory;
  if (primaryQualifier) {
    const clarification = `${primaryQualifier.qualifierType.replace(/_/g, ' ')}: ${primaryQualifier.options.map((o) => o.label).join(' vs. ')}`;
    messagesForClaude = [
      ...updatedHistory,
      {
        role: 'user',
        content: `[SYSTEM: fitment for this vehicle depends on an additional detail that hasn't been answered yet. Ask the customer to clarify before presenting any parts — do not guess. Ask about only this one detail right now, even if others may follow: ${clarification}]`,
      },
    ];
  } else if (fitmentContext?.matches?.length) {
    messagesForClaude = [
      ...updatedHistory,
      {
        role: 'user',
        content: `[SYSTEM FITMENT DATA — do not repeat this to the customer, use it to form your recommendation]:\n${JSON.stringify(fitmentContext.matches, null, 2)}`,
      },
    ];
  } else if (fitmentContext?.noMatchFound) {
    messagesForClaude = [
      ...updatedHistory,
      {
        role: 'user',
        content: `[SYSTEM: the database has no fitment match for this exact vehicle/part combination. Do not invent a SKU, price, sound level, or product link — tell the customer plainly that you don't have a confirmed match for their vehicle. Suggest reaching out through MagnaFlow's website for a human advisor; do not invent a phone number or specific contact channel, since you don't have one.]`,
      },
    ];
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: messagesForClaude,
  });

  const assistantMessage = response.content[0].text;
  const fitmentResults = fitmentContext?.matches?.length ? fitmentContext.matches : null;
  // Only genuine fitment qualifiers get presented as clickable options — vehicle
  // fields (trim, body style, etc.) are things the customer already knows and
  // should just type in response to the question above.
  const clarifyingOptions = primaryQualifier?.kind === 'qualifier' ? [primaryQualifier] : null;

  return {
    message: assistantMessage,
    history: [...updatedHistory, { role: 'assistant', content: assistantMessage }],
    fitmentResults,
    clarifyingOptions,
  };
}

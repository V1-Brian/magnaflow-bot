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
      make: { type: ['string', 'null'] },
      model: { type: ['string', 'null'] },
      submodel: {
        type: ['string', 'null'],
        description: 'The trim level the customer stated for their vehicle (e.g. "Tradesman", "Rebel", "Laramie", "TRD Off-Road"). If the customer already gave a trim earlier in the conversation, do not overwrite it with their answer to a later qualifier question (e.g. "Classic", "redesigned", "DT body") — those answers go in the qualifiers field below instead, even if they sound like they could be a trim. Only change this field if the customer explicitly states a different trim for their vehicle.',
      },
      engineLiters: { type: ['number', 'null'] },
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
    required: ['year', 'make', 'model', 'submodel', 'engineLiters', 'partType', 'lifted', 'qualifiers', 'ready'],
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

  if (needsQualifier.length > 0) return { matches: [], needsQualifier };
  if (matches.length === 0) {
    console.error('No fitment matches for extracted params:', JSON.stringify(params));
    return null;
  }

  logRecommendation({ ...params, skus: matches.map((m) => m.sku) }).catch((err) =>
    console.error('recommendation_log insert failed:', err)
  );

  return { matches, needsQualifier: [] };
}

export async function chat(conversationHistory, userMessage) {
  const updatedHistory = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const fitmentContext = await getFitmentContext(updatedHistory);

  let messagesForClaude = updatedHistory;
  if (fitmentContext?.needsQualifier?.length) {
    const clarifications = fitmentContext.needsQualifier
      .map((nq) => nq.options.map((o) => o.label).join(' — OR — '))
      .join('; ');
    messagesForClaude = [
      ...updatedHistory,
      {
        role: 'user',
        content: `[SYSTEM: fitment for this vehicle depends on an additional detail that hasn't been answered yet. Ask the customer to clarify before presenting any parts — do not guess: ${clarifications}]`,
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
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: messagesForClaude,
  });

  const assistantMessage = response.content[0].text;
  const fitmentResults = fitmentContext?.matches?.length ? fitmentContext.matches : null;

  return {
    message: assistantMessage,
    history: [...updatedHistory, { role: 'assistant', content: assistantMessage }],
    fitmentResults,
  };
}

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../prompts/system.js';
import { lookupParts } from './fitment.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getFitmentContext(conversationHistory) {
  const extractionResponse = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `Extract vehicle parameters from this conversation. Return ONLY valid JSON with these fields:
      { "year": number|null, "make": string|null, "model": string|null,
        "submodel": string|null, "engineLiters": number|null,
        "partType": string|null, "lifted": boolean, "ready": boolean }
      "ready" = true as soon as you have year + make + model. Do NOT wait for sound preference, submodel, or engine — those refine results but are not required to attempt a lookup.
      "lifted" = true only if the customer explicitly mentions a lift kit or lifted vehicle.
      "partType" must be one of: cat-back, axle-back, direct-fit-cat, universal-cat, replacement-exhaust, or null.`,
    messages: conversationHistory,
  });

  let params;
  try {
    params = JSON.parse(extractionResponse.content[0].text);
  } catch {
    return null;
  }

  if (!params.ready) return null;

  const parts = await lookupParts(params);
  return parts.length > 0 ? parts : null;
}

export async function chat(conversationHistory, userMessage) {
  const updatedHistory = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const fitmentResults = await getFitmentContext(updatedHistory);

  const messagesForClaude = fitmentResults
    ? [
        ...updatedHistory,
        {
          role: 'user',
          content: `[SYSTEM FITMENT DATA — do not repeat this to the customer, use it to form your recommendation]:\n${JSON.stringify(fitmentResults, null, 2)}`,
        },
      ]
    : updatedHistory;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: messagesForClaude,
  });

  const assistantMessage = response.content[0].text;

  return {
    message: assistantMessage,
    history: [...updatedHistory, { role: 'assistant', content: assistantMessage }],
    fitmentResults,
  };
}

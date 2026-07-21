import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NHTSA_DECODE_URL = 'https://vpic.nhtsa.gov/api/vehicles/DecodeVinValuesExtended';

// VINs are always 17 characters and never contain I, O, or Q (ISO 3779) —
// reject anything else before spending an NHTSA call on it.
const VIN_FORMAT = /^[A-HJ-NPR-Z0-9]{17}$/;

const READ_VIN_TOOL = {
  name: 'read_vin_from_image',
  description: 'Read the 17-character Vehicle Identification Number (VIN) visible in the photo, if one is clearly legible.',
  input_schema: {
    type: 'object',
    properties: {
      vin: {
        type: ['string', 'null'],
        description: 'The exact 17-character VIN as printed (VIN plate, door-jamb sticker, or windshield label), if clearly legible. Null if no VIN is visible or any character can\'t be read with confidence — never guess a character.',
      },
      readable: {
        type: 'boolean',
        description: 'True only if every character of the VIN was read with high confidence.',
      },
    },
    required: ['vin', 'readable'],
  },
};

export async function readVinFromImage(base64, mediaType) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: 'Read the VIN in this photo using the read_vin_from_image tool.',
    tools: [READ_VIN_TOOL],
    tool_choice: { type: 'tool', name: 'read_vin_from_image' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'This is a photo of a vehicle VIN plate, VIN sticker, or door-jamb/windshield VIN label. Read the 17-character VIN exactly as printed.' },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) return { vin: null, readable: false };

  const { vin, readable } = toolUse.input;
  if (!readable || !vin || !VIN_FORMAT.test(vin.toUpperCase())) {
    return { vin: null, readable: false };
  }
  return { vin: vin.toUpperCase(), readable: true };
}

// NHTSA often formats a field as slash-separated synonyms (e.g.
// "4WD/4-Wheel Drive/4x4", "Crew/Super Crew/Crew Max (4-Door)") — this string
// is shown directly to the customer, so keep just the first, shortest form.
function cleanField(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || /^not applicable$/i.test(s)) return null;
  return s.split('/')[0].trim();
}

async function decodeVin(vin) {
  const url = `${NHTSA_DECODE_URL}/${encodeURIComponent(vin)}?format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`NHTSA decode request failed: ${res.status}`);

  const data = await res.json();
  const result = data?.Results?.[0];
  if (!result) throw new Error('NHTSA decode returned no results');

  // ErrorCode '0' means a clean decode. A handful of other codes are still
  // usable partial decodes (e.g. check-digit mismatches on older VINs) but
  // most non-zero codes mean the VIN itself is bad — bail rather than guess.
  if (result.ErrorCode && result.ErrorCode !== '0' && result.ErrorCode !== '1') {
    throw new Error(`NHTSA could not decode this VIN: ${result.ErrorText || result.ErrorCode}`);
  }

  return {
    year: cleanField(result.ModelYear),
    make: cleanField(result.Make),
    model: cleanField(result.Model),
    engineLiters: cleanField(result.DisplacementL),
    cylinders: cleanField(result.EngineCylinders),
    engineConfig: cleanField(result.EngineConfiguration),
    driveType: cleanField(result.DriveType),
    bodyStyle: cleanField(result.BodyClass),
  };
}

// Deliberately omits trim/submodel (NHTSA's Series/Trim fields) even when
// present — they aren't guaranteed to match our catalog's submodel naming,
// and per the client's own guidance, trim should never be guessed. Leaving
// it out means the existing trim-ambiguity follow-up (fitment.js) always
// still runs when trim actually matters for a vehicle.
export function buildVinSummaryMessage(fields) {
  const vehicleBits = [fields.year, fields.make, fields.model].filter(Boolean);
  const engineBits = [];
  if (fields.engineLiters) engineBits.push(`${fields.engineLiters}L`);
  if (fields.engineConfig) engineBits.push(fields.engineConfig);
  else if (fields.cylinders) engineBits.push(`${fields.cylinders}-cylinder`);

  const parts = [];
  if (vehicleBits.length) parts.push(vehicleBits.join(' '));
  if (engineBits.length) parts.push(engineBits.join(' '));
  if (fields.driveType) parts.push(fields.driveType);
  if (fields.bodyStyle) parts.push(fields.bodyStyle);

  if (!parts.length) return null;
  return `I scanned my VIN — it decoded to: ${parts.join(', ')}.`;
}

export { decodeVin, VIN_FORMAT };

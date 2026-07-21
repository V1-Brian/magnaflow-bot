import express from 'express';
import { chat } from '../services/claude.js';
import { readVinFromImage, decodeVin, buildVinSummaryMessage } from '../services/vin.js';

const router = express.Router();

// In-memory session store for demo (replace with Redis or DB for production)
const sessions = new Map();

router.post('/', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) {
    return res.status(400).json({ error: 'message and sessionId required' });
  }

  const history = sessions.get(sessionId) ?? [];

  try {
    const { message: reply, history: updatedHistory, fitmentResults, clarifyingOptions } = await chat(history, message);
    sessions.set(sessionId, updatedHistory);
    res.json({ reply, fitmentResults: fitmentResults ?? null, clarifyingOptions: clarifyingOptions ?? null });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Accepts a photo of a VIN plate/sticker, reads the VIN, decodes it via
// NHTSA, and feeds the result into the same chat() pipeline as a normal
// turn — so extraction, fitment lookup, and qualifier follow-ups all work
// exactly as they do for typed text.
router.post('/vin-photo', async (req, res) => {
  const { sessionId, imageBase64, imageMediaType } = req.body;
  if (!sessionId || !imageBase64 || !imageMediaType) {
    return res.status(400).json({ error: 'sessionId, imageBase64, and imageMediaType required' });
  }

  const history = sessions.get(sessionId) ?? [];

  try {
    const { vin, readable } = await readVinFromImage(imageBase64, imageMediaType);
    if (!readable) {
      return res.json({
        reply: "I couldn't read that clearly enough to trust it. Could you try a clearer photo of the VIN plate — usually on the driver's-side windshield corner or door jamb?",
        fitmentResults: null,
        clarifyingOptions: null,
        scannedSummary: null,
      });
    }

    let decoded;
    try {
      decoded = await decodeVin(vin);
    } catch (decodeErr) {
      console.error('VIN decode failed:', decodeErr);
      return res.json({
        reply: "I read your VIN but couldn't decode it right now — mind just typing your vehicle's year, make, and model instead?",
        fitmentResults: null,
        clarifyingOptions: null,
        scannedSummary: null,
      });
    }

    const summary = buildVinSummaryMessage(decoded);
    if (!summary) {
      return res.json({
        reply: "I read your VIN, but the decode didn't return enough detail to identify your vehicle. Mind typing your year, make, and model instead?",
        fitmentResults: null,
        clarifyingOptions: null,
        scannedSummary: null,
      });
    }

    const { message: reply, history: updatedHistory, fitmentResults, clarifyingOptions } = await chat(history, summary);
    sessions.set(sessionId, updatedHistory);
    res.json({ reply, fitmentResults: fitmentResults ?? null, clarifyingOptions: clarifyingOptions ?? null, scannedSummary: summary });
  } catch (err) {
    console.error('VIN photo error:', err);
    res.status(500).json({ error: 'Something went wrong reading that photo. Please try again.' });
  }
});

router.delete('/:sessionId', (req, res) => {
  sessions.delete(req.params.sessionId);
  res.json({ ok: true });
});

export default router;

import express from 'express';
import { chat } from '../services/claude.js';

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
    const { message: reply, history: updatedHistory, fitmentResults } = await chat(history, message);
    sessions.set(sessionId, updatedHistory);
    res.json({ reply, fitmentResults: fitmentResults ?? null });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.delete('/:sessionId', (req, res) => {
  sessions.delete(req.params.sessionId);
  res.json({ ok: true });
});

export default router;

import express from 'express';
import twilio from 'twilio';
import { chat } from '../services/claude.js';
import { synthesizeSpeech } from '../services/tts.js';

const router = express.Router();
const VoiceResponse = twilio.twiml.VoiceResponse;
const sessions = new Map();

router.post('/inbound', (req, res) => {
  const twiml = new VoiceResponse();
  const sessionId = req.body.CallSid;
  sessions.set(sessionId, []);

  twiml.say('Welcome to MagnaFlow. I can help you find the right exhaust or catalytic converter for your vehicle. What year is your car or truck?');
  twiml.gather({
    input: 'speech',
    action: `/voice/respond?sessionId=${sessionId}`,
    speechTimeout: 'auto',
    language: 'en-US',
  });

  res.type('text/xml').send(twiml.toString());
});

router.post('/respond', async (req, res) => {
  const { sessionId } = req.query;
  const userSpeech = req.body.SpeechResult;
  const twiml = new VoiceResponse();

  if (!userSpeech) {
    twiml.say("I didn't catch that. Could you repeat?");
    twiml.gather({ input: 'speech', action: `/voice/respond?sessionId=${sessionId}`, speechTimeout: 'auto' });
    return res.type('text/xml').send(twiml.toString());
  }

  const history = sessions.get(sessionId) ?? [];

  try {
    const { message: reply, history: updatedHistory } = await chat(history, userSpeech);
    sessions.set(sessionId, updatedHistory);

    // Option A: ElevenLabs TTS (higher quality)
    // const audioUrl = await synthesizeSpeech(reply, sessionId);
    // twiml.play(audioUrl);

    // Option B: Twilio built-in TTS (simpler)
    twiml.say({ voice: 'Polly.Joanna' }, reply);

    twiml.gather({
      input: 'speech',
      action: `/voice/respond?sessionId=${sessionId}`,
      speechTimeout: 'auto',
    });
  } catch (err) {
    console.error('Voice error:', err);
    twiml.say("I'm having trouble right now. Please call back or chat with us on the website.");
  }

  res.type('text/xml').send(twiml.toString());
});

export default router;

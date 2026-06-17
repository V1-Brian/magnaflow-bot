import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chatRouter from './routes/chat.js';
import voiceRouter from './routes/voice.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Required for Twilio webhooks

// Serve ElevenLabs audio files for Twilio to fetch
app.use('/audio', express.static('/tmp'));

app.use('/chat', chatRouter);
app.use('/voice', voiceRouter);

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`MagnaFlow bot backend running on port ${PORT}`));

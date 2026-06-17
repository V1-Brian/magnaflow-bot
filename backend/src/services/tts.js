import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export async function synthesizeSpeech(text, sessionId) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  const audioBuffer = await response.buffer();
  const filename = `${sessionId}-${Date.now()}.mp3`;
  const filePath = path.join('/tmp', filename);
  fs.writeFileSync(filePath, audioBuffer);

  return `${process.env.PUBLIC_BASE_URL}/audio/${filename}`;
}

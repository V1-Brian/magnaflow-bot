import { useState } from 'react';

export default function VoiceButton({ onTranscript }) {
  const [listening, setListening] = useState(false);

  function toggle() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      onTranscript(transcript);
    };

    recognition.start();
  }

  return (
    <button
      onClick={toggle}
      title={listening ? 'Listening...' : 'Speak'}
      style={{
        background: listening ? '#CC0000' : '#eee',
        color: listening ? '#fff' : '#333',
        border: 'none',
        borderRadius: 8,
        padding: '10px 14px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 18,
      }}
    >
      {listening ? '...' : 'Mic'}
    </button>
  );
}

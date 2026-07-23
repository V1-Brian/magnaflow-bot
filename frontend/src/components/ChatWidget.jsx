import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessageBubble from './MessageBubble';
import PartCard from './PartCard';
import OptionButtons from './OptionButtons';
import VinPhotoButton from './VinPhotoButton';
import TypingIndicator from './TypingIndicator';

const API_URL = import.meta.env.VITE_API_URL;
const SESSION_ID = uuidv4();
const MAX_PHOTO_DIMENSION = 1600;

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function ChatWidget() {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Hi! I'm the MagnaFlow Parts Advisor. Let's find the right part for you.\n\n- Year, make, model, and engine, if you know it (or scan your VIN)\n- Looking for something specific (cat-back, axle-back, etc.), or want to see everything that fits?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [clarifyingOptions, setClarifyingOptions] = useState(null);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, clarifyingOptions, pendingPhoto]);

  function appendAssistantReply(data) {
    setMessages(prev => [...prev, { role: 'assistant', text: data.reply, parts: data.fitmentResults ?? null }]);
    setClarifyingOptions(data.clarifyingOptions ?? null);
  }

  async function sendMessage(overrideText) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput('');
    setClarifyingOptions(null);
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: SESSION_ID }),
      });
      const data = await res.json();
      appendAssistantReply(data);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleVinPhoto(file) {
    if (loading) return;
    let base64, mediaType, dataUrl;
    try {
      ({ base64, mediaType, dataUrl } = await resizeImageToBase64(file));
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: "Sorry, I couldn't read that image. Please try a different photo." }]);
      return;
    }

    setClarifyingOptions(null);
    setPendingPhoto(dataUrl);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat/vin-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, imageBase64: base64, imageMediaType: mediaType }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'user', text: data.scannedSummary ?? 'Scanned VIN photo', imageDataUrl: dataUrl }]);
      appendAssistantReply(data);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'user', text: 'Scanned VIN photo', imageDataUrl: dataUrl },
        { role: 'assistant', text: "Sorry, something went wrong reading that photo. Please try again." },
      ]);
    } finally {
      setPendingPhoto(null);
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#CC0000', color: '#fff', padding: '16px 20px', fontWeight: 700, fontSize: 16 }}>
        MagnaFlow Parts Advisor
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: '#f5f5f5', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i}>
            <MessageBubble role={m.role} text={m.text} imageDataUrl={m.imageDataUrl} />
            {m.parts?.slice(0, 3).map(part => (
              <div key={part.sku} style={{ marginTop: 8 }}>
                <PartCard part={part} />
              </div>
            ))}
          </div>
        ))}
        {pendingPhoto && <MessageBubble role="user" text="" imageDataUrl={pendingPhoto} />}
        {loading && <TypingIndicator />}
        {clarifyingOptions?.length > 0 && !loading && (
          <OptionButtons groups={clarifyingOptions} onSelect={sendMessage} disabled={loading} />
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '12px 16px', background: '#fff', borderTop: '1px solid #e0e0e0' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Type your answer..."
          style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #ccc', fontSize: 15, outline: 'none' }}
        />
        <VinPhotoButton onImageSelected={handleVinPhoto} disabled={loading} />
        <button
          onClick={() => sendMessage()}
          disabled={loading}
          style={{ background: '#CC0000', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

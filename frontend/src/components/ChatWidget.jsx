import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessageBubble from './MessageBubble';
import PartCard from './PartCard';

const API_URL = import.meta.env.VITE_API_URL;
const SESSION_ID = uuidv4();

export default function ChatWidget() {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Hi! I'm the MagnaFlow Parts Advisor. What year is your vehicle?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastFitment, setLastFitment] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: SESSION_ID }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply }]);
      if (data.fitmentResults?.length) setLastFitment(data.fitmentResults);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: "Sorry, something went wrong. Please try again." }]);
    } finally {
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
          <MessageBubble key={i} role={m.role} text={m.text} />
        ))}
        {lastFitment?.slice(0, 3).map(part => (
          <PartCard key={part.sku} part={part} />
        ))}
        {loading && <MessageBubble role="assistant" text="..." />}
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
        <button
          onClick={sendMessage}
          disabled={loading}
          style={{ background: '#CC0000', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

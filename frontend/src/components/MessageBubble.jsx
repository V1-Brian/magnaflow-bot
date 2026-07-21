import ReactMarkdown from 'react-markdown';

export default function MessageBubble({ role, text, imageDataUrl }) {
  const isBot = role === 'assistant';
  return (
    <div style={{ display: 'flex', justifyContent: isBot ? 'flex-start' : 'flex-end' }}>
      <div className="msg-markdown" style={{
        background: isBot ? '#fff' : '#CC0000',
        color: isBot ? '#222' : '#fff',
        padding: '10px 14px',
        borderRadius: isBot ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
        maxWidth: '80%',
        fontSize: 15,
        lineHeight: 1.5,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        {imageDataUrl && (
          <img
            src={imageDataUrl}
            alt="Scanned VIN"
            style={{ display: 'block', maxWidth: 160, borderRadius: 8, marginBottom: text ? 8 : 0 }}
          />
        )}
        {text && <ReactMarkdown>{text}</ReactMarkdown>}
      </div>
    </div>
  );
}

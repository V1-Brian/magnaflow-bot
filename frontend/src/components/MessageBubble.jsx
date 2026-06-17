export default function MessageBubble({ role, text }) {
  const isBot = role === 'assistant';
  return (
    <div style={{ display: 'flex', justifyContent: isBot ? 'flex-start' : 'flex-end' }}>
      <div style={{
        background: isBot ? '#fff' : '#CC0000',
        color: isBot ? '#222' : '#fff',
        padding: '10px 14px',
        borderRadius: isBot ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
        maxWidth: '80%',
        fontSize: 15,
        lineHeight: 1.5,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        {text}
      </div>
    </div>
  );
}

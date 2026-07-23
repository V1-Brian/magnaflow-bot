export default function TypingIndicator() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{
        background: '#fff',
        padding: '12px 16px',
        borderRadius: '4px 14px 14px 14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        <span className="typing-dots">
          <span></span><span></span><span></span>
        </span>
      </div>
    </div>
  );
}

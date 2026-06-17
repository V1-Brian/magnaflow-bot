export default function PartCard({ part }) {
  return (
    <div style={{ background: '#fff', border: '2px solid #CC0000', borderRadius: 10, padding: '14px 16px', fontSize: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: '#CC0000' }}>SKU {part.sku} — {part.series}</div>
      <div style={{ color: '#444', margin: '6px 0' }}>{part.description}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <span><strong>${parseFloat(part.price).toFixed(2)}</strong></span>
        <span>Sound: {part.sound_level}</span>
        <span>Install: {part.install_difficulty}</span>
      </div>
      {part.product_url && (
        <a href={part.product_url} target="_blank" rel="noreferrer"
          style={{ display: 'inline-block', marginTop: 10, color: '#CC0000', fontWeight: 600, textDecoration: 'none' }}>
          View on MagnaFlow &rarr;
        </a>
      )}
    </div>
  );
}

const PART_TYPE_LABELS = {
  'cat-back': 'Cat-Back',
  'axle-back': 'Axle-Back',
  'replacement-exhaust': 'Replacement Exhaust',
  'direct-fit-cat': 'Direct-Fit Cat',
  'universal-cat': 'Universal Cat',
};

function shortSummary(part) {
  if (part.attributes?.length) {
    return part.attributes.map(a => a.value).slice(0, 2).join(' · ');
  }
  return part.description?.split(/[.;]/)[0];
}

export default function PartCard({ part }) {
  const typeLabel = PART_TYPE_LABELS[part.part_type] ?? part.part_type;
  const summary = shortSummary(part);

  return (
    <div style={{ background: '#fff', border: '2px solid #CC0000', borderRadius: 10, padding: '12px 14px', fontSize: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#CC0000' }}>SKU {part.sku} — {part.series}</div>
        {typeLabel && (
          <span style={{ background: '#fdeceb', color: '#CC0000', fontWeight: 600, fontSize: 12, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
            {typeLabel}
          </span>
        )}
      </div>
      {summary && <div style={{ color: '#555', margin: '6px 0', fontSize: 13 }}>{summary}</div>}
      <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
        <span><strong>${parseFloat(part.price).toFixed(2)}</strong></span>
        <span>Sound: {part.sound_level}</span>
        <span>Install: {part.install_difficulty}</span>
      </div>
      {part.product_url && (
        <a href={part.product_url} target="_blank" rel="noreferrer"
          style={{ display: 'inline-block', marginTop: 8, color: '#CC0000', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
          Full details on MagnaFlow &rarr;
        </a>
      )}
    </div>
  );
}

export default function OptionButtons({ groups, onSelect, disabled }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '80%', width: '100%' }}>
        {groups.map(group => (
          <div key={group.qualifierType} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.options.map(opt => (
              <button
                key={opt.value}
                onClick={() => onSelect(opt.label)}
                disabled={disabled}
                style={{
                  textAlign: 'left',
                  background: '#fff',
                  border: '1.5px solid #CC0000',
                  color: '#CC0000',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useRef } from 'react';

export default function VinPhotoButton({ onImageSelected, disabled }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setBusy(true);
    Promise.resolve(onImageSelected(file)).finally(() => setBusy(false));
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        title={busy ? 'Reading VIN...' : 'Scan VIN'}
        style={{
          background: busy ? '#CC0000' : '#eee',
          color: busy ? '#fff' : '#333',
          border: 'none',
          borderRadius: 8,
          padding: '10px 14px',
          cursor: disabled || busy ? 'default' : 'pointer',
          fontWeight: 600,
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {busy ? '...' : '📷'}
      </button>
    </>
  );
}

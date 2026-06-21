import { useState } from 'react';
import { saveToken } from '../api';

interface Props {
  onSaved: () => void;
}

export function TokenSetup({ onSaved }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = value.trim();
    if (!t || t.split('.').length !== 3) {
      setError('Paste a valid JWT token.');
      return;
    }
    saveToken(t);
    onSaved();
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: '1.5rem',
      padding: '2rem',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          SSM NOC Dashboard
        </div>
        <div style={{ color: 'var(--muted)' }}>
          Enter a service JWT to begin monitoring
        </div>
      </div>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <textarea
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          rows={4}
          style={{
            width: '100%',
            padding: '0.75rem',
            background: 'var(--surface)',
            border: `1px solid ${error ? 'var(--offline)' : 'var(--border)'}`,
            borderRadius: '6px',
            color: 'var(--text)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '12px',
            resize: 'vertical',
            outline: 'none',
          }}
        />
        {error && <div style={{ color: 'var(--offline)', fontSize: '13px' }}>{error}</div>}
        <button
          type="submit"
          style={{
            padding: '0.625rem 1.5rem',
            background: 'var(--online)',
            color: '#000',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Connect
        </button>
      </form>
      <div style={{ color: 'var(--muted)', fontSize: '12px', textAlign: 'center' }}>
        Generate a token with: <code style={{ color: 'var(--text)' }}>npx ts-node scripts/sign-jwt.ts &lt;company_id&gt;</code>
      </div>
    </div>
  );
}

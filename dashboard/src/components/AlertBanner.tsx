import { useEffect, useState } from 'react';
import type { LiveEvent } from '../types';

interface Props {
  events: LiveEvent[];
  deviceName: (id: string) => string;
}

export function AlertBanner({ events, deviceName }: Props) {
  const [visible, setVisible] = useState(true);
  const criticals = events.filter((e) => e.severity === 'critical').slice(0, 5);

  useEffect(() => {
    if (criticals.length === 0) return;
    setVisible(true);
    const id = setInterval(() => setVisible((v) => !v), 900);
    return () => clearInterval(id);
  }, [criticals.length]);

  if (criticals.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      padding: '0 1.25rem',
      height: '36px',
      background: visible ? 'var(--critical)' : '#7f1d1d',
      borderBottom: '1px solid #991b1b',
      flexShrink: 0,
      transition: 'background 0.15s',
      overflow: 'hidden',
    }}>
      <span style={{ fontWeight: 700, fontSize: '12px', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
        ⚠ CRITICAL
      </span>
      <div style={{ display: 'flex', gap: '1.5rem', overflow: 'hidden' }}>
        {criticals.map((e) => (
          <span key={e.id} style={{ fontSize: '12px', whiteSpace: 'nowrap', color: '#fecaca' }}>
            {deviceName(e.deviceId)} — {e.type.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}

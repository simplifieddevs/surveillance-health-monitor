import { useEffect, useState } from 'react';
import type { FleetSummary } from '../types';

interface Props {
  fleet: FleetSummary | null;
  lastUpdated: Date | null;
  onAdd: () => void;
}

export function Header({ fleet, lastUpdated, onAdd }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const online = fleet?.byStatus.online ?? 0;
  const degraded = fleet?.byStatus.degraded ?? 0;
  const offline = fleet?.byStatus.offline ?? 0;

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      gap: '1.5rem',
      padding: '0 1.25rem',
      height: '48px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.08em', color: 'var(--text)', marginRight: '0.25rem' }}>
        SSM
      </span>

      <StatPill color="var(--online)" label="ONLINE" value={online} symbol="●" />
      <StatPill color="var(--degraded)" label="DEGRADED" value={degraded} symbol="◐" />
      <StatPill color="var(--offline)" label="OFFLINE" value={offline} symbol="✕" />

      <div style={{ flex: 1 }} />

      {lastUpdated && (
        <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
          updated {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </span>
      )}

      <button
        onClick={onAdd}
        title="Add site or unit"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '28px', height: '28px',
          borderRadius: '6px',
          border: '1px solid var(--border)',
          background: 'none',
          color: 'var(--text)',
          fontSize: '18px',
          cursor: 'pointer',
          lineHeight: 1,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--online)'; e.currentTarget.style.color = 'var(--online)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }}
      >
        +
      </button>

      <span className="mono" style={{ fontSize: '13px', color: 'var(--text)', minWidth: '160px', textAlign: 'right' }}>
        {dateStr}&nbsp;&nbsp;{timeStr}
      </span>
    </header>
  );
}

function StatPill({ color, label, value, symbol }: {
  color: string;
  label: string;
  value: number;
  symbol: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '13px' }}>
      <span style={{ color, fontSize: '10px' }}>{symbol}</span>
      <span className="mono" style={{ color, fontWeight: 700, minWidth: '28px' }}>{value}</span>
      <span style={{ color: 'var(--muted)', fontSize: '11px', letterSpacing: '0.06em' }}>{label}</span>
    </div>
  );
}

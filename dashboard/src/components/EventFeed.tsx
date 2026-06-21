import type { EventSeverity, LiveEvent } from '../types';

interface Props {
  events: LiveEvent[];
  deviceName: (id: string) => string;
  siteName: (id: string) => string;
}

const SEV_COLOR: Record<EventSeverity, string> = {
  critical: 'var(--offline)',
  error:    '#f97316',
  warning:  'var(--degraded)',
  info:     'var(--info)',
};

const SEV_LABEL: Record<EventSeverity, string> = {
  critical: 'CRIT',
  error:    'ERR ',
  warning:  'WARN',
  info:     'INFO',
};

export function EventFeed({ events, deviceName, siteName }: Props) {
  return (
    <div style={{
      width: '300px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid var(--border)',
    }}>
      <div style={{
        padding: '0.625rem 0.875rem',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: 'var(--muted)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        LIVE EVENTS
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {events.length === 0 && (
          <div style={{ padding: '1rem 0.875rem', color: 'var(--muted)', fontSize: '12px' }}>
            No events yet
          </div>
        )}
        {events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            device={deviceName(e.deviceId)}
            site={siteName(e.siteId)}
          />
        ))}
      </div>
    </div>
  );
}

function EventRow({ event, device, site }: { event: LiveEvent; device: string; site: string }) {
  const color = SEV_COLOR[event.severity];
  const label = SEV_LABEL[event.severity];
  const time = new Date(event.detectedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      padding: '0.5rem 0.875rem',
      borderBottom: '1px solid var(--border)',
      background: event.severity === 'critical' ? '#dc262608' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span className="mono" style={{ color, fontSize: '10px', fontWeight: 700, minWidth: '32px' }}>
          {label}
        </span>
        <span className="mono" style={{ color: 'var(--muted)', fontSize: '10px', marginLeft: 'auto' }}>
          {time}
        </span>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.3 }}>
        {event.type.replace(/_/g, ' ')}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
        {device} · {site}
      </div>
    </div>
  );
}

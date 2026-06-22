import type { Device, SiteWithDevices } from '../types';

interface Props {
  data: SiteWithDevices;
  onClick: () => void;
}

const STATUS_COLOR: Record<Device['status'], string> = {
  online: 'var(--online)',
  degraded: 'var(--degraded)',
  offline: 'var(--offline)',
  unknown: 'var(--unknown)',
};

const STATUS_SYMBOL: Record<Device['status'], string> = {
  online: '●',
  degraded: '◐',
  offline: '✕',
  unknown: '○',
};

export function SiteCard({ data, onClick }: Props) {
  const { site, devices } = data;
  const enabled = devices.filter((d) => d.enabled);
  const online = enabled.filter((d) => d.status === 'online').length;
  const total = enabled.length;
  const hasOffline = enabled.some((d) => d.status === 'offline');
  const hasDegraded = enabled.some((d) => d.status === 'degraded');

  const borderColor = hasOffline
    ? 'var(--offline)'
    : hasDegraded
    ? 'var(--degraded)'
    : 'var(--border)';

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${borderColor}`,
        borderRadius: '8px',
        padding: '0.875rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        minHeight: '120px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#1a1f27'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', lineHeight: 1.3 }}>
          {site.name}
        </span>
        <span style={{
          fontSize: '11px',
          color: hasOffline ? 'var(--offline)' : hasDegraded ? 'var(--degraded)' : 'var(--online)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          marginLeft: '0.5rem',
        }}>
          {online}/{total}
        </span>
      </div>

      {enabled.length === 0 ? (
        <span style={{ color: 'var(--muted)', fontSize: '11px' }}>No devices</span>
      ) : (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
        }}>
          {enabled.map((d) => (
            <DeviceDot key={d.id} device={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceDot({ device }: { device: Device }) {
  const color = STATUS_COLOR[device.status];
  const symbol = STATUS_SYMBOL[device.status];

  return (
    <span
      title={`${device.name} (${device.address}) — ${device.status}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '22px',
        height: '22px',
        borderRadius: '4px',
        background: `${color}18`,
        border: `1px solid ${color}44`,
        color,
        fontSize: '11px',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {symbol}
    </span>
  );
}

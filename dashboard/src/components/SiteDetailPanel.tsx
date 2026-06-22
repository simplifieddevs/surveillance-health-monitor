import { useState } from 'react';
import { api } from '../api';
import type { Device, Site } from '../types';

interface Props {
  site: Site;
  devices: Device[];
  onClose: () => void;
  onUpdated: () => void;
  onAddDevice: (site: Site) => void;
}

const STATUS_COLOR = {
  online: 'var(--online)',
  degraded: 'var(--degraded)',
  offline: 'var(--offline)',
  unknown: 'var(--unknown)',
};
const STATUS_SYMBOL = { online: '●', degraded: '◐', offline: '✕', unknown: '○' };

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.4rem 0.6rem',
  background: '#0a0c0f',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  color: 'var(--text)',
  fontSize: '13px',
  outline: 'none',
};

export function SiteDetailPanel({ site, devices, onClose, onUpdated, onAddDevice }: Props) {
  const [editingSite, setEditingSite] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      zIndex: 50,
      display: 'flex',
      justifyContent: 'flex-end',
    }}>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
      />

      {/* panel */}
      <div style={{
        position: 'relative',
        width: '420px',
        height: '100%',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}>
        {/* header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '1.125rem 1.25rem 0.875rem',
          borderBottom: '1px solid var(--border)',
          gap: '0.75rem',
        }}>
          <div style={{ flex: 1 }}>
            {editingSite ? (
              <SiteEditForm
                site={site}
                onSaved={() => { setEditingSite(false); onUpdated(); }}
                onCancel={() => setEditingSite(false)}
              />
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '0.25rem' }}>
                  {site.name}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {site.timezone || 'UTC'}
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            {!editingSite && (
              <IconBtn title="Edit site" onClick={() => setEditingSite(true)}>✏</IconBtn>
            )}
            <IconBtn title="Close" onClick={onClose}>×</IconBtn>
          </div>
        </div>

        {/* devices section */}
        <div style={{ padding: '1rem 1.25rem', flex: 1 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '0.75rem',
          }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted)' }}>
              DEVICES ({devices.length})
            </span>
            <button
              onClick={() => onAddDevice(site)}
              style={{
                fontSize: '12px', fontWeight: 600,
                color: 'var(--online)',
                background: 'none', border: '1px solid var(--online)',
                borderRadius: '4px', padding: '0.2rem 0.625rem',
                cursor: 'pointer',
              }}
            >
              + Add unit
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {devices.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '0.5rem 0' }}>
                No units yet — add one above.
              </div>
            )}
            {devices.map((d) =>
              editingDeviceId === d.id ? (
                <DeviceEditForm
                  key={d.id}
                  device={d}
                  onSaved={() => { setEditingDeviceId(null); onUpdated(); }}
                  onCancel={() => setEditingDeviceId(null)}
                />
              ) : (
                <DeviceRow
                  key={d.id}
                  device={d}
                  onEdit={() => setEditingDeviceId(d.id)}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Site edit form ──────────────────────────────────────── */

function SiteEditForm({ site, onSaved, onCancel }: { site: Site; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(site.name);
  const [timezone, setTimezone] = useState(site.timezone || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      await api.updateSite(site.id, { name: name.trim(), timezone: timezone.trim() || undefined });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Site name" autoFocus />
      <input style={inputStyle} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Timezone (e.g. America/New_York)" />
      {error && <div style={{ color: 'var(--offline)', fontSize: '11px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <SaveBtn saving={saving} label="Save" />
        <CancelBtn onClick={onCancel} disabled={saving} />
      </div>
    </form>
  );
}

/* ── Device row ──────────────────────────────────────────── */

function DeviceRow({ device, onEdit }: { device: Device; onEdit: () => void }) {
  const color = STATUS_COLOR[device.status];
  const symbol = STATUS_SYMBOL[device.status];
  const lastSeen = device.lastSeenAt ? timeAgo(new Date(device.lastSeenAt)) : 'never';
  const cfg = device.vendorConfig as Record<string, unknown>;
  const ports = [
    cfg?.httpPort ? `HTTP:${cfg.httpPort}` : null,
    cfg?.serverPort ? `SRV:${cfg.serverPort}` : null,
  ].filter(Boolean).join('  ');

  return (
    <div style={{
      background: '#0a0c0f',
      border: `1px solid ${device.status === 'offline' ? 'var(--offline)' : 'var(--border)'}`,
      borderRadius: '6px',
      padding: '0.625rem 0.875rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ color, fontSize: '11px' }}>{symbol}</span>
        <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>{device.name}</span>
        <button
          onClick={onEdit}
          style={{ fontSize: '11px', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.25rem' }}
        >
          ✏ Edit
        </button>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--muted)', paddingLeft: '1.25rem' }}>
        {device.address}
        {ports && <span style={{ marginLeft: '0.75rem', color: 'var(--unknown)' }}>{ports}</span>}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--muted)', paddingLeft: '1.25rem', display: 'flex', gap: '0.75rem' }}>
        <span style={{ textTransform: 'capitalize' }}>{device.vendor}</span>
        <span>·</span>
        <span>Last seen {lastSeen}</span>
        {!device.enabled && <span style={{ color: 'var(--offline)' }}>· disabled</span>}
      </div>
    </div>
  );
}

/* ── Device edit form ────────────────────────────────────── */

function DeviceEditForm({ device, onSaved, onCancel }: { device: Device; onSaved: () => void; onCancel: () => void }) {
  const cfg = (device.vendorConfig ?? {}) as Record<string, unknown>;
  const [name, setName] = useState(device.name);
  const [address, setAddress] = useState(device.address);
  const [httpPort, setHttpPort] = useState(String(cfg.httpPort ?? '80'));
  const [serverPort, setServerPort] = useState(String(cfg.serverPort ?? '554'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(device.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!address.trim()) { setError('Address is required.'); return; }
    setSaving(true);
    try {
      await api.updateDevice(device.id, {
        name: name.trim(),
        address: address.trim(),
        enabled,
        vendorConfig: {
          ...cfg,
          httpPort: httpPort ? parseInt(httpPort, 10) : undefined,
          serverPort: serverPort ? parseInt(serverPort, 10) : undefined,
        },
        credentials: (username || password)
          ? { username: username || undefined, password: password || undefined }
          : undefined,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{
      background: '#0a0c0f',
      border: '1px solid var(--online)',
      borderRadius: '6px',
      padding: '0.75rem 0.875rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    }}>
      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em' }}>EDIT UNIT</span>

      <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Device name" autoFocus />
      <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="IP address / hostname" />

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input style={{ ...inputStyle, flex: 1 }} type="number" min={1} max={65535} value={httpPort} onChange={(e) => setHttpPort(e.target.value)} placeholder="HTTP port" />
        <input style={{ ...inputStyle, flex: 1 }} type="number" min={1} max={65535} value={serverPort} onChange={(e) => setServerPort(e.target.value)} placeholder="Server port" />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input style={{ ...inputStyle, flex: 1 }} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (leave blank to keep)" autoComplete="off" />
        <input style={{ ...inputStyle, flex: 1 }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (leave blank to keep)" autoComplete="new-password" />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '12px', color: 'var(--muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled (polls this device)
      </label>

      {error && <div style={{ color: 'var(--offline)', fontSize: '11px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <SaveBtn saving={saving} label="Save" />
        <CancelBtn onClick={onCancel} disabled={saving} />
      </div>
    </form>
  );
}

/* ── Shared small components ─────────────────────────────── */

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'none',
        border: '1px solid var(--border)',
        borderRadius: '5px',
        color: 'var(--muted)',
        cursor: 'pointer',
        fontSize: '14px',
        width: '28px', height: '28px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function SaveBtn({ saving, label }: { saving: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={saving}
      style={{
        padding: '0.35rem 0.875rem',
        background: saving ? 'var(--border)' : 'var(--online)',
        border: 'none', borderRadius: '4px',
        color: saving ? 'var(--muted)' : '#000',
        fontWeight: 700, fontSize: '12px',
        cursor: saving ? 'default' : 'pointer',
      }}
    >
      {saving ? 'Saving…' : label}
    </button>
  );
}

function CancelBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '0.35rem 0.75rem',
        background: 'none',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        color: 'var(--muted)',
        fontSize: '12px',
        cursor: 'pointer',
      }}
    >
      Cancel
    </button>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

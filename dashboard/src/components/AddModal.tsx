import { useState } from 'react';
import { api } from '../api';
import type { Site } from '../types';

type Flow = 'choose' | 'site' | 'unit';

interface Props {
  sites: Site[];
  preselectedSite?: Site | null;
  onClose: () => void;
  onCreated: () => void;
}

const VENDORS = ['onvif', 'hikvision', 'dahua', 'uniview', 'hanwha', 'axis'] as const;

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.625rem',
  background: '#0a0c0f',
  border: '1px solid var(--border)',
  borderRadius: '5px',
  color: 'var(--text)',
  fontSize: '13px',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
  fontSize: '12px',
  color: 'var(--muted)',
  fontWeight: 500,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={labelStyle}>
      {label}
      {children}
    </label>
  );
}

export function AddModal({ sites, preselectedSite, onClose, onCreated }: Props) {
  const [flow, setFlow] = useState<Flow>(preselectedSite ? 'unit' : 'choose');

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        width: '100%',
        maxWidth: '420px',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>
            {flow === 'choose' ? 'Add new' : flow === 'site' ? 'New site' : 'New unit'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>

        {flow === 'choose' && <ChooseFlow onChoose={setFlow} />}
        {flow === 'site' && <SiteForm onBack={() => setFlow('choose')} onCreated={onCreated} />}
        {flow === 'unit' && <UnitForm sites={sites} preselectedSite={preselectedSite} onBack={() => setFlow('choose')} onCreated={onCreated} />}
      </div>
    </div>
  );
}

function ChooseFlow({ onChoose }: { onChoose: (f: Flow) => void }) {
  return (
    <div style={{ display: 'flex', gap: '1rem' }}>
      <ChoiceCard
        title="Site"
        description="A location with one or more cameras — warehouse, office, building."
        icon="🏢"
        onClick={() => onChoose('site')}
      />
      <ChoiceCard
        title="Unit"
        description="A single camera or NVR added directly to an existing site."
        icon="📷"
        onClick={() => onChoose('unit')}
      />
    </div>
  );
}

function ChoiceCard({ title, description, icon, onClick }: {
  title: string; description: string; icon: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: '#0a0c0f',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '1rem',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        color: 'var(--text)',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--online)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <span style={{ fontSize: '24px' }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: '14px' }}>{title}</span>
      <span style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.4 }}>{description}</span>
    </button>
  );
}

function SiteForm({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.createSite({ name: name.trim(), timezone: timezone.trim() || undefined });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Field label="Site name *">
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warehouse A" autoFocus />
      </Field>
      <Field label="Timezone (optional)">
        <input style={inputStyle} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. America/New_York" />
      </Field>
      {error && <div style={{ color: 'var(--offline)', fontSize: '12px' }}>{error}</div>}
      <FormFooter onBack={onBack} saving={saving} label="Create site" />
    </form>
  );
}

function UnitForm({ sites, preselectedSite, onBack, onCreated }: { sites: Site[]; preselectedSite?: Site | null; onBack: () => void; onCreated: () => void }) {
  const [siteMode, setSiteMode] = useState<'existing' | 'new'>(
    preselectedSite || sites.length > 0 ? 'existing' : 'new'
  );
  const [siteId, setSiteId] = useState(preselectedSite?.id ?? sites[0]?.id ?? '');
  const [newSiteName, setNewSiteName] = useState('');
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState<string>(VENDORS[0]);
  const [address, setAddress] = useState('');
  const [httpPort, setHttpPort] = useState('80');
  const [serverPort, setServerPort] = useState('554');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Device name is required.'); return; }
    if (!address.trim()) { setError('IP address / hostname is required.'); return; }
    if (siteMode === 'new' && !newSiteName.trim()) { setError('Site name is required.'); return; }
    if (siteMode === 'existing' && !siteId) { setError('Select a site.'); return; }

    setSaving(true);
    setError('');
    try {
      let targetSiteId = siteId;
      if (siteMode === 'new') {
        const site = await api.createSite({ name: newSiteName.trim() });
        targetSiteId = site.id;
      }
      await api.createDevice({
        siteId: targetSiteId,
        name: name.trim(),
        vendor,
        address: address.trim(),
        credentials: {
          username: username.trim() || undefined,
          password: password || undefined,
        },
        vendorConfig: {
          httpPort: httpPort ? parseInt(httpPort, 10) : undefined,
          serverPort: serverPort ? parseInt(serverPort, 10) : undefined,
        },
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Site selection */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500 }}>Site *</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {sites.length > 0 && (
            <TabBtn active={siteMode === 'existing'} onClick={() => setSiteMode('existing')}>Existing</TabBtn>
          )}
          <TabBtn active={siteMode === 'new'} onClick={() => setSiteMode('new')}>New site</TabBtn>
        </div>
        {siteMode === 'existing' && (
          <select style={inputStyle} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {siteMode === 'new' && (
          <input style={inputStyle} value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="New site name" autoFocus />
        )}
      </div>

      <Field label="Device name *">
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Front Entrance Cam" />
      </Field>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 1, ...labelStyle, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <span>Vendor *</span>
          <select style={inputStyle} value={vendor} onChange={(e) => setVendor(e.target.value)}>
            {VENDORS.map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
          </select>
        </div>
        <div style={{ flex: 2, ...labelStyle, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <span>IP address / hostname *</span>
          <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.100" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <Field label="HTTP port">
          <input
            style={inputStyle}
            type="number"
            min={1} max={65535}
            value={httpPort}
            onChange={(e) => setHttpPort(e.target.value)}
            placeholder="80"
          />
        </Field>
        <Field label="Server port (RTSP/ONVIF)">
          <input
            style={inputStyle}
            type="number"
            min={1} max={65535}
            value={serverPort}
            onChange={(e) => setServerPort(e.target.value)}
            placeholder="554"
          />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <Field label="Username">
          <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="off" />
        </Field>
        <Field label="Password">
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </Field>
      </div>

      {error && <div style={{ color: 'var(--offline)', fontSize: '12px' }}>{error}</div>}
      <FormFooter onBack={onBack} saving={saving} label="Add unit" />
    </form>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0.25rem 0.75rem',
        borderRadius: '4px',
        border: `1px solid ${active ? 'var(--online)' : 'var(--border)'}`,
        background: active ? '#22c55e18' : 'transparent',
        color: active ? 'var(--online)' : 'var(--muted)',
        fontSize: '12px',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function FormFooter({ onBack, saving, label }: { onBack: () => void; saving: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
      <button
        type="button"
        onClick={onBack}
        disabled={saving}
        style={{
          padding: '0.5rem 1rem',
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: '5px',
          color: 'var(--muted)',
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        Back
      </button>
      <button
        type="submit"
        disabled={saving}
        style={{
          padding: '0.5rem 1.25rem',
          background: saving ? 'var(--border)' : 'var(--online)',
          border: 'none',
          borderRadius: '5px',
          color: saving ? 'var(--muted)' : '#000',
          fontWeight: 700,
          cursor: saving ? 'default' : 'pointer',
          fontSize: '13px',
        }}
      >
        {saving ? 'Saving…' : label}
      </button>
    </div>
  );
}

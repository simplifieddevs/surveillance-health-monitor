import { useCallback, useState } from 'react';
import { getToken } from './api';
import { AlertBanner } from './components/AlertBanner';
import { EventFeed } from './components/EventFeed';
import { Header } from './components/Header';
import { SiteGrid } from './components/SiteGrid';
import { TokenSetup } from './components/TokenSetup';
import { useDashboard } from './hooks/useDashboard';
import { useEventStream } from './hooks/useEventStream';
import type { LiveEvent } from './types';

const MAX_EVENTS = 200;

export function App() {
  const [hasToken, setHasToken] = useState(() => {
    // Also accept ?token= in URL for initial setup
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      import('./api').then(({ saveToken }) => saveToken(urlToken));
      // Remove from URL bar without page reload
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }
    return Boolean(getToken());
  });

  if (!hasToken) {
    return <TokenSetup onSaved={() => setHasToken(true)} />;
  }

  return <Dashboard />;
}

function Dashboard() {
  const { fleet, sites, deviceMap, loading, error, lastUpdated, patchDeviceStatus } =
    useDashboard();

  const [events, setEvents] = useState<LiveEvent[]>([]);

  const handleEvent = useCallback(
    (event: LiveEvent) => {
      // Update device status in the grid when an offline/online event arrives.
      if (event.type === 'device_offline') {
        patchDeviceStatus(event.deviceId, 'offline');
      } else if (event.type === 'device_online') {
        patchDeviceStatus(event.deviceId, 'online');
      } else if (event.type === 'device_degraded') {
        patchDeviceStatus(event.deviceId, 'degraded');
      }

      setEvents((prev) => {
        // Dedup by id
        if (prev.some((e) => e.id === event.id)) return prev;
        const next = [event, ...prev];
        return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
      });
    },
    [patchDeviceStatus],
  );

  useEventStream(handleEvent);

  const deviceName = useCallback(
    (id: string) => deviceMap.get(id)?.name ?? id.slice(0, 8),
    [deviceMap],
  );

  const siteNameMap = new Map(sites.map((s) => [s.site.id, s.site.name]));
  const siteName = useCallback(
    (id: string) => siteNameMap.get(id) ?? id.slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sites],
  );

  if (loading && sites.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)' }}>
        Connecting…
      </div>
    );
  }

  if (error && sites.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.5rem', color: 'var(--offline)' }}>
        <span style={{ fontWeight: 700 }}>Connection error</span>
        <span style={{ color: 'var(--muted)', fontSize: '12px' }}>{error}</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header fleet={fleet} lastUpdated={lastUpdated} />
      <AlertBanner events={events} deviceName={deviceName} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SiteGrid sites={sites} />
        <EventFeed events={events} deviceName={deviceName} siteName={siteName} />
      </div>
    </div>
  );
}

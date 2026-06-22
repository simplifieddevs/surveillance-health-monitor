import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DashboardResponse, Device, Site, SiteWithDevices } from '../types';

interface DashboardState {
  fleet: DashboardResponse['devices'] | null;
  eventCounts: DashboardResponse['events'] | null;
  sites: SiteWithDevices[];
  deviceMap: Map<string, Device>;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export function useDashboard(pollMs = 30_000) {
  const [state, setState] = useState<DashboardState>({
    fleet: null,
    eventCounts: null,
    sites: [],
    deviceMap: new Map(),
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [dashboard, sites, devices] = await Promise.all([
        api.dashboard(),
        api.sites(),
        api.devices(),
      ]);

      const deviceMap = new Map<string, Device>(devices.map((d) => [d.id, d]));

      const siteMap = new Map<string, Site>(sites.map((s) => [s.id, s]));
      const siteDevices = new Map<string, Device[]>();
      for (const d of devices) {
        const arr = siteDevices.get(d.siteId) ?? [];
        arr.push(d);
        siteDevices.set(d.siteId, arr);
      }

      const siteList: SiteWithDevices[] = sites.map((s) => ({
        site: s,
        devices: siteDevices.get(s.id) ?? [],
      }));

      // Also include devices whose siteId has no matching site row.
      for (const [siteId, devs] of siteDevices) {
        if (!siteMap.has(siteId)) {
          siteList.push({ site: { id: siteId, name: 'Unknown Site', timezone: '' }, devices: devs });
        }
      }

      setState({
        fleet: dashboard.devices,
        eventCounts: dashboard.events,
        sites: siteList,
        deviceMap,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (e) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: (e as Error).message,
      }));
    }
  }, []);

  // Update a single device's status in-place (driven by live WS events).
  const patchDeviceStatus = useCallback(
    (deviceId: string, status: Device['status']) => {
      setState((prev) => {
        const device = prev.deviceMap.get(deviceId);
        if (!device || device.status === status) return prev;

        const updated = { ...device, status };
        const newMap = new Map(prev.deviceMap);
        newMap.set(deviceId, updated);

        const newSites = prev.sites.map((sw) => ({
          ...sw,
          devices: sw.devices.map((d) => (d.id === deviceId ? updated : d)),
        }));

        const newFleet = prev.fleet
          ? recalcFleet(Array.from(newMap.values()), prev.fleet)
          : prev.fleet;

        return { ...prev, deviceMap: newMap, sites: newSites, fleet: newFleet };
      });
    },
    [],
  );

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(), pollMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, pollMs]);

  return { ...state, patchDeviceStatus, reload: load };
}

function recalcFleet(
  devices: Device[],
  prev: DashboardResponse['devices'],
): DashboardResponse['devices'] {
  const byStatus = { online: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const d of devices) byStatus[d.status]++;
  return { ...prev, byStatus };
}

export type DeviceStatus = 'online' | 'offline' | 'degraded' | 'unknown';
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Device {
  id: string;
  name: string;
  vendor: string;
  address: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
  siteId: string;
  enabled: boolean;
  vendorConfig: Record<string, unknown>;
}

export interface Site {
  id: string;
  name: string;
  timezone: string;
}

export interface LiveEvent {
  id: string;
  deviceId: string;
  siteId: string;
  type: string;
  severity: EventSeverity;
  detectedAt: string;
  normalizedFields: Record<string, unknown>;
}

export interface FleetSummary {
  total: number;
  byStatus: {
    online: number;
    degraded: number;
    offline: number;
    unknown: number;
  };
}

export interface DashboardResponse {
  generatedAt: string;
  windowHours: number;
  devices: FleetSummary & { tier: unknown };
  events: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

export interface SiteWithDevices {
  site: Site;
  devices: Device[];
}

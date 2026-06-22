import type { DashboardResponse, Device, LiveEvent, Site } from './types';

const TOKEN_KEY = 'ssm_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (res.status === 401) {
    throw new Error('401 Unauthorized — set DISABLE_AUTH=true on the server or provide a token via ?token=');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function request<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    throw new Error('401 Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = `${res.status} ${res.statusText}`;
    try { msg = JSON.parse(text).message ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  dashboard: (windowHours = 24) =>
    get<DashboardResponse>(`/v1/dashboard?windowHours=${windowHours}`),

  sites: () => get<Site[]>('/v1/sites'),

  devices: () => get<Device[]>('/v1/devices'),

  recentEvents: (limitMinutes = 120) => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - limitMinutes * 60_000).toISOString();
    return get<LiveEvent[]>(`/v1/events?from=${from}&to=${to}&limit=100`);
  },

  createSite: (body: { name: string; timezone?: string }) =>
    request<Site>('POST', '/v1/sites', body),

  createDevice: (body: {
    siteId: string;
    name: string;
    vendor: string;
    address: string;
    credentials: { username?: string; password?: string };
    vendorConfig?: { httpPort?: number; serverPort?: number };
  }) => request<Device>('POST', '/v1/devices', body),

  updateSite: (id: string, body: { name?: string; timezone?: string }) =>
    request<Site>('PATCH', `/v1/sites/${id}`, body),

  testConnectivity: (body: {
    vendor: string;
    address: string;
    vendorConfig?: Record<string, unknown>;
    credentials?: { username?: string; password?: string };
  }) => request<{ ok: boolean; latencyMs: number; reason?: string }>(
    'POST', '/v1/devices/connectivity-test', body
  ),

  testSavedDevice: (id: string) =>
    request<{ ok: boolean; latencyMs: number; reason?: string }>(
      'POST', `/v1/devices/${id}/test`, {}
    ),

  updateDevice: (
    id: string,
    body: {
      name?: string;
      address?: string;
      vendorConfig?: Record<string, unknown>;
      enabled?: boolean;
      credentials?: { username?: string; password?: string };
    },
  ) => request<Device>('PATCH', `/v1/devices/${id}`, body),
};

export function buildWsUrl(): string {
  const token = getToken() ?? '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/v1/events/stream?token=${encodeURIComponent(token)}`;
}

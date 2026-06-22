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

async function get<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    // Don't auto-reload — let the UI show an auth error instead.
    throw new Error('401 Unauthorized — set DISABLE_AUTH=true on the server or provide a token via ?token=');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
};

export function buildWsUrl(): string {
  const token = getToken() ?? '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/v1/events/stream?token=${encodeURIComponent(token)}`;
}

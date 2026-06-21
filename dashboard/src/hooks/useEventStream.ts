import { useEffect, useRef } from 'react';
import { buildWsUrl } from '../api';
import type { LiveEvent } from '../types';

export function useEventStream(onEvent: (event: LiveEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    function connect() {
      if (dead) return;
      ws = new WebSocket(buildWsUrl());

      ws.onopen = () => {
        // Small debounce — server sends `subscribed` first; we'll backfill from there.
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(e.data) as Record<string, unknown>;
          if (msg.type === 'subscribed' && typeof msg.since === 'string') {
            // Backfill the gap since 5 min before subscribe to catch anything
            // that landed between our page load and the WS ACK.
            const since = new Date(
              Math.max(
                new Date(msg.since).getTime() - 5 * 60_000,
                Date.now() - 2 * 60 * 60_000, // cap at 2h
              ),
            ).toISOString();
            ws?.send(JSON.stringify({ since }));
            return;
          }
          if (msg.type === 'backfill' && Array.isArray(msg.events)) {
            for (const ev of msg.events as LiveEvent[]) onEventRef.current(ev);
            return;
          }
          if (msg.error) return; // server-side error, ignore
          // Live event object
          if (msg.id && msg.type && msg.severity) {
            onEventRef.current(msg as unknown as LiveEvent);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!dead) reconnectTimer = setTimeout(connect, 4_000);
      };

      ws.onerror = () => ws?.close();
    }

    connect();

    return () => {
      dead = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}

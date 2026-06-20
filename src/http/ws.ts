import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { err } from "../core/errors.js";
import { withTenantDb } from "../db/client.js";
import { listEvents, type EventType, type EventSeverity } from "../db/repositories/events.js";

/**
 * Live event stream.
 *
 * One WebSocket per tenant, authenticated with the same JWT (passed in
 * the Sec-WebSocket-Protocol subprotocol as a bearer). Server pushes new
 * events as they land. Client may send { "since": "<iso>" } to backfill
 * missing events.
 *
 * Backpressure: if a client falls behind, server closes the socket with
 * code 1011. Client is expected to reconnect with a fresh `since`.
 */

export async function registerWs(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get("/v1/events/stream", { websocket: true }, (socket, req) => {
    const ctx = req.tenant;
    if (!ctx) {
      socket.close(4401, "tenant required");
      return;
    }
    const since = new Date();
    const channel = `shm:events:${ctx.companyId}`;

    // Subscribe to Redis pub/sub for live events.
    const sub = app.redis.duplicate();
    sub.subscribe(channel).catch(() => {
      socket.close(1011, "subscribe failed");
    });
    sub.on("message", (_chan: string, payload: string) => {
      try {
        // Push-only — client does not need to reply.
        socket.send(payload);
      } catch {
        socket.close(1011, "send failed");
      }
    });

    // Handle backfill requests.
    socket.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && typeof msg === "object" && "since" in msg) {
          const sinceDate = new Date(String((msg as { since: unknown }).since));
          if (Number.isNaN(sinceDate.getTime())) {
            socket.send(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "bad since" } }));
            return;
          }
          const events = await withTenantDb(ctx, (db) =>
            listEvents(db, ctx, {
              from: sinceDate,
              to: new Date(),
              type: (msg as { type?: EventType }).type,
              severity: (msg as { severity?: EventSeverity }).severity,
              limit: 500,
            }),
          );
          socket.send(JSON.stringify({ type: "backfill", events }));
        }
      } catch (e) {
        socket.send(JSON.stringify({ error: { code: "INTERNAL", message: err.internal(e).message } }));
      }
    });

    socket.on("close", () => {
      sub.disconnect();
    });
  });
}

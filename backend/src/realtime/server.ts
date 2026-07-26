import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { db } from '../db/index';
import { subscribe, unsubscribe, type Subscription } from './hub';

const HEARTBEAT_INTERVAL_MS = 30_000;

interface SubscribeMessage {
  type: 'subscribe';
  matchId: string;
  /** Present on reconnect: replay deliveries after this sequence for this innings. */
  inningsId?: string;
  sinceSequence?: number;
}

function isSubscribeMessage(value: unknown): value is SubscribeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === 'subscribe' && typeof v.matchId === 'string';
}

interface ClientState {
  isAlive: boolean;
  subscription?: Subscription;
}

/** Read-only realtime fan-out at /ws. Clients subscribe to match:{id}; all writes go through the REST API. */
export function attachRealtimeServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clientStates = new WeakMap<WebSocket, ClientState>();

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const state = clientStates.get(ws);
      if (!state) continue;
      if (!state.isAlive) {
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocket) => {
    const state: ClientState = { isAlive: true };
    clientStates.set(ws, state);

    ws.on('pong', () => {
      state.isAlive = true;
    });

    ws.on('message', async (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
        return;
      }

      if (!isSubscribeMessage(message)) {
        ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
        return;
      }

      if (state.subscription) unsubscribe(state.subscription);
      state.subscription = subscribe(ws, message.matchId);

      if (message.inningsId && typeof message.sinceSequence === 'number') {
        const missed = await db
          .selectFrom('deliveries')
          .selectAll()
          .where('innings_id', '=', message.inningsId)
          .where('sequence', '>', message.sinceSequence)
          .where('voided_at', 'is', null)
          .orderBy('sequence', 'asc')
          .execute();

        for (const row of missed) {
          ws.send(
            JSON.stringify({
              type: 'delivery',
              matchId: message.matchId,
              inningsId: message.inningsId,
              delivery: row,
              totals: null,
              striker: null,
              nonStriker: null,
              bowler: null,
              replay: true,
            }),
          );
        }
      }

      ws.send(JSON.stringify({ type: 'subscribed', matchId: message.matchId }));
    });

    ws.on('close', () => {
      if (state.subscription) unsubscribe(state.subscription);
    });
  });

  return wss;
}

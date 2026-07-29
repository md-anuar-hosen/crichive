import type { WebSocket } from 'ws';

export interface Subscription {
  ws: WebSocket;
  matchId: string;
}

const subscriptions = new Set<Subscription>();

export function subscribe(ws: WebSocket, matchId: string): Subscription {
  const sub: Subscription = { ws, matchId };
  subscriptions.add(sub);
  return sub;
}

export function unsubscribe(sub: Subscription): void {
  subscriptions.delete(sub);
}

export interface DeliveryDelta {
  type: 'delivery';
  matchId: string;
  inningsId: string;
  delivery: unknown;
  totals: { runs: number; wickets: number; legalBalls: number; extras: number } | null;
  striker: unknown;
  nonStriker: unknown;
  bowler: unknown;
  replay?: boolean;
}

/** Read-only fan-out: clients never write through this channel, only the REST API does. */
export function broadcastDelivery(delta: DeliveryDelta): void {
  const payload = JSON.stringify(delta);
  for (const sub of subscriptions) {
    if (sub.matchId === delta.matchId && sub.ws.readyState === sub.ws.OPEN) {
      sub.ws.send(payload);
    }
  }
}

export interface InterruptionDelta {
  type: 'interruption';
  matchId: string;
  inningsId: string;
  inningsNumber: number;
  maxOvers: number;
  revisedTarget: number | null;
  interruption: unknown;
}

/** Same read-only fan-out as broadcastDelivery, for CricHive Rain Rule updates. */
export function broadcastInterruption(delta: InterruptionDelta): void {
  const payload = JSON.stringify(delta);
  for (const sub of subscriptions) {
    if (sub.matchId === delta.matchId && sub.ws.readyState === sub.ws.OPEN) {
      sub.ws.send(payload);
    }
  }
}

import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';
import { attachRealtimeServer } from '../src/realtime/server';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once('close', () => resolve()));
}

/** Collects parsed JSON messages of the given type until `count` have arrived, or times out. */
function collectMessages(ws: WebSocket, type: string, count: number, timeoutMs = 10000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const received: any[] = [];
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${count} "${type}" messages; got ${received.length}`));
    }, timeoutMs);

    function onMessage(raw: WebSocket.RawData) {
      const message = JSON.parse(raw.toString());
      if (message.type === type) {
        received.push(message);
        if (received.length >= count) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve(received);
        }
      }
    }
    ws.on('message', onMessage);
  });
}

describe('realtime WebSocket layer (Phase 7)', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const p1 = randomUUID();
  const p2 = randomUUID();
  const p3 = randomUUID();
  const p4 = randomUUID();
  const matchId = randomUUID();

  let token: string;
  let httpServer: ReturnType<typeof createServer>;
  let wsUrl: string;
  let inningsId: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values({ id: organizerId, email: `organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' })
      .execute();
    await db
      .insertInto('tournaments')
      .values({ id: tournamentId, name: 'Realtime Test', season_year: 2026, slug: `realtime-test-${tournamentId}` })
      .execute();
    await db
      .insertInto('tournament_rules')
      .values({ tournament_id: tournamentId, overs_per_innings: 3, max_overs_per_bowler: 3, players_per_side: 2 })
      .execute();
    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();
    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Realtime A', short_name: 'RTA' },
        { id: teamBId, name: 'Realtime B', short_name: 'RTB' },
      ])
      .execute();
    await db
      .insertInto('tournament_teams')
      .values([
        { tournament_id: tournamentId, team_id: teamAId },
        { tournament_id: tournamentId, team_id: teamBId },
      ])
      .execute();
    await db
      .insertInto('players')
      .values([
        { id: p1, full_name: 'RT Player One' },
        { id: p2, full_name: 'RT Player Two' },
        { id: p3, full_name: 'RT Player Three' },
        { id: p4, full_name: 'RT Player Four' },
      ])
      .execute();
    await db
      .insertInto('team_squads')
      .values([
        { tournament_id: tournamentId, team_id: teamAId, player_id: p1 },
        { tournament_id: tournamentId, team_id: teamAId, player_id: p2 },
        { tournament_id: tournamentId, team_id: teamBId, player_id: p3 },
        { tournament_id: tournamentId, team_id: teamBId, player_id: p4 },
      ])
      .execute();
    await db
      .insertInto('matches')
      .values({ id: matchId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 1 })
      .execute();

    token = signAuthToken({ sub: organizerId, is_platform_admin: false });

    const toss = await request(app).post(`/matches/${matchId}/toss`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: teamAId, decision: 'bat' });
    inningsId = toss.body.innings.id;
    await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
    await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamBId, player_ids: [p3, p4], captain_id: p3, keeper_id: p4 });

    httpServer = createServer();
    attachRealtimeServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await db.deleteFrom('deliveries').where('innings_id', '=', inningsId).execute();
    await db.deleteFrom('innings_totals').where('innings_id', '=', inningsId).execute();
    await db.deleteFrom('batting_cards').where('innings_id', '=', inningsId).execute();
    await db.deleteFrom('bowling_cards').where('innings_id', '=', inningsId).execute();
    await db.deleteFrom('partnerships').where('innings_id', '=', inningsId).execute();
    await db.deleteFrom('innings').where('match_id', '=', matchId).execute();
    await db.deleteFrom('match_players').where('match_id', '=', matchId).execute();
    await db.deleteFrom('matches').where('id', '=', matchId).execute();
    await db.deleteFrom('team_squads').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('players').where('id', 'in', [p1, p2, p3, p4]).execute();
    await db.deleteFrom('tournament_teams').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamAId, teamBId]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', '=', organizerId).execute();
    await db.deleteFrom('users').where('id', '=', organizerId).execute();
  });

  let ballsBowledSoFar = 0;

  async function postDelivery(runs: number) {
    // Alternate bowlers every 6 legal balls — a bowler may not bowl consecutive overs.
    const bowlerId = Math.floor(ballsBowledSoFar / 6) % 2 === 0 ? p3 : p4;
    ballsBowledSoFar += 1;

    const res = await request(app)
      .post(`/matches/${matchId}/deliveries`)
      .set('Authorization', `Bearer ${token}`)
      .send({ client_event_id: randomUUID(), innings_number: 1, striker_id: p1, non_striker_id: p2, bowler_id: bowlerId, runs_off_bat: runs });
    expect(res.status).toBe(201);
    return res.body.delivery;
  }

  it(
    'delivers every ball in order to subscribers, and replays exactly the missed balls on reconnect',
    async () => {
      const clientA = new WebSocket(wsUrl);
      const clientB = new WebSocket(wsUrl);
      await Promise.all([waitForOpen(clientA), waitForOpen(clientB)]);

      const aSubscribed = collectMessages(clientA, 'subscribed', 1);
      const bSubscribed = collectMessages(clientB, 'subscribed', 1);
      clientA.send(JSON.stringify({ type: 'subscribe', matchId }));
      clientB.send(JSON.stringify({ type: 'subscribe', matchId }));
      await Promise.all([aSubscribed, bSubscribed]);

      const aFirstThree = collectMessages(clientA, 'delivery', 3);
      const bFirstThree = collectMessages(clientB, 'delivery', 3);
      await postDelivery(0);
      await postDelivery(1);
      await postDelivery(4);
      const [aMsgs, bMsgs] = await Promise.all([aFirstThree, bFirstThree]);

      const aSequences = aMsgs.map((m) => m.delivery.sequence);
      const bSequences = bMsgs.map((m) => m.delivery.sequence);
      expect(aSequences).toEqual([0, 1, 2]);
      expect(bSequences).toEqual([0, 1, 2]);

      // Client A disconnects; client B stays live for 5 more balls.
      clientA.close();
      await waitForClose(clientA);

      const bNextFive = collectMessages(clientB, 'delivery', 5);
      for (let i = 0; i < 5; i++) await postDelivery(0);
      const bMissed = await bNextFive;
      expect(bMissed.map((m) => m.delivery.sequence)).toEqual([3, 4, 5, 6, 7]);

      // Client A reconnects, reporting the last sequence it saw (2), and should
      // receive exactly the 5 it missed — no more, no less.
      const clientA2 = new WebSocket(wsUrl);
      await waitForOpen(clientA2);
      const replay = collectMessages(clientA2, 'delivery', 5);
      const subscribedAgain = collectMessages(clientA2, 'subscribed', 1);
      clientA2.send(JSON.stringify({ type: 'subscribe', matchId, inningsId, sinceSequence: 2 }));
      const [replayed] = await Promise.all([replay, subscribedAgain]);

      expect(replayed.map((m) => m.delivery.sequence)).toEqual([3, 4, 5, 6, 7]);
      expect(replayed.every((m) => m.replay === true)).toBe(true);

      clientB.close();
      clientA2.close();
      await Promise.all([waitForClose(clientB), waitForClose(clientA2)]);
    },
    30000,
  );
});

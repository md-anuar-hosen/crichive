import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';
import { computeRevisedTarget, resourceAvailablePercent } from '../src/domain/rainRule';

describe('CricHive Rain Rule (Phase E)', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const p1 = randomUUID(); // team A striker
  const p2 = randomUUID(); // team A non-striker
  const p3 = randomUUID(); // team B bowler in innings 1, striker in innings 2
  const p4 = randomUUID(); // team B non-striker in innings 1, bowler in innings 2
  const matchId = randomUUID();

  const OVERS_PER_INNINGS = 2;
  let token: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values({ id: organizerId, email: `rain-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' })
      .execute();

    await db
      .insertInto('tournaments')
      .values({ id: tournamentId, name: 'Rain Rule Test', season_year: 2026, slug: `rain-rule-test-${tournamentId}` })
      .execute();

    await db
      .insertInto('tournament_rules')
      .values({
        tournament_id: tournamentId,
        overs_per_innings: OVERS_PER_INNINGS,
        max_overs_per_bowler: OVERS_PER_INNINGS,
        players_per_side: 2,
        dls_enabled: true,
      })
      .execute();

    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();

    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Rain A', short_name: 'RNA' },
        { id: teamBId, name: 'Rain B', short_name: 'RNB' },
      ])
      .execute();

    await db
      .insertInto('players')
      .values([
        { id: p1, full_name: 'Rain Player One' },
        { id: p2, full_name: 'Rain Player Two' },
        { id: p3, full_name: 'Rain Player Three' },
        { id: p4, full_name: 'Rain Player Four' },
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
  });

  afterAll(async () => {
    await db.deleteFrom('match_interruptions').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('deliveries').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('innings_totals').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('batting_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('bowling_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('partnerships').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('innings').where('match_id', '=', matchId).execute();
    await db.deleteFrom('match_players').where('match_id', '=', matchId).execute();
    await db.deleteFrom('matches').where('id', '=', matchId).execute();
    await db.deleteFrom('player_career_stats').where('player_id', 'in', [p1, p2, p3, p4]).execute();
    await db.deleteFrom('team_squads').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('players').where('id', 'in', [p1, p2, p3, p4]).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamAId, teamBId]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', '=', organizerId).execute();
    await db.deleteFrom('users').where('id', '=', organizerId).execute();
  });

  // Many sequential HTTP + DB round trips against a remote Neon instance; keep the
  // ball count low and the timeout generous (default 5s is far too tight).
  it(
    'records a rain interruption and revises the chasing target using the resource-ratio formula',
    async () => {
      const toss = await request(app).post(`/matches/${matchId}/toss`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: teamAId, decision: 'bat' });
      expect(toss.status).toBe(201);

      await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
      await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamBId, player_ids: [p3, p4], captain_id: p3, keeper_id: p4 });

      // Innings 1: uninterrupted, 2 overs (12 balls) of 2 runs each = 24 runs.
      // Bowlers alternate each over (p3/p4) — a bowler may not bowl consecutive overs.
      for (let i = 0; i < OVERS_PER_INNINGS * 6; i++) {
        const over = Math.floor(i / 6);
        const bowlerId = over % 2 === 0 ? p3 : p4;
        const res = await request(app)
          .post(`/matches/${matchId}/deliveries`)
          .set('Authorization', `Bearer ${token}`)
          .send({ client_event_id: randomUUID(), innings_number: 1, striker_id: p1, non_striker_id: p2, bowler_id: bowlerId, runs_off_bat: 2 });
        expect(res.status).toBe(201);
      }

      const closeInnings1 = await request(app).post(`/matches/${matchId}/innings/1/close`).set('Authorization', `Bearer ${token}`).send({});
      expect(closeInnings1.status).toBe(200);

      // Innings 2: bowl half an over (3 balls) before the rain arrives.
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post(`/matches/${matchId}/deliveries`)
          .set('Authorization', `Bearer ${token}`)
          .send({ client_event_id: randomUUID(), innings_number: 2, striker_id: p3, non_striker_id: p4, bowler_id: p1, runs_off_bat: 1 });
        expect(res.status).toBe(201);
      }
      // 3 legal balls bowled out of a 2-over (12-ball) innings: 1.5 overs remain.

      const interruption = await request(app)
        .post(`/matches/${matchId}/innings/2/interruption`)
        .set('Authorization', `Bearer ${token}`)
        .send({ overs_remaining_after: 0.5, reason: 'Rain stoppage for integration test' });
      expect(interruption.status).toBe(201);
      expect(interruption.body.max_overs).toBeCloseTo(1, 5); // 0.5 overs bowled + 0.5 remaining

      const expectedSecondResource = resourceAvailablePercent(
        [{ oversRemainingBefore: 1.5, oversRemainingAfter: 0.5, wicketsLostAt: 0 }],
        OVERS_PER_INNINGS,
      );
      const expectedTarget = computeRevisedTarget({
        firstInningsRuns: 24,
        firstInningsResourcePercent: 100,
        secondInningsResourcePercent: expectedSecondResource,
      });
      expect(interruption.body.revised_target).toBe(expectedTarget);
      expect(expectedTarget).toBeLessThan(25); // less overs left => easier target than the original 25

      const scorecard = await request(app).get(`/matches/${matchId}/scorecard`);
      expect(scorecard.status).toBe(200);
      const inningsTwo = scorecard.body.innings.find((inn: { innings_number: number }) => inn.innings_number === 2);
      expect(inningsTwo.target).toBe(expectedTarget);
      expect(Number(inningsTwo.max_overs)).toBeCloseTo(1, 5);
      expect(inningsTwo.interruptions).toHaveLength(1);
      expect(inningsTwo.interruptions[0]).toMatchObject({
        overs_remaining_before: 1.5,
        overs_remaining_after: 0.5,
        wickets_lost_at: 0,
        reason: 'Rain stoppage for integration test',
      });
    },
    60000,
  );

  it('blocks the interruption endpoint when dls_enabled is false', async () => {
    await db.updateTable('tournament_rules').set({ dls_enabled: false }).where('tournament_id', '=', tournamentId).execute();

    const res = await request(app)
      .post(`/matches/${matchId}/innings/2/interruption`)
      .set('Authorization', `Bearer ${token}`)
      .send({ overs_remaining_after: 0 });
    expect(res.status).toBe(409);

    await db.updateTable('tournament_rules').set({ dls_enabled: true }).where('tournament_id', '=', tournamentId).execute();
  });
});

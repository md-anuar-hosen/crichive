import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Match/tournament awards (dismissal text, Player of the Match/Tournament)', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const p1 = randomUUID(); // team A — scores every run and takes the only wicket
  const p2 = randomUUID(); // team A — takes the catch
  const p3 = randomUUID(); // team B — dismissed for a duck
  const p4 = randomUUID(); // team B — non-striker, never faces a ball
  const matchId = randomUUID();
  const slug = `awards-test-${tournamentId}`;

  const OVERS_PER_INNINGS = 1;
  let token: string;
  let p1Name: string;
  let p2Name: string;

  beforeAll(async () => {
    p1Name = 'Awards Player One';
    p2Name = 'Awards Player Two';

    await db
      .insertInto('users')
      .values({ id: organizerId, email: `awards-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' })
      .execute();

    await db.insertInto('tournaments').values({ id: tournamentId, name: 'Awards Test', season_year: 2026, slug }).execute();

    await db
      .insertInto('tournament_rules')
      .values({ tournament_id: tournamentId, overs_per_innings: OVERS_PER_INNINGS, max_overs_per_bowler: OVERS_PER_INNINGS, players_per_side: 2 })
      .execute();

    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();

    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Awards A', short_name: 'AWA' },
        { id: teamBId, name: 'Awards B', short_name: 'AWB' },
      ])
      .execute();

    await db
      .insertInto('players')
      .values([
        { id: p1, full_name: p1Name },
        { id: p2, full_name: p2Name },
        { id: p3, full_name: 'Awards Player Three' },
        { id: p4, full_name: 'Awards Player Four' },
      ])
      .execute();

    await db
      .insertInto('team_squads')
      .values([
        { tournament_id: tournamentId, team_id: teamAId, player_id: p1, approved_at: new Date() },
        { tournament_id: tournamentId, team_id: teamAId, player_id: p2, approved_at: new Date() },
        { tournament_id: tournamentId, team_id: teamBId, player_id: p3, approved_at: new Date() },
        { tournament_id: tournamentId, team_id: teamBId, player_id: p4, approved_at: new Date() },
      ])
      .execute();

    await db.insertInto('matches').values({ id: matchId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 1 }).execute();

    token = signAuthToken({ sub: organizerId, is_platform_admin: false });
  });

  afterAll(async () => {
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

  it(
    'shows a proper "c X b Y" dismissal, auto-picks Player of the Match, and reports Player of the Tournament + leaderboards',
    async () => {
      const toss = await request(app).post(`/matches/${matchId}/toss`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: teamAId, decision: 'bat' });
      expect(toss.status).toBe(201);

      await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
      await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamBId, player_ids: [p3, p4], captain_id: p3, keeper_id: p4 });

      // Innings 1: p1 faces every ball (even run values keep strike unchanged), scores all 12 runs.
      for (let i = 0; i < OVERS_PER_INNINGS * 6; i++) {
        const res = await request(app)
          .post(`/matches/${matchId}/deliveries`)
          .set('Authorization', `Bearer ${token}`)
          .send({ client_event_id: randomUUID(), innings_number: 1, striker_id: p1, non_striker_id: p2, bowler_id: p3, runs_off_bat: 2 });
        expect(res.status).toBe(201);
      }

      const closeInnings1 = await request(app).post(`/matches/${matchId}/innings/1/close`).set('Authorization', `Bearer ${token}`).send({});
      expect(closeInnings1.status).toBe(200);

      // Innings 2: p3 is out first ball, caught by p2 off p1 — team B all out for 0 (players_per_side: 2 means 1 wicket ends the innings).
      const wicketBall = await request(app)
        .post(`/matches/${matchId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          client_event_id: randomUUID(),
          innings_number: 2,
          striker_id: p3,
          non_striker_id: p4,
          bowler_id: p1,
          runs_off_bat: 0,
          wicket_kind: 'caught',
          player_out_id: p3,
          fielder_id: p2,
        });
      expect(wicketBall.status).toBe(201);

      const closeInnings2 = await request(app).post(`/matches/${matchId}/innings/2/close`).set('Authorization', `Bearer ${token}`).send({});
      expect(closeInnings2.status).toBe(200);
      expect(closeInnings2.body.outcome).toEqual({ kind: 'batting_first_won', marginRuns: 12 });

      const scorecard = await request(app).get(`/matches/${matchId}/scorecard`);
      expect(scorecard.status).toBe(200);
      expect(scorecard.body.result).toBe('team_a_won');
      expect(scorecard.body.win_margin_runs).toBe(12);

      // Dismissal text is properly formatted with real bowler/fielder names, not the bare enum value.
      const inningsTwo = scorecard.body.innings.find((inn: { innings_number: number }) => inn.innings_number === 2);
      const p3Row = inningsTwo.batting.find((b: { id: string }) => b.id === p3);
      expect(p3Row.is_out).toBe(true);
      expect(p3Row.dismissal_text).toBe(`c ${p2Name} b ${p1Name}`);

      // Player of the Match: p1 scored 12 runs and took the only wicket — an easy pick.
      expect(scorecard.body.player_of_match).toEqual({ id: p1, name: p1Name });

      // Player of the Tournament + leaderboards, same story since this is the only match.
      const awards = await request(app).get(`/tournaments/${slug}/awards`);
      expect(awards.status).toBe(200);
      expect(awards.body.player_of_tournament).toEqual({ id: p1, name: p1Name });
      expect(awards.body.most_runs[0]).toMatchObject({ id: p1, name: p1Name, runs: 12 });
      expect(awards.body.most_wickets[0]).toMatchObject({ id: p1, name: p1Name, wickets: 1 });
    },
    60000,
  );
});

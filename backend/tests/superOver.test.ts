import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Super Over', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const p1 = randomUUID(); // Team A opener / bowler
  const p2 = randomUUID(); // Team A opener
  const p3 = randomUUID(); // Team B opener / bowler
  const p4 = randomUUID(); // Team B opener
  const matchId = randomUUID();

  let token: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values({ id: organizerId, email: `organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' })
      .execute();

    await db
      .insertInto('tournaments')
      .values({ id: tournamentId, name: 'Super Over Test', season_year: 2026, slug: `super-over-test-${tournamentId}` })
      .execute();

    await db
      .insertInto('tournament_rules')
      .values({
        tournament_id: tournamentId,
        overs_per_innings: 1,
        max_overs_per_bowler: 1,
        players_per_side: 2,
        super_over_on_tie: true,
      })
      .execute();

    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();

    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Super Over Team A', short_name: 'SOA' },
        { id: teamBId, name: 'Super Over Team B', short_name: 'SOB' },
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
        { id: p1, full_name: 'Super Over Player One' },
        { id: p2, full_name: 'Super Over Player Two' },
        { id: p3, full_name: 'Super Over Player Three' },
        { id: p4, full_name: 'Super Over Player Four' },
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

    await db
      .insertInto('matches')
      .values({ id: matchId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 1 })
      .execute();

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
    await db.deleteFrom('tournament_teams').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamAId, teamBId]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', '=', organizerId).execute();
    await db.deleteFrom('users').where('id', '=', organizerId).execute();
  });

  async function bowlOver(inningsNumber: number, strikerId: string, nonStrikerId: string, bowlerId: string, runs: number[]) {
    for (const r of runs) {
      const res = await request(app)
        .post(`/matches/${matchId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .send({ client_event_id: randomUUID(), innings_number: inningsNumber, striker_id: strikerId, non_striker_id: nonStrikerId, bowler_id: bowlerId, runs_off_bat: r });
      expect(res.status).toBe(201);
    }
  }

  it('ties the main match, plays a Super Over, and decides the match on it', async () => {
    const toss = await request(app).post(`/matches/${matchId}/toss`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: teamAId, decision: 'bat' });
    expect(toss.status).toBe(201);

    await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
    await request(app).post(`/matches/${matchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamBId, player_ids: [p3, p4], captain_id: p3, keeper_id: p4 });

    // Innings 1: Team A bats (10 runs), Team B bowls.
    await bowlOver(1, p1, p2, p3, [0, 1, 2, 3, 0, 4]);
    const close1 = await request(app).post(`/matches/${matchId}/innings/1/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close1.status).toBe(200);
    expect(close1.body.next_innings_number).toBe(2);

    // Innings 2: Team B bats, ties at 10.
    await bowlOver(2, p3, p4, p1, [1, 2, 3, 0, 4, 0]);
    const close2 = await request(app).post(`/matches/${matchId}/innings/2/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close2.status).toBe(200);
    expect(close2.body.super_over).toBe(true);
    expect(close2.body.next_innings_number).toBe(3);

    const matchAfterTie = await db.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(matchAfterTie.status).toBe('super_over');
    expect(matchAfterTie.result).toBeNull();

    // Super Over innings 3: the ICC rule is that the side that bowled
    // second in the main match (here, Team A, who bowled during the chase
    // in innings 2) bats first in the Super Over — i.e. the same order as
    // the main match's innings 2, not innings 1.
    const innings3 = await db.selectFrom('innings').selectAll().where('match_id', '=', matchId).where('innings_number', '=', 3).executeTakeFirstOrThrow();
    expect(innings3.is_super_over).toBe(true);
    expect(innings3.batting_team_id).toBe(teamBId);
    expect(innings3.bowling_team_id).toBe(teamAId);
    expect(Number(innings3.max_overs)).toBe(1);

    // Team B bats again in the Super Over, scores 8.
    await bowlOver(3, p3, p4, p1, [2, 1, 0, 3, 2, 0]);
    const close3 = await request(app).post(`/matches/${matchId}/innings/3/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close3.status).toBe(200);
    expect(close3.body.next_innings_number).toBe(4);

    const innings4 = await db.selectFrom('innings').selectAll().where('match_id', '=', matchId).where('innings_number', '=', 4).executeTakeFirstOrThrow();
    expect(innings4.is_super_over).toBe(true);
    expect(innings4.batting_team_id).toBe(teamAId);
    expect(innings4.bowling_team_id).toBe(teamBId);
    expect(innings4.target).toBe(9);

    // Team A chases 9 in the Super Over, reaching it exactly on the last
    // ball — reaching it any earlier would 422 on the next ball (the
    // deliveries route rejects further balls once the innings is complete).
    await bowlOver(4, p1, p2, p3, [1, 1, 1, 1, 1, 4]);
    const close4 = await request(app).post(`/matches/${matchId}/innings/4/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close4.status).toBe(200);

    const finalMatch = await db.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(finalMatch.status).toBe('completed');
    expect(finalMatch.result).toBe('team_a_won');
    expect(finalMatch.winner_team_id).toBe(teamAId);
    expect(finalMatch.result_note).toContain('Super Over');
  }, 90000);
});

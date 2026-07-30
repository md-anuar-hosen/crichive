import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Test match lifecycle', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const p1 = randomUUID(); // Team A
  const p2 = randomUUID(); // Team A
  const p3 = randomUUID(); // Team B
  const p4 = randomUUID(); // Team B
  const decisiveMatchId = randomUUID();
  const dayMatchId = randomUUID();
  const stageId = randomUUID();
  const groupId = randomUUID();

  let token: string;

  beforeAll(async () => {
    await db.insertInto('users').values({ id: organizerId, email: `test-match-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' }).execute();
    await db.insertInto('tournaments').values({ id: tournamentId, name: 'Test Match Fixture', season_year: 2026, slug: `test-match-fixture-${tournamentId}` }).execute();
    await db
      .insertInto('tournament_rules')
      .values({
        tournament_id: tournamentId,
        match_type: 'test',
        overs_per_innings: null,
        max_overs_per_bowler: null,
        players_per_side: 2,
        days_per_match: 3,
        follow_on_enabled: true,
        follow_on_margin: 5,
        points_win: 12,
        points_draw: 4,
        points_tie: 6,
        points_no_result: 2,
        points_loss: 0,
      })
      .execute();
    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();
    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Test Match Team A', short_name: 'TMA' },
        { id: teamBId, name: 'Test Match Team B', short_name: 'TMB' },
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
        { id: p1, full_name: 'Test Match Player One' },
        { id: p2, full_name: 'Test Match Player Two' },
        { id: p3, full_name: 'Test Match Player Three' },
        { id: p4, full_name: 'Test Match Player Four' },
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

    await db.insertInto('stages').values({ id: stageId, tournament_id: tournamentId, kind: 'group', name: 'Group Stage', sequence: 1 }).execute();
    await db.insertInto('groups').values({ id: groupId, stage_id: stageId, name: 'Group A' }).execute();
    await db
      .insertInto('group_teams')
      .values([
        { group_id: groupId, team_id: teamAId },
        { group_id: groupId, team_id: teamBId },
      ])
      .execute();

    await db.insertInto('matches').values({ id: decisiveMatchId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 1 }).execute();
    await db
      .insertInto('matches')
      .values({ id: dayMatchId, tournament_id: tournamentId, group_id: groupId, stage_id: stageId, team_a_id: teamAId, team_b_id: teamBId, match_number: 2 })
      .execute();

    token = signAuthToken({ sub: organizerId, is_platform_admin: false });
  });

  afterAll(async () => {
    for (const matchId of [decisiveMatchId, dayMatchId]) {
      await db.deleteFrom('deliveries').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('innings_totals').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('batting_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('bowling_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('partnerships').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('innings').where('match_id', '=', matchId).execute();
      await db.deleteFrom('match_players').where('match_id', '=', matchId).execute();
    }
    await db.deleteFrom('matches').where('id', 'in', [decisiveMatchId, dayMatchId]).execute();
    await db.deleteFrom('standings').where('group_id', '=', groupId).execute();
    await db.deleteFrom('group_teams').where('group_id', '=', groupId).execute();
    await db.deleteFrom('groups').where('id', '=', groupId).execute();
    await db.deleteFrom('stages').where('id', '=', stageId).execute();
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

  async function bowl(matchId: string, inningsNumber: number, strikerId: string, nonStrikerId: string, bowlerId: string, balls: { runs?: number; wicket?: boolean }[]) {
    for (const ball of balls) {
      const res = await request(app)
        .post(`/matches/${matchId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          client_event_id: randomUUID(),
          innings_number: inningsNumber,
          striker_id: strikerId,
          non_striker_id: nonStrikerId,
          bowler_id: bowlerId,
          runs_off_bat: ball.runs ?? 0,
          ...(ball.wicket ? { wicket_kind: 'bowled', player_out_id: strikerId } : {}),
        });
      expect(res.status).toBe(201);
    }
  }

  it('plays a follow-on to an innings win, with no Super Over and no innings 4', async () => {
    const toss = await request(app).post(`/matches/${decisiveMatchId}/toss`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: teamAId, decision: 'bat' });
    expect(toss.status).toBe(201);

    await request(app).post(`/matches/${decisiveMatchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
    await request(app).post(`/matches/${decisiveMatchId}/playing-xi`).set('Authorization', `Bearer ${token}`).send({ team_id: teamBId, player_ids: [p3, p4], captain_id: p3, keeper_id: p4 });

    // Innings 1: Team A all out for 16 (1 wicket ends it with players_per_side: 2).
    await bowl(decisiveMatchId, 1, p1, p2, p3, [{ runs: 4 }, { runs: 4 }, { runs: 4 }, { runs: 4 }, { wicket: true }]);
    const close1 = await request(app).post(`/matches/${decisiveMatchId}/innings/1/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close1.status).toBe(200);
    expect(close1.body.next_innings_number).toBe(2);
    expect(close1.body.declared).toBe(false);

    // Innings 2: Team B all out for 1 -- a 15-run deficit clears the (test) 5-run follow-on margin.
    await bowl(decisiveMatchId, 2, p3, p4, p1, [{ runs: 1 }, { wicket: true }]);
    const close2 = await request(app).post(`/matches/${decisiveMatchId}/innings/2/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close2.status).toBe(200);
    expect(close2.body.awaiting_next_innings).toBe(true);

    const scorecardAfterInnings2 = await request(app).get(`/matches/${decisiveMatchId}/scorecard`);
    expect(scorecardAfterInnings2.body.follow_on_available).toBe(true);

    const missingDecision = await request(app).post(`/matches/${decisiveMatchId}/next-innings`).set('Authorization', `Bearer ${token}`).send({});
    expect(missingDecision.status).toBe(400);

    const nextInnings = await request(app).post(`/matches/${decisiveMatchId}/next-innings`).set('Authorization', `Bearer ${token}`).send({ enforce_follow_on: true });
    expect(nextInnings.status).toBe(200);
    expect(nextInnings.body.follow_on_enforced).toBe(true);

    const innings3 = await db.selectFrom('innings').selectAll().where('match_id', '=', decisiveMatchId).where('innings_number', '=', 3).executeTakeFirstOrThrow();
    expect(innings3.batting_team_id).toBe(teamBId);
    expect(innings3.bowling_team_id).toBe(teamAId);
    expect(innings3.max_overs).toBeNull();
    expect(innings3.target).toBeNull();

    // Innings 3 (Team B following on): all out for 10 -- combined with their
    // innings 2 total (1), that's 11, still short of Team A's 16 -> innings win.
    await bowl(decisiveMatchId, 3, p3, p4, p1, [{ runs: 4 }, { runs: 4 }, { runs: 2 }, { wicket: true }]);
    const close3 = await request(app).post(`/matches/${decisiveMatchId}/innings/3/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close3.status).toBe(200);
    expect(close3.body.outcome).toEqual({ kind: 'innings_win', winningTeamId: teamAId, marginRuns: 5 });

    const finalMatch = await db.selectFrom('matches').selectAll().where('id', '=', decisiveMatchId).executeTakeFirstOrThrow();
    expect(finalMatch.status).toBe('completed');
    expect(finalMatch.result).toBe('team_a_won');
    expect(finalMatch.winner_team_id).toBe(teamAId);
    expect(finalMatch.win_margin_runs).toBe(5);
    expect(finalMatch.result_note).toBe('Won by an innings and 5 run(s)');

    const innings4 = await db.selectFrom('innings').selectAll().where('match_id', '=', decisiveMatchId).where('innings_number', '=', 4).executeTakeFirst();
    expect(innings4).toBeUndefined();
  }, 60000);

  it('manages stumps/resume-play across the day limit and ends undecided play as a draw', async () => {
    const toss = await request(app).post(`/matches/${dayMatchId}/toss`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: teamAId, decision: 'bat' });
    expect(toss.status).toBe(201);

    const stumps1 = await request(app).post(`/matches/${dayMatchId}/stumps`).set('Authorization', `Bearer ${token}`);
    expect(stumps1.status).toBe(200);
    expect((await db.selectFrom('matches').select('status').where('id', '=', dayMatchId).executeTakeFirstOrThrow()).status).toBe('day_break');

    const resume1 = await request(app).post(`/matches/${dayMatchId}/resume-play`).set('Authorization', `Bearer ${token}`);
    expect(resume1.status).toBe(200);
    expect(resume1.body.day).toBe(2);

    await request(app).post(`/matches/${dayMatchId}/stumps`).set('Authorization', `Bearer ${token}`);
    const resume2 = await request(app).post(`/matches/${dayMatchId}/resume-play`).set('Authorization', `Bearer ${token}`);
    expect(resume2.status).toBe(200);
    expect(resume2.body.day).toBe(3);

    await request(app).post(`/matches/${dayMatchId}/stumps`).set('Authorization', `Bearer ${token}`);
    const resume3 = await request(app).post(`/matches/${dayMatchId}/resume-play`).set('Authorization', `Bearer ${token}`);
    expect(resume3.status).toBe(409);

    const draw = await request(app).post(`/matches/${dayMatchId}/draw`).set('Authorization', `Bearer ${token}`).send({});
    expect(draw.status).toBe(200);

    const finalMatch = await db.selectFrom('matches').selectAll().where('id', '=', dayMatchId).executeTakeFirstOrThrow();
    expect(finalMatch.status).toBe('completed');
    expect(finalMatch.result).toBe('draw');

    const standings = await db.selectFrom('standings').selectAll().where('group_id', '=', groupId).execute();
    expect(standings.every((s) => s.drawn === 1 && s.points === 4)).toBe(true);
  }, 30000);
});

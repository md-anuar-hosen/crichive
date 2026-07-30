import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Knockout brackets', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const slug = `bracket-test-${tournamentId}`;
  const teamA = randomUUID(); // seed 1
  const teamB = randomUUID(); // seed 2
  const teamC = randomUUID(); // seed 3
  const teamD = randomUUID(); // seed 4
  const teams = [teamA, teamB, teamC, teamD];
  // A player can only be in one squad per tournament (team_squads' one_team_per_tournament
  // constraint), so each team needs its own pair, not a shared p1-p4.
  const playersByTeam = new Map<string, [string, string]>(teams.map((team) => [team, [randomUUID(), randomUUID()]]));
  const allPlayerIds = [...playersByTeam.values()].flat();

  let token: string;
  let stageId: string;
  let matchIds: string[] = [];

  beforeAll(async () => {
    await db.insertInto('users').values({ id: organizerId, email: `bracket-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' }).execute();
    await db.insertInto('tournaments').values({ id: tournamentId, name: 'Bracket Test', season_year: 2026, slug }).execute();
    await db.insertInto('tournament_rules').values({ tournament_id: tournamentId, overs_per_innings: 1, max_overs_per_bowler: 1, players_per_side: 2 }).execute();
    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();

    await db
      .insertInto('teams')
      .values([
        { id: teamA, name: 'Bracket Team A', short_name: 'BRA' },
        { id: teamB, name: 'Bracket Team B', short_name: 'BRB' },
        { id: teamC, name: 'Bracket Team C', short_name: 'BRC' },
        { id: teamD, name: 'Bracket Team D', short_name: 'BRD' },
      ])
      .execute();
    await db
      .insertInto('tournament_teams')
      .values(teams.map((team_id) => ({ tournament_id: tournamentId, team_id })))
      .execute();

    await db
      .insertInto('players')
      .values(allPlayerIds.map((id, i) => ({ id, full_name: `Bracket Player ${i + 1}` })))
      .execute();
    for (const team of teams) {
      const [pa, pb] = playersByTeam.get(team)!;
      await db
        .insertInto('team_squads')
        .values([
          { tournament_id: tournamentId, team_id: team, player_id: pa, approved_at: new Date() },
          { tournament_id: tournamentId, team_id: team, player_id: pb, approved_at: new Date() },
        ])
        .execute();
    }

    token = signAuthToken({ sub: organizerId, is_platform_admin: false });
  });

  afterAll(async () => {
    for (const matchId of matchIds) {
      await db.deleteFrom('deliveries').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('innings_totals').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('batting_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('bowling_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('partnerships').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
      await db.deleteFrom('innings').where('match_id', '=', matchId).execute();
      await db.deleteFrom('match_players').where('match_id', '=', matchId).execute();
    }
    await db.deleteFrom('matches').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('stages').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('player_career_stats').where('player_id', 'in', allPlayerIds).execute();
    await db.deleteFrom('team_squads').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('players').where('id', 'in', allPlayerIds).execute();
    await db.deleteFrom('tournament_teams').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('teams').where('id', 'in', teams).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', '=', organizerId).execute();
    await db.deleteFrom('users').where('id', '=', organizerId).execute();
  });

  /** Fastest possible decisive result with players_per_side=2: a single-ball
   * wicket ends innings 1 (1 wicket = all out), then innings 2 reaches its
   * 1-run target on the very first ball. */
  async function playMinimalMatch(matchId: string, battingFirstTeamId: string, bowlingFirstTeamId: string) {
    const [batA, batB] = playersByTeam.get(battingFirstTeamId)!;
    const [bowlA, bowlB] = playersByTeam.get(bowlingFirstTeamId)!;

    await request(app).post(`/matches/${matchId}/toss`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: battingFirstTeamId, decision: 'bat' });
    await request(app)
      .post(`/matches/${matchId}/playing-xi`)
      .set('Authorization', `Bearer ${token}`)
      .send({ team_id: battingFirstTeamId, player_ids: [batA, batB], captain_id: batA, keeper_id: batB });
    await request(app)
      .post(`/matches/${matchId}/playing-xi`)
      .set('Authorization', `Bearer ${token}`)
      .send({ team_id: bowlingFirstTeamId, player_ids: [bowlA, bowlB], captain_id: bowlA, keeper_id: bowlB });

    const wicketBall = await request(app)
      .post(`/matches/${matchId}/deliveries`)
      .set('Authorization', `Bearer ${token}`)
      .send({ client_event_id: randomUUID(), innings_number: 1, striker_id: batA, non_striker_id: batB, bowler_id: bowlA, runs_off_bat: 0, wicket_kind: 'bowled', player_out_id: batA });
    expect(wicketBall.status).toBe(201);

    const close1 = await request(app).post(`/matches/${matchId}/innings/1/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close1.status).toBe(200);

    const chaseBall = await request(app)
      .post(`/matches/${matchId}/deliveries`)
      .set('Authorization', `Bearer ${token}`)
      .send({ client_event_id: randomUUID(), innings_number: 2, striker_id: bowlA, non_striker_id: bowlB, bowler_id: batA, runs_off_bat: 1 });
    expect(chaseBall.status).toBe(201);

    const close2 = await request(app).post(`/matches/${matchId}/innings/2/close`).set('Authorization', `Bearer ${token}`).send({});
    expect(close2.status).toBe(200);

    // The chasing team (bowlingFirstTeamId) wins by reaching the target.
    return bowlingFirstTeamId;
  }

  it('generates a 4-team bracket and auto-advances winners into the final', async () => {
    const create = await request(app)
      .post(`/tournaments/${slug}/knockout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ team_ids: [teamA, teamB, teamC, teamD] });
    expect(create.status).toBe(201);
    expect(create.body.match_count).toBe(3);
    expect(create.body.rounds).toBe(2);
    stageId = create.body.stage_id;

    const bracket1 = await request(app).get(`/tournaments/${slug}/knockout`);
    expect(bracket1.status).toBe(200);
    expect(bracket1.body.stage.id).toBe(stageId);
    expect(bracket1.body.rounds).toHaveLength(2);

    const round1 = bracket1.body.rounds.find((r: { round: number }) => r.round === 1);
    expect(round1.name).toBe('Semi-Finals');
    expect(round1.matches).toHaveLength(2);
    // standardSeedOrder(4) = [1,4,2,3] -> pairs (A,D) and (B,C).
    expect([round1.matches[0].team_a.id, round1.matches[0].team_b.id].sort()).toEqual([teamA, teamD].sort());
    expect([round1.matches[1].team_a.id, round1.matches[1].team_b.id].sort()).toEqual([teamB, teamC].sort());

    const finalRound = bracket1.body.rounds.find((r: { round: number }) => r.round === 2);
    expect(finalRound.name).toBe('Final');
    expect(finalRound.matches).toHaveLength(1);
    expect(finalRound.matches[0].team_a).toBeNull();
    expect(finalRound.matches[0].team_b).toBeNull();

    const match1Id = round1.matches[0].id as string;
    const match2Id = round1.matches[1].id as string;
    const finalId = finalRound.matches[0].id as string;
    matchIds = [match1Id, match2Id, finalId];

    // Play round 1, match 1 (A vs D): A bats first, D chases and wins.
    const [teamAvD_A, teamAvD_D] = [round1.matches[0].team_a.id, round1.matches[0].team_b.id];
    const winner1 = await playMinimalMatch(match1Id, teamAvD_A, teamAvD_D);

    const afterMatch1 = await db.selectFrom('matches').select(['team_a_id', 'team_b_id']).where('id', '=', finalId).executeTakeFirstOrThrow();
    expect([afterMatch1.team_a_id, afterMatch1.team_b_id]).toContain(winner1);

    // Play round 1, match 2 (B vs C): same shape.
    const [teamBvC_B, teamBvC_C] = [round1.matches[1].team_a.id, round1.matches[1].team_b.id];
    const winner2 = await playMinimalMatch(match2Id, teamBvC_B, teamBvC_C);

    const afterMatch2 = await db.selectFrom('matches').select(['team_a_id', 'team_b_id']).where('id', '=', finalId).executeTakeFirstOrThrow();
    expect([afterMatch2.team_a_id, afterMatch2.team_b_id].sort()).toEqual([winner1, winner2].sort());

    // Play the final itself.
    const finalWinner = await playMinimalMatch(finalId, winner1, winner2);
    const finalMatch = await db.selectFrom('matches').selectAll().where('id', '=', finalId).executeTakeFirstOrThrow();
    expect(finalMatch.status).toBe('completed');
    expect(finalMatch.winner_team_id).toBe(finalWinner);
    expect(finalMatch.next_match_id).toBeNull();
  }, 90000);

  it('rejects a team_ids list containing a team not in the tournament', async () => {
    const res = await request(app)
      .post(`/tournaments/${slug}/knockout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ team_ids: [teamA, teamB, randomUUID()] });
    expect(res.status).toBe(400);
  });
});

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Match cancel/forfeit', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const teamA = randomUUID();
  const teamB = randomUUID();
  const stageId = randomUUID();
  const groupId = randomUUID();
  const cancelMatchId = randomUUID();
  const forfeitMatchId = randomUUID();

  let token: string;

  beforeAll(async () => {
    await db.insertInto('users').values({ id: organizerId, email: `lifecycle-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' }).execute();
    await db.insertInto('tournaments').values({ id: tournamentId, name: 'Lifecycle Test', season_year: 2026, slug: `lifecycle-test-${tournamentId}` }).execute();
    await db.insertInto('tournament_rules').values({ tournament_id: tournamentId, overs_per_innings: 20, max_overs_per_bowler: 4, players_per_side: 11 }).execute();
    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();
    await db
      .insertInto('teams')
      .values([
        { id: teamA, name: 'Lifecycle Team A', short_name: 'LFA' },
        { id: teamB, name: 'Lifecycle Team B', short_name: 'LFB' },
      ])
      .execute();
    await db.insertInto('stages').values({ id: stageId, tournament_id: tournamentId, kind: 'group', name: 'Group Stage', sequence: 1 }).execute();
    await db.insertInto('groups').values({ id: groupId, stage_id: stageId, name: 'Group A' }).execute();
    await db
      .insertInto('group_teams')
      .values([
        { group_id: groupId, team_id: teamA },
        { group_id: groupId, team_id: teamB },
      ])
      .execute();
    await db
      .insertInto('matches')
      .values([
        { id: cancelMatchId, tournament_id: tournamentId, group_id: groupId, stage_id: stageId, team_a_id: teamA, team_b_id: teamB, match_number: 1 },
        { id: forfeitMatchId, tournament_id: tournamentId, group_id: groupId, stage_id: stageId, team_a_id: teamA, team_b_id: teamB, match_number: 2 },
      ])
      .execute();

    token = signAuthToken({ sub: organizerId, is_platform_admin: false });
  });

  afterAll(async () => {
    await db.deleteFrom('matches').where('id', 'in', [cancelMatchId, forfeitMatchId]).execute();
    await db.deleteFrom('standings').where('group_id', '=', groupId).execute();
    await db.deleteFrom('group_teams').where('group_id', '=', groupId).execute();
    await db.deleteFrom('groups').where('id', '=', groupId).execute();
    await db.deleteFrom('stages').where('id', '=', stageId).execute();
    await db.deleteFrom('tournament_teams').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamA, teamB]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', '=', organizerId).execute();
    await db.deleteFrom('users').where('id', '=', organizerId).execute();
  });

  it('cancel: works pre-toss, does not count in standings, and blocks once the toss is recorded', async () => {
    const cancelled = await request(app).post(`/matches/${cancelMatchId}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'Ground unavailable' });
    expect(cancelled.status).toBe(200);

    const match = await db.selectFrom('matches').select(['status', 'result']).where('id', '=', cancelMatchId).executeTakeFirstOrThrow();
    expect(match.status).toBe('cancelled');
    expect(match.result).toBeNull();

    const standings = await db.selectFrom('standings').selectAll().where('group_id', '=', groupId).execute();
    expect(standings.every((s) => s.played === 0)).toBe(true);

    const secondAttempt = await request(app).post(`/matches/${cancelMatchId}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'Again' });
    expect(secondAttempt.status).toBe(409);
  });

  it('forfeit: awards a decisive result and updates standings, rejects a winner not in the match', async () => {
    const badWinner = await request(app).post(`/matches/${forfeitMatchId}/forfeit`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: randomUUID() });
    expect(badWinner.status).toBe(400);

    const forfeited = await request(app)
      .post(`/matches/${forfeitMatchId}/forfeit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ winner_team_id: teamA, reason: 'Team B did not show up' });
    expect(forfeited.status).toBe(200);

    const match = await db.selectFrom('matches').selectAll().where('id', '=', forfeitMatchId).executeTakeFirstOrThrow();
    expect(match.status).toBe('forfeited');
    expect(match.result).toBe('team_a_won');
    expect(match.winner_team_id).toBe(teamA);
    expect(match.result_note).toContain('forfeit');

    const standings = await db.selectFrom('standings').selectAll().where('group_id', '=', groupId).execute();
    const teamAStanding = standings.find((s) => s.team_id === teamA);
    const teamBStanding = standings.find((s) => s.team_id === teamB);
    expect(teamAStanding?.won).toBe(1);
    expect(teamBStanding?.lost).toBe(1);

    const again = await request(app).post(`/matches/${forfeitMatchId}/forfeit`).set('Authorization', `Bearer ${token}`).send({ winner_team_id: teamB });
    expect(again.status).toBe(409);
  });
});

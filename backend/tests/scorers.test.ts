import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Scorer management (tournament-wide grant + per-match assignment)', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const scorerUserId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const matchAId = randomUUID();
  const matchBId = randomUUID();
  const slug = `scorers-test-${tournamentId}`;
  const scorerEmail = `scorer-${scorerUserId}@example.com`;

  let organizerToken: string;
  let scorerToken: string;
  let membershipId: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values([
        { id: organizerId, email: `scorers-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' },
        { id: scorerUserId, email: scorerEmail, password_hash: 'x', display_name: 'A Scorer' },
      ])
      .execute();

    await db.insertInto('tournaments').values({ id: tournamentId, name: 'Scorers Test', season_year: 2026, slug }).execute();
    await db.insertInto('tournament_rules').values({ tournament_id: tournamentId, overs_per_innings: 20, max_overs_per_bowler: 4, players_per_side: 2 }).execute();
    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();

    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Scorers Team A', short_name: 'SCA' },
        { id: teamBId, name: 'Scorers Team B', short_name: 'SCB' },
      ])
      .execute();

    await db
      .insertInto('matches')
      .values([
        { id: matchAId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 1 },
        { id: matchBId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 2 },
      ])
      .execute();

    organizerToken = signAuthToken({ sub: organizerId, is_platform_admin: false });
    scorerToken = signAuthToken({ sub: scorerUserId, is_platform_admin: false });
  });

  afterAll(async () => {
    await db.deleteFrom('match_scorers').where('match_id', 'in', [matchAId, matchBId]).execute();
    await db.deleteFrom('innings').where('match_id', 'in', [matchAId, matchBId]).execute();
    await db.deleteFrom('matches').where('id', 'in', [matchAId, matchBId]).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamAId, teamBId]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', 'in', [organizerId, scorerUserId]).execute();
    await db.deleteFrom('users').where('id', 'in', [organizerId, scorerUserId]).execute();
  });

  it('grants a tournament-wide scorer role', async () => {
    const grant = await request(app).post(`/tournaments/${slug}/scorers`).set('Authorization', `Bearer ${organizerToken}`).send({ email: scorerEmail });
    expect(grant.status).toBe(201);
    membershipId = grant.body.membership.id;

    const list = await request(app).get(`/tournaments/${slug}/scorers`).set('Authorization', `Bearer ${organizerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.scorers).toHaveLength(1);
    expect(list.body.scorers[0].user.email).toBe(scorerEmail);

    const again = await request(app).post(`/tournaments/${slug}/scorers`).set('Authorization', `Bearer ${organizerToken}`).send({ email: scorerEmail });
    expect(again.status).toBe(409);
  });

  it('rejects a tournament-wide scorer acting on a match they have not been assigned to', async () => {
    const toss = await request(app).post(`/matches/${matchAId}/toss`).set('Authorization', `Bearer ${scorerToken}`).send({ winner_team_id: teamAId, decision: 'bat' });
    expect(toss.status).toBe(403);
    expect(toss.body.error).toContain('not assigned');
  });

  it('rejects assigning a user who is not a tournament scorer', async () => {
    const res = await request(app).post(`/matches/${matchAId}/scorers`).set('Authorization', `Bearer ${organizerToken}`).send({ user_id: organizerId });
    expect(res.status).toBe(400);
  });

  it('lets the assigned scorer act only on their assigned match, not other matches in the same tournament', async () => {
    const assign = await request(app).post(`/matches/${matchAId}/scorers`).set('Authorization', `Bearer ${organizerToken}`).send({ user_id: scorerUserId });
    expect(assign.status).toBe(201);

    const duplicate = await request(app).post(`/matches/${matchAId}/scorers`).set('Authorization', `Bearer ${organizerToken}`).send({ user_id: scorerUserId });
    expect(duplicate.status).toBe(409);

    const list = await request(app).get(`/matches/${matchAId}/scorers`).set('Authorization', `Bearer ${organizerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.scorers).toHaveLength(1);

    const tossOnAssignedMatch = await request(app).post(`/matches/${matchAId}/toss`).set('Authorization', `Bearer ${scorerToken}`).send({ winner_team_id: teamAId, decision: 'bat' });
    expect(tossOnAssignedMatch.status).toBe(201);

    const tossOnOtherMatch = await request(app).post(`/matches/${matchBId}/toss`).set('Authorization', `Bearer ${scorerToken}`).send({ winner_team_id: teamAId, decision: 'bat' });
    expect(tossOnOtherMatch.status).toBe(403);
  });

  it('unassigning from one match removes access to just that match', async () => {
    const unassign = await request(app).delete(`/matches/${matchAId}/scorers/${scorerUserId}`).set('Authorization', `Bearer ${organizerToken}`);
    expect(unassign.status).toBe(200);

    // Innings 1 already exists from the toss above — playing-xi is a fair next probe.
    const playingXi = await request(app)
      .post(`/matches/${matchAId}/playing-xi`)
      .set('Authorization', `Bearer ${scorerToken}`)
      .send({ team_id: teamAId, player_ids: [randomUUID(), randomUUID()], captain_id: randomUUID(), keeper_id: randomUUID() });
    expect(playingXi.status).toBe(403);
  });

  it('revoking the tournament-wide grant cascades to remove any remaining match assignments', async () => {
    await request(app).post(`/matches/${matchBId}/scorers`).set('Authorization', `Bearer ${organizerToken}`).send({ user_id: scorerUserId });

    const revoke = await request(app).delete(`/tournaments/${slug}/scorers/${membershipId}`).set('Authorization', `Bearer ${organizerToken}`);
    expect(revoke.status).toBe(200);

    const remaining = await db.selectFrom('match_scorers').selectAll().where('user_id', '=', scorerUserId).execute();
    expect(remaining).toHaveLength(0);

    const tossOnMatchB = await request(app).post(`/matches/${matchBId}/toss`).set('Authorization', `Bearer ${scorerToken}`).send({ winner_team_id: teamAId, decision: 'bat' });
    expect(tossOnMatchB.status).toBe(403);
    expect(tossOnMatchB.body.error).toContain('Insufficient tournament role');
  });
});

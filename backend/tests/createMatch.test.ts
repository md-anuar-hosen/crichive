import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Scheduling a match', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const outsiderId = randomUUID();
  const teamA = randomUUID();
  const teamB = randomUUID();
  const outsideTeam = randomUUID(); // exists, but never joined this tournament
  const slug = `create-match-test-${tournamentId}`;
  const createdMatchIds: string[] = [];

  let organizerToken: string;
  let outsiderToken: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values([
        { id: organizerId, email: `create-match-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' },
        { id: outsiderId, email: `create-match-outsider-${outsiderId}@example.com`, password_hash: 'x', display_name: 'Outsider' },
      ])
      .execute();
    await db.insertInto('tournaments').values({ id: tournamentId, name: 'Create Match Test', season_year: 2026, slug }).execute();
    await db.insertInto('tournament_rules').values({ tournament_id: tournamentId, overs_per_innings: 20, max_overs_per_bowler: 4 }).execute();
    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();
    await db
      .insertInto('teams')
      .values([
        { id: teamA, name: 'Create Match Team A', short_name: 'CMA' },
        { id: teamB, name: 'Create Match Team B', short_name: 'CMB' },
        { id: outsideTeam, name: 'Outside Team', short_name: 'OUT' },
      ])
      .execute();
    await db
      .insertInto('tournament_teams')
      .values([
        { tournament_id: tournamentId, team_id: teamA },
        { tournament_id: tournamentId, team_id: teamB },
      ])
      .execute();

    organizerToken = signAuthToken({ sub: organizerId, is_platform_admin: false });
    outsiderToken = signAuthToken({ sub: outsiderId, is_platform_admin: false });
  });

  afterAll(async () => {
    if (createdMatchIds.length) await db.deleteFrom('matches').where('id', 'in', createdMatchIds).execute();
    await db.deleteFrom('tournament_teams').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamA, teamB, outsideTeam]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', 'in', [organizerId, outsiderId]).execute();
    await db.deleteFrom('users').where('id', 'in', [organizerId, outsiderId]).execute();
  });

  it('lets an organizer schedule a standalone match with no group', async () => {
    const res = await request(app)
      .post(`/tournaments/${slug}/matches`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ team_a_id: teamA, team_b_id: teamB });
    expect(res.status).toBe(201);
    createdMatchIds.push(res.body.match_id);

    const match = await db.selectFrom('matches').selectAll().where('id', '=', res.body.match_id).executeTakeFirstOrThrow();
    expect(match.team_a_id).toBe(teamA);
    expect(match.team_b_id).toBe(teamB);
    expect(match.group_id).toBeNull();
    expect(match.status).toBe('scheduled');

    // It's immediately usable — toss can be recorded on it right away.
    const toss = await request(app).post(`/matches/${res.body.match_id}/toss`).set('Authorization', `Bearer ${organizerToken}`).send({ winner_team_id: teamA, decision: 'bat' });
    expect(toss.status).toBe(201);
  });

  it('rejects a non-organizer, identical teams, and a team not in the tournament', async () => {
    const forbidden = await request(app)
      .post(`/tournaments/${slug}/matches`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ team_a_id: teamA, team_b_id: teamB });
    expect(forbidden.status).toBe(403);

    const sameTeam = await request(app)
      .post(`/tournaments/${slug}/matches`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ team_a_id: teamA, team_b_id: teamA });
    expect(sameTeam.status).toBe(400);

    const notInTournament = await request(app)
      .post(`/tournaments/${slug}/matches`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ team_a_id: teamA, team_b_id: outsideTeam });
    expect(notInTournament.status).toBe(400);
  });

  it('assigns sequential match numbers across a small round-robin', async () => {
    const first = await request(app).post(`/tournaments/${slug}/matches`).set('Authorization', `Bearer ${organizerToken}`).send({ team_a_id: teamA, team_b_id: teamB });
    const second = await request(app).post(`/tournaments/${slug}/matches`).set('Authorization', `Bearer ${organizerToken}`).send({ team_a_id: teamB, team_b_id: teamA });
    createdMatchIds.push(first.body.match_id, second.body.match_id);

    expect(second.body.match_number).toBe(first.body.match_number + 1);
  });
});

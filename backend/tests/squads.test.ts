import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Squad management (team manager proposals + organiser approval)', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const managerUserId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const matchId = randomUUID();
  const p1 = randomUUID();
  const p2 = randomUUID();
  const p3 = randomUUID();
  const p4 = randomUUID();
  const slug = `squads-test-${tournamentId}`;
  const managerEmail = `squad-manager-${managerUserId}@example.com`;

  let organizerToken: string;
  let managerToken: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values([
        { id: organizerId, email: `squads-organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' },
        { id: managerUserId, email: managerEmail, password_hash: 'x', display_name: 'Team A Manager' },
      ])
      .execute();

    await db.insertInto('tournaments').values({ id: tournamentId, name: 'Squads Test', season_year: 2026, slug }).execute();
    await db
      .insertInto('tournament_rules')
      .values({ tournament_id: tournamentId, overs_per_innings: 1, max_overs_per_bowler: 1, players_per_side: 2 })
      .execute();
    await db.insertInto('tournament_memberships').values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' }).execute();

    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Squads A', short_name: 'SQA' },
        { id: teamBId, name: 'Squads B', short_name: 'SQB' },
      ])
      .execute();

    await db
      .insertInto('players')
      .values([
        { id: p1, full_name: 'Squad Player One' },
        { id: p2, full_name: 'Squad Player Two' },
        { id: p3, full_name: 'Squad Player Three' },
        { id: p4, full_name: 'Squad Player Four' },
      ])
      .execute();

    await db.insertInto('matches').values({ id: matchId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 1 }).execute();

    organizerToken = signAuthToken({ sub: organizerId, is_platform_admin: false });
    managerToken = signAuthToken({ sub: managerUserId, is_platform_admin: false });
  });

  afterAll(async () => {
    await db.deleteFrom('match_players').where('match_id', '=', matchId).execute();
    await db.deleteFrom('innings').where('match_id', '=', matchId).execute();
    await db.deleteFrom('matches').where('id', '=', matchId).execute();
    await db.deleteFrom('team_squads').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamAId, teamBId]).execute();
    await db.deleteFrom('players').where('id', 'in', [p1, p2, p3, p4]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('audit_log').where('actor_user_id', 'in', [organizerId, managerUserId]).execute();
    await db.deleteFrom('users').where('id', 'in', [organizerId, managerUserId]).execute();
  });

  it(
    'grants a scoped team manager role, then rejects them acting on a different team',
    async () => {
      const grant = await request(app)
        .post(`/tournaments/${slug}/teams/${teamAId}/managers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ email: managerEmail });
      expect(grant.status).toBe(201);

      const list = await request(app).get(`/tournaments/${slug}/teams/${teamAId}/managers`).set('Authorization', `Bearer ${organizerToken}`);
      expect(list.status).toBe(200);
      expect(list.body.managers).toHaveLength(1);
      expect(list.body.managers[0].user.email).toBe(managerEmail);

      // Granting the same person again is rejected, not silently duplicated.
      const dupe = await request(app)
        .post(`/tournaments/${slug}/teams/${teamAId}/managers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ email: managerEmail });
      expect(dupe.status).toBe(409);

      // Scoped to team A only — team B is off limits.
      const wrongTeam = await request(app)
        .post(`/tournaments/${slug}/teams/${teamBId}/squad`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ player_id: p3 });
      expect(wrongTeam.status).toBe(403);
    },
    30000,
  );

  it(
    'takes a team manager proposal through pending -> organiser approval -> playing-XI eligibility',
    async () => {
      const propose1 = await request(app)
        .post(`/tournaments/${slug}/teams/${teamAId}/squad`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ player_id: p1, jersey_number: 7 });
      expect(propose1.status).toBe(201);
      expect(propose1.body.squad_entry.is_approved).toBe(false);

      const propose2 = await request(app)
        .post(`/tournaments/${slug}/teams/${teamAId}/squad`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ player_id: p2, jersey_number: 11 });
      expect(propose2.body.squad_entry.is_approved).toBe(false);

      // A team manager cannot approve their own proposal — approval is organizer-only.
      const selfApprove = await request(app)
        .post(`/tournaments/${slug}/teams/${teamAId}/squad/${p1}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ licence_verified: true });
      expect(selfApprove.status).toBe(403);

      // Organizer adding directly is auto-approved, no pending step.
      await request(app).post(`/tournaments/${slug}/teams/${teamBId}/squad`).set('Authorization', `Bearer ${organizerToken}`).send({ player_id: p3 });
      const orgAdd = await request(app).post(`/tournaments/${slug}/teams/${teamBId}/squad`).set('Authorization', `Bearer ${organizerToken}`).send({ player_id: p4 });
      expect(orgAdd.body.squad_entry.is_approved).toBe(true);

      await request(app).post(`/matches/${matchId}/toss`).set('Authorization', `Bearer ${organizerToken}`).send({ winner_team_id: teamAId, decision: 'bat' });

      // Still pending -> playing XI selection is rejected.
      const xiBlocked = await request(app)
        .post(`/matches/${matchId}/playing-xi`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
      expect(xiBlocked.status).toBe(400);
      expect(xiBlocked.body.error).toMatch(/not yet organiser-approved/);

      // Organizer approves both.
      const approve1 = await request(app)
        .post(`/tournaments/${slug}/teams/${teamAId}/squad/${p1}/approve`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ licence_verified: true });
      expect(approve1.status).toBe(200);
      expect(approve1.body.squad_entry.is_approved).toBe(true);

      await request(app)
        .post(`/tournaments/${slug}/teams/${teamAId}/squad/${p2}/approve`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ licence_verified: true });

      // Now playing-XI selection succeeds.
      const xiOk = await request(app)
        .post(`/matches/${matchId}/playing-xi`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
      expect(xiOk.status).toBe(201);

      // The manage view (visible to the team's own manager) shows both approved entries.
      const manageView = await request(app).get(`/tournaments/${slug}/teams/${teamAId}/squad/manage`).set('Authorization', `Bearer ${managerToken}`);
      expect(manageView.status).toBe(200);
      expect(manageView.body.squad).toHaveLength(2);
      expect(manageView.body.squad.every((s: { is_approved: boolean }) => s.is_approved)).toBe(true);

      // Editing an approved entry as team manager reopens it for organiser review.
      const edit = await request(app)
        .patch(`/tournaments/${slug}/teams/${teamAId}/squad/${p1}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ jersey_number: 99 });
      expect(edit.status).toBe(200);
      expect(edit.body.squad_entry.is_approved).toBe(false);
      expect(edit.body.squad_entry.jersey_number).toBe(99);

      // p1 has already appeared in a playing XI for this match — can't be pulled from the squad now.
      const removeBlocked = await request(app).delete(`/tournaments/${slug}/teams/${teamAId}/squad/${p1}`).set('Authorization', `Bearer ${organizerToken}`);
      expect(removeBlocked.status).toBe(409);
    },
    45000,
  );

  it('finds players by name via search', async () => {
    const res = await request(app).get('/players/search').query({ q: 'Squad Player' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
  });

  it(
    'revoking team manager access blocks further squad edits',
    async () => {
      const list = await request(app).get(`/tournaments/${slug}/teams/${teamAId}/managers`).set('Authorization', `Bearer ${organizerToken}`);
      const membershipId = list.body.managers[0].id;

      const revoke = await request(app).delete(`/tournaments/${slug}/teams/${teamAId}/managers/${membershipId}`).set('Authorization', `Bearer ${organizerToken}`);
      expect(revoke.status).toBe(200);

      const afterRevoke = await request(app)
        .patch(`/tournaments/${slug}/teams/${teamAId}/squad/${p2}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ jersey_number: 15 });
      expect(afterRevoke.status).toBe(403);
    },
    20000,
  );
});

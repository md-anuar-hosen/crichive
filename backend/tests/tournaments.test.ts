import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('Tournament creation + organiser-approval mode', () => {
  const adminId = randomUUID();
  const creatorAId = randomUUID();
  const creatorBId = randomUUID();
  const openSlug = `open-mode-${randomUUID()}`;
  const gatedSlug = `gated-mode-${randomUUID()}`;
  const createdTournamentIds: string[] = [];

  let adminToken: string;
  let creatorAToken: string;
  let creatorBToken: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values([
        { id: adminId, email: `tourney-admin-${adminId}@example.com`, password_hash: 'x', display_name: 'Platform Admin', is_platform_admin: true },
        { id: creatorAId, email: `tourney-creator-a-${creatorAId}@example.com`, password_hash: 'x', display_name: 'Creator A' },
        { id: creatorBId, email: `tourney-creator-b-${creatorBId}@example.com`, password_hash: 'x', display_name: 'Creator B' },
      ])
      .execute();

    adminToken = signAuthToken({ sub: adminId, is_platform_admin: true });
    creatorAToken = signAuthToken({ sub: creatorAId, is_platform_admin: false });
    creatorBToken = signAuthToken({ sub: creatorBId, is_platform_admin: false });
  });

  afterAll(async () => {
    // Global singleton — must not leak a non-default mode into other tests/the app.
    await db.updateTable('platform_settings').set({ organizer_signup_mode: 'open', updated_by: null }).where('id', '=', true).execute();

    for (const tournamentId of createdTournamentIds) {
      await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
      await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
      await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    }
    await db.deleteFrom('audit_log').where('actor_user_id', 'in', [adminId, creatorAId, creatorBId]).execute();
    await db.deleteFrom('users').where('id', 'in', [adminId, creatorAId, creatorBId]).execute();
  });

  it(
    'open mode: creating a tournament auto-approves it and grants the creator organizer',
    async () => {
      const res = await request(app)
        .post('/tournaments')
        .set('Authorization', `Bearer ${creatorAToken}`)
        .send({ name: 'Open Mode Cup', slug: openSlug, season_year: 2027, overs_per_innings: 20, max_overs_per_bowler: 4 });
      expect(res.status).toBe(201);
      expect(res.body.tournament.is_public).toBe(true);
      expect(res.body.tournament.is_approved).toBe(true);
      createdTournamentIds.push(res.body.tournament.id);

      const membership = await db
        .selectFrom('tournament_memberships')
        .select('role')
        .where('tournament_id', '=', res.body.tournament.id)
        .where('user_id', '=', creatorAId)
        .executeTakeFirst();
      expect(membership?.role).toBe('organizer');

      // Shows up in the public tournament detail immediately.
      const publicView = await request(app).get(`/tournaments/${openSlug}`);
      expect(publicView.status).toBe(200);
      expect(publicView.body.is_approved).toBe(true);

      // A duplicate slug is a clean conflict, not a raw DB error.
      const dupe = await request(app)
        .post('/tournaments')
        .set('Authorization', `Bearer ${creatorBToken}`)
        .send({ name: 'Someone else', slug: openSlug, season_year: 2027, overs_per_innings: 10, max_overs_per_bowler: 2 });
      expect(dupe.status).toBe(409);
    },
    20000,
  );

  it(
    'approval_required mode: stays private and organizer-only until a platform admin approves it',
    async () => {
      const settingsBefore = await request(app).get('/platform/settings');
      expect(settingsBefore.body.organizer_signup_mode).toBe('open');

      // A non-admin can't flip the switch.
      const forbidden = await request(app).patch('/platform/settings').set('Authorization', `Bearer ${creatorAToken}`).send({ organizer_signup_mode: 'approval_required' });
      expect(forbidden.status).toBe(403);

      const flip = await request(app).patch('/platform/settings').set('Authorization', `Bearer ${adminToken}`).send({ organizer_signup_mode: 'approval_required' });
      expect(flip.status).toBe(200);
      expect(flip.body.organizer_signup_mode).toBe('approval_required');

      const created = await request(app)
        .post('/tournaments')
        .set('Authorization', `Bearer ${creatorBToken}`)
        .send({ name: 'Gated Mode Cup', slug: gatedSlug, season_year: 2027, overs_per_innings: 10, max_overs_per_bowler: 2 });
      expect(created.status).toBe(201);
      expect(created.body.tournament.is_public).toBe(false);
      expect(created.body.tournament.is_approved).toBe(false);
      createdTournamentIds.push(created.body.tournament.id);

      // The creator is organizer immediately regardless of pending status — they
      // can already configure it (proven by successfully editing its rules).
      const rulesEdit = await request(app)
        .patch(`/tournaments/${gatedSlug}/rules`)
        .set('Authorization', `Bearer ${creatorBToken}`)
        .send({ points_win: 4 });
      expect(rulesEdit.status).toBe(200);

      // It doesn't show up in the public list yet (is_public: false), but a direct
      // slug lookup still works — findable by whoever has the link, not hidden entirely.
      const list = await request(app).get('/tournaments?limit=100');
      expect(list.body.data.some((t: { slug: string }) => t.slug === gatedSlug)).toBe(false);
      const direct = await request(app).get(`/tournaments/${gatedSlug}`);
      expect(direct.status).toBe(200);
      expect(direct.body.is_approved).toBe(false);

      // A non-admin can't approve it either.
      const nonAdminApprove = await request(app).post(`/tournaments/${gatedSlug}/approve`).set('Authorization', `Bearer ${creatorBToken}`);
      expect(nonAdminApprove.status).toBe(403);

      // It's in the admin's pending queue — this also proves the route-mount
      // ordering fix (GET /tournaments/pending must not be swallowed by
      // GET /tournaments/:slug treating "pending" as a slug).
      const pending = await request(app).get('/tournaments/pending').set('Authorization', `Bearer ${adminToken}`);
      expect(pending.status).toBe(200);
      expect(pending.body.tournaments.some((t: { slug: string }) => t.slug === gatedSlug)).toBe(true);

      const approve = await request(app).post(`/tournaments/${gatedSlug}/approve`).set('Authorization', `Bearer ${adminToken}`);
      expect(approve.status).toBe(200);
      expect(approve.body.tournament.is_approved).toBe(true);
      expect(approve.body.tournament.is_public).toBe(true);

      // No longer pending, and now shows up publicly.
      const pendingAfter = await request(app).get('/tournaments/pending').set('Authorization', `Bearer ${adminToken}`);
      expect(pendingAfter.body.tournaments.some((t: { slug: string }) => t.slug === gatedSlug)).toBe(false);
      const listAfter = await request(app).get('/tournaments?limit=100');
      expect(listAfter.body.data.some((t: { slug: string }) => t.slug === gatedSlug)).toBe(true);

      // Approving an already-approved (or nonexistent-pending) slug again 404s.
      const reapprove = await request(app).post(`/tournaments/${gatedSlug}/approve`).set('Authorization', `Bearer ${adminToken}`);
      expect(reapprove.status).toBe(404);
    },
    30000,
  );

  it('rejects an unauthenticated tournament creation attempt', async () => {
    const res = await request(app).post('/tournaments').send({ name: 'No Auth', slug: `no-auth-${randomUUID()}`, season_year: 2027, overs_per_innings: 10, max_overs_per_bowler: 2 });
    expect(res.status).toBe(401);
  });
});

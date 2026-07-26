import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { requireAuth, requireTournamentRole, signAuthToken } from '../src/middleware/auth';

const createdUserEmails: string[] = [];

afterAll(async () => {
  if (createdUserEmails.length) {
    await db.deleteFrom('users').where('email', 'in', createdUserEmails).execute();
  }
});

describe('POST /auth/register', () => {
  it('returns 409 when the email is already registered', async () => {
    const email = `dup-${randomUUID()}@example.com`;
    createdUserEmails.push(email);
    const body = { email, password: 'correct-horse-battery', display_name: 'Test User' };

    const first = await request(app).post('/auth/register').send(body);
    expect(first.status).toBe(201);

    const second = await request(app).post('/auth/register').send(body);
    expect(second.status).toBe(409);
  });
});

describe('requireAuth', () => {
  it('rejects an expired token with 401', async () => {
    const expiredToken = jwt.sign(
      { sub: randomUUID(), is_platform_admin: false },
      process.env.JWT_SECRET!,
      { expiresIn: -10 },
    );

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });
});

describe('requireTournamentRole', () => {
  const tournamentId = randomUUID();
  const organizerUserId = randomUUID();
  const scorerUserId = randomUUID();

  const testApp = express();
  testApp.get(
    '/tournaments/:tournamentId/organizer-only',
    requireAuth,
    requireTournamentRole('organizer'),
    (_req, res) => res.status(200).json({ ok: true }),
  );

  afterAll(async () => {
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('users').where('id', 'in', [organizerUserId, scorerUserId]).execute();
  });

  it('rejects a scorer token with 403 on an organizer-only route', async () => {
    await db
      .insertInto('users')
      .values([
        { id: organizerUserId, email: `org-${randomUUID()}@example.com`, password_hash: 'x', display_name: 'Organizer' },
        { id: scorerUserId, email: `scorer-${randomUUID()}@example.com`, password_hash: 'x', display_name: 'Scorer' },
      ])
      .execute();

    await db
      .insertInto('tournaments')
      .values({ id: tournamentId, name: 'Role Test Tournament', season_year: 2026, slug: `role-test-${tournamentId}` })
      .execute();

    await db
      .insertInto('tournament_memberships')
      .values([
        { tournament_id: tournamentId, user_id: organizerUserId, role: 'organizer' },
        { tournament_id: tournamentId, user_id: scorerUserId, role: 'scorer' },
      ])
      .execute();

    const organizerToken = signAuthToken({ sub: organizerUserId, is_platform_admin: false });
    const scorerToken = signAuthToken({ sub: scorerUserId, is_platform_admin: false });

    const scorerRes = await request(testApp)
      .get(`/tournaments/${tournamentId}/organizer-only`)
      .set('Authorization', `Bearer ${scorerToken}`);
    expect(scorerRes.status).toBe(403);

    const organizerRes = await request(testApp)
      .get(`/tournaments/${tournamentId}/organizer-only`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(organizerRes.status).toBe(200);
  });
});

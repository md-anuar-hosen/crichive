import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';

describe('data requests (GDPR, Phase 8)', () => {
  const adminId = randomUUID();
  const regularUserId = randomUUID();
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) await db.deleteFrom('data_requests').where('id', 'in', createdIds).execute();
    await db.deleteFrom('users').where('id', 'in', [adminId, regularUserId]).execute();
  });

  it('lets anyone raise a request without authentication', async () => {
    const email = `raiser-${randomUUID()}@example.com`;
    const res = await request(app)
      .post('/data-requests')
      .send({ raised_by_email: email, kind: 'erasure', details: 'Please delete my data' });

    expect(res.status).toBe(201);
    expect(res.body.data_request.status).toBe('open');
    createdIds.push(res.body.data_request.id);
  });

  it('rejects listing requests for a non-admin, and allows a platform admin', async () => {
    await db
      .insertInto('users')
      .values([
        { id: adminId, email: `admin-${adminId}@example.com`, password_hash: 'x', display_name: 'Admin', is_platform_admin: true },
        { id: regularUserId, email: `user-${regularUserId}@example.com`, password_hash: 'x', display_name: 'Regular' },
      ])
      .execute();

    const adminToken = signAuthToken({ sub: adminId, is_platform_admin: true });
    const regularToken = signAuthToken({ sub: regularUserId, is_platform_admin: false });

    const forbidden = await request(app).get('/data-requests').set('Authorization', `Bearer ${regularToken}`);
    expect(forbidden.status).toBe(403);

    const allowed = await request(app).get('/data-requests').set('Authorization', `Bearer ${adminToken}`);
    expect(allowed.status).toBe(200);
    expect(Array.isArray(allowed.body.data_requests)).toBe(true);

    const invalidStatus = await request(app).get('/data-requests').query({ status: 'not-a-real-status' }).set('Authorization', `Bearer ${adminToken}`);
    expect(invalidStatus.status).toBe(400);
  });

  it('lets a platform admin resolve a request', async () => {
    const created = await request(app)
      .post('/data-requests')
      .send({ raised_by_email: `resolve-${randomUUID()}@example.com`, kind: 'correction' });
    createdIds.push(created.body.data_request.id);

    const adminToken = signAuthToken({ sub: adminId, is_platform_admin: true });
    const resolved = await request(app)
      .patch(`/data-requests/${created.body.data_request.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved', resolution_note: 'Corrected the date of birth' });

    expect(resolved.status).toBe(200);
    expect(resolved.body.data_request.status).toBe('resolved');
    expect(resolved.body.data_request.resolved_at).not.toBeNull();
  });
});

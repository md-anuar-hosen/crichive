import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index';
import { db } from '../src/db/index';

const FORBIDDEN_SUBSTRINGS = ['suomisport_id', 'date_of_birth', '"phone"', '"email"'];

function assertNoPii(body: unknown) {
  const json = JSON.stringify(body);
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    expect(json).not.toContain(needle);
  }
}

describe('public read API', () => {
  let tournamentSlug: string;
  let teamId: string;
  let playerId: string;
  let matchId: string;

  beforeAll(async () => {
    const tournament = await db
      .selectFrom('tournaments')
      .select(['id', 'slug'])
      .where('slug', '=', 'finn-bangla-2026')
      .executeTakeFirstOrThrow();
    tournamentSlug = tournament.slug;

    const team = await db
      .selectFrom('tournament_teams')
      .select('team_id')
      .where('tournament_id', '=', tournament.id)
      .executeTakeFirstOrThrow();
    teamId = team.team_id;

    const squad = await db
      .selectFrom('team_squads')
      .select('player_id')
      .where('tournament_id', '=', tournament.id)
      .where('team_id', '=', teamId)
      .executeTakeFirstOrThrow();
    playerId = squad.player_id;

    const match = await db
      .selectFrom('matches')
      .select('id')
      .where('tournament_id', '=', tournament.id)
      .executeTakeFirstOrThrow();
    matchId = match.id;
  });

  it('GET /tournaments carries no PII and sets Cache-Control', async () => {
    const res = await request(app).get('/tournaments');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=30');
    assertNoPii(res.body);
  });

  it('GET /tournaments filters by name/org search, country, season year, and ball type', async () => {
    const byName = await request(app).get('/tournaments').query({ q: 'finn-bangla' });
    expect(byName.status).toBe(200);
    expect(byName.body.data.some((t: { slug: string }) => t.slug === tournamentSlug)).toBe(true);

    const noMatch = await request(app).get('/tournaments').query({ q: 'no-such-tournament-name-xyz' });
    expect(noMatch.body.data).toHaveLength(0);

    const byCountry = await request(app).get('/tournaments').query({ country: 'fi' });
    expect(byCountry.status).toBe(200);
    expect(byCountry.body.data.some((t: { slug: string }) => t.slug === tournamentSlug)).toBe(true);

    const wrongCountry = await request(app).get('/tournaments').query({ country: 'us' });
    expect(wrongCountry.body.data.some((t: { slug: string }) => t.slug === tournamentSlug)).toBe(false);

    const bySeason = await request(app).get('/tournaments').query({ season_year: '2026' });
    expect(bySeason.body.data.some((t: { slug: string }) => t.slug === tournamentSlug)).toBe(true);

    const byBall = await request(app).get('/tournaments').query({ ball: 'leather' });
    expect(byBall.status).toBe(200);

    const invalidBallIgnored = await request(app).get('/tournaments').query({ ball: 'not-a-real-ball-type' });
    expect(invalidBallIgnored.status).toBe(200); // an unrecognized filter value is ignored, not a 400 — no user-facing error mode to design for.
  });

  it('GET /tournaments/:slug carries no PII', async () => {
    const res = await request(app).get(`/tournaments/${tournamentSlug}`);
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });

  it('GET /tournaments/:slug/teams carries no PII', async () => {
    const res = await request(app).get(`/tournaments/${tournamentSlug}/teams`);
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });

  it('GET /tournaments/:slug/fixtures carries no PII', async () => {
    const res = await request(app).get(`/tournaments/${tournamentSlug}/fixtures`);
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });

  it('GET /tournaments/:slug/fixtures filters by team and status', async () => {
    const res = await request(app).get(`/tournaments/${tournamentSlug}/fixtures`).query({ team: teamId, status: 'scheduled' });
    expect(res.status).toBe(200);
    for (const fixture of res.body.data) {
      expect([fixture.team_a.id, fixture.team_b.id]).toContain(teamId);
      expect(fixture.status).toBe('scheduled');
    }
  });

  it('GET /tournaments/:slug/standings carries no PII', async () => {
    const res = await request(app).get(`/tournaments/${tournamentSlug}/standings`);
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });

  it('GET /teams/:id carries no PII', async () => {
    const res = await request(app).get(`/teams/${teamId}`);
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });

  it('GET /teams/:id/squad/:tournamentSlug carries no PII', async () => {
    const res = await request(app).get(`/teams/${teamId}/squad/${tournamentSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.squad.length).toBeGreaterThan(0);
    assertNoPii(res.body);
  });

  it('GET /players/:id carries no PII', async () => {
    const res = await request(app).get(`/players/${playerId}`);
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });

  it('GET /matches/:id carries no PII', async () => {
    const res = await request(app).get(`/matches/${matchId}`);
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });

  it('GET /live carries no PII', async () => {
    const res = await request(app).get('/live');
    expect(res.status).toBe(200);
    assertNoPii(res.body);
  });
});

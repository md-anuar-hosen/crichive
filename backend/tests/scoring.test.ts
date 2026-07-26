import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { db } from '../src/db/index';
import { signAuthToken } from '../src/middleware/auth';
import { rebuildAllDerivedTables } from '../src/scripts/rebuildDerived';

describe('scoring API (Phase 5)', () => {
  const tournamentId = randomUUID();
  const organizerId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const p1 = randomUUID(); // team A opener (striker)
  const p2 = randomUUID(); // team A opener (non-striker)
  const p3 = randomUUID(); // team B bowler / opener
  const p4 = randomUUID(); // team B opener (non-striker)
  const matchId = randomUUID();

  let token: string;

  beforeAll(async () => {
    await db
      .insertInto('users')
      .values({ id: organizerId, email: `organizer-${organizerId}@example.com`, password_hash: 'x', display_name: 'Organizer' })
      .execute();

    await db
      .insertInto('tournaments')
      .values({ id: tournamentId, name: 'Scoring API Test', season_year: 2026, slug: `scoring-test-${tournamentId}` })
      .execute();

    await db
      .insertInto('tournament_rules')
      .values({
        tournament_id: tournamentId,
        overs_per_innings: 1,
        max_overs_per_bowler: 1,
        players_per_side: 2,
      })
      .execute();

    await db
      .insertInto('tournament_memberships')
      .values({ tournament_id: tournamentId, user_id: organizerId, role: 'organizer' })
      .execute();

    await db
      .insertInto('teams')
      .values([
        { id: teamAId, name: 'Team A', short_name: 'TMA' },
        { id: teamBId, name: 'Team B', short_name: 'TMB' },
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
        { id: p1, full_name: 'Player One' },
        { id: p2, full_name: 'Player Two' },
        { id: p3, full_name: 'Player Three' },
        { id: p4, full_name: 'Player Four' },
      ])
      .execute();

    await db
      .insertInto('team_squads')
      .values([
        { tournament_id: tournamentId, team_id: teamAId, player_id: p1 },
        { tournament_id: tournamentId, team_id: teamAId, player_id: p2 },
        { tournament_id: tournamentId, team_id: teamBId, player_id: p3 },
        { tournament_id: tournamentId, team_id: teamBId, player_id: p4 },
      ])
      .execute();

    await db
      .insertInto('matches')
      .values({ id: matchId, tournament_id: tournamentId, team_a_id: teamAId, team_b_id: teamBId, match_number: 1 })
      .execute();

    token = signAuthToken({ sub: organizerId, is_platform_admin: false });
  });

  afterAll(async () => {
    await db.deleteFrom('deliveries').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('innings_totals').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('batting_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('bowling_cards').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('partnerships').where('innings_id', 'in', db.selectFrom('innings').select('id').where('match_id', '=', matchId)).execute();
    await db.deleteFrom('innings').where('match_id', '=', matchId).execute();
    await db.deleteFrom('match_players').where('match_id', '=', matchId).execute();
    await db.deleteFrom('matches').where('id', '=', matchId).execute();
    await db.deleteFrom('team_squads').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('players').where('id', 'in', [p1, p2, p3, p4]).execute();
    await db.deleteFrom('tournament_teams').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('teams').where('id', 'in', [teamAId, teamBId]).execute();
    await db.deleteFrom('tournament_memberships').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournament_rules').where('tournament_id', '=', tournamentId).execute();
    await db.deleteFrom('tournaments').where('id', '=', tournamentId).execute();
    await db.deleteFrom('users').where('id', '=', organizerId).execute();
  });

  it('plays a full two-innings match end to end', async () => {
    // Many sequential HTTP + DB round trips against a remote Neon instance; the vitest default of 5s is too tight.
    const toss = await request(app)
      .post(`/matches/${matchId}/toss`)
      .set('Authorization', `Bearer ${token}`)
      .send({ winner_team_id: teamAId, decision: 'bat' });
    expect(toss.status).toBe(201);
    expect(toss.body.innings.innings_number).toBe(1);

    const xiA = await request(app)
      .post(`/matches/${matchId}/playing-xi`)
      .set('Authorization', `Bearer ${token}`)
      .send({ team_id: teamAId, player_ids: [p1, p2], captain_id: p1, keeper_id: p2 });
    expect(xiA.status).toBe(201);

    const xiB = await request(app)
      .post(`/matches/${matchId}/playing-xi`)
      .set('Authorization', `Bearer ${token}`)
      .send({ team_id: teamBId, player_ids: [p3, p4], captain_id: p3, keeper_id: p4 });
    expect(xiB.status).toBe(201);

    // Innings 1: Team A bats, Team B bowls (p3). Six balls, 0+1+4+0+2+6 = 13 runs, no wickets.
    const inningsOneRuns = [0, 1, 4, 0, 2, 6];
    for (const runs of inningsOneRuns) {
      const res = await request(app)
        .post(`/matches/${matchId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          client_event_id: randomUUID(),
          innings_number: 1,
          striker_id: p1,
          non_striker_id: p2,
          bowler_id: p3,
          runs_off_bat: runs,
        });
      expect(res.status).toBe(201);
    }

    const totalsAfterInnings1 = await db
      .selectFrom('innings')
      .innerJoin('innings_totals', 'innings_totals.innings_id', 'innings.id')
      .select(['innings_totals.runs', 'innings_totals.wickets', 'innings_totals.legal_balls'])
      .where('innings.match_id', '=', matchId)
      .where('innings.innings_number', '=', 1)
      .executeTakeFirstOrThrow();
    expect(totalsAfterInnings1).toEqual({ runs: 13, wickets: 0, legal_balls: 6 });

    const closeInnings1 = await request(app)
      .post(`/matches/${matchId}/innings/1/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(closeInnings1.status).toBe(200);
    expect(closeInnings1.body.next_innings_number).toBe(2);

    // Innings 2: Team B bats, Team A bowls (p1), chasing 14. Falls short: 0+0+1+0+2+0 = 3.
    const inningsTwoRuns = [0, 0, 1, 0, 2, 0];
    const repeatedClientEventId = randomUUID();
    for (let i = 0; i < inningsTwoRuns.length; i++) {
      const clientEventId = i === 2 ? repeatedClientEventId : randomUUID();
      const res = await request(app)
        .post(`/matches/${matchId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          client_event_id: clientEventId,
          innings_number: 2,
          striker_id: p3,
          non_striker_id: p4,
          bowler_id: p1,
          runs_off_bat: inningsTwoRuns[i],
        });
      expect(res.status).toBe(201);
    }

    // Retry the 3rd ball of innings 2 with the same client_event_id — must be idempotent.
    const retry = await request(app)
      .post(`/matches/${matchId}/deliveries`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        client_event_id: repeatedClientEventId,
        innings_number: 2,
        striker_id: p3,
        non_striker_id: p4,
        bowler_id: p1,
        runs_off_bat: inningsTwoRuns[2],
      });
    expect(retry.status).toBe(200);
    expect(retry.body.is_duplicate).toBe(true);

    const inningsTwoId = await db
      .selectFrom('innings')
      .select('id')
      .where('match_id', '=', matchId)
      .where('innings_number', '=', 2)
      .executeTakeFirstOrThrow();
    const rowsWithThatClientEventId = await db
      .selectFrom('deliveries')
      .selectAll()
      .where('innings_id', '=', inningsTwoId.id)
      .where('client_event_id', '=', repeatedClientEventId)
      .execute();
    expect(rowsWithThatClientEventId).toHaveLength(1);

    const closeInnings2 = await request(app)
      .post(`/matches/${matchId}/innings/2/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(closeInnings2.status).toBe(200);
    expect(closeInnings2.body.outcome).toEqual({ kind: 'batting_first_won', marginRuns: 10 });

    const finalMatch = await db.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(finalMatch.status).toBe('completed');
    expect(finalMatch.result).toBe('team_a_won');
    expect(finalMatch.win_margin_runs).toBe(10);

    // Snapshot every derived row before rebuilding, then confirm rebuild-derived reproduces them byte-for-byte.
    const before = await snapshotDerivedTables(matchId);
    await db.transaction().execute((trx) => rebuildAllDerivedTables(trx));
    const after = await snapshotDerivedTables(matchId);
    expect(after).toEqual(before);
  }, 30000);
});

async function snapshotDerivedTables(matchId: string) {
  const inningsIds = (
    await db.selectFrom('innings').select('id').where('match_id', '=', matchId).orderBy('innings_number', 'asc').execute()
  ).map((r) => r.id);

  const [totals, batting, bowling, partnerships] = await Promise.all([
    db
      .selectFrom('innings_totals')
      // 'updated_at' legitimately differs between live scoring and a later rebuild pass — excluded on purpose.
      .select(['innings_id', 'runs', 'wickets', 'legal_balls', 'extras'])
      .where('innings_id', 'in', inningsIds)
      .orderBy('innings_id', 'asc')
      .execute(),
    db.selectFrom('batting_cards').selectAll().where('innings_id', 'in', inningsIds).orderBy('innings_id', 'asc').orderBy('position', 'asc').execute(),
    db.selectFrom('bowling_cards').selectAll().where('innings_id', 'in', inningsIds).orderBy('innings_id', 'asc').orderBy('player_id', 'asc').execute(),
    db
      .selectFrom('partnerships')
      // 'id' is a fresh random UUID on every insert, not a value the fold produces — excluded from the comparison on purpose.
      .select(['innings_id', 'wicket_number', 'player_a_id', 'player_b_id', 'runs', 'balls'])
      .where('innings_id', 'in', inningsIds)
      .orderBy('innings_id', 'asc')
      .orderBy('wicket_number', 'asc')
      .execute(),
  ]);

  return { totals, batting, bowling, partnerships };
}

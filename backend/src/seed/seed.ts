import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index';

const SLUG = 'finn-bangla-2026';
const SLOT_MINUTES = 90;
// 2026-08-01 09:00 local time in Helsinki (EEST, UTC+3).
const SEASON_START = new Date('2026-08-01T06:00:00.000Z');

const BATTING_STYLES = ['right_hand', 'left_hand'] as const;
const BOWLING_STYLES = [
  'right_arm_fast', 'right_arm_medium', 'right_arm_offbreak', 'right_arm_legbreak',
  'left_arm_fast', 'left_arm_medium', 'left_arm_orthodox', 'left_arm_chinaman',
  'none',
] as const;

const FINNISH_CITIES = [
  'Helsinki', 'Espoo', 'Vantaa', 'Tampere', 'Turku', 'Oulu', 'Jyväskylä',
  'Kuopio', 'Lahti', 'Pori', 'Kouvola', 'Joensuu', 'Lappeenranta',
  'Hämeenlinna', 'Vaasa', 'Seinäjoki', 'Rovaniemi', 'Mikkeli', 'Kotka', 'Salo',
];

const CLUB_SUFFIXES = [
  'Tigers', 'Warriors', 'Lions', 'Panthers', 'Eagles', 'Falcons', 'Titans',
  'Strikers', 'Gladiators', 'Hunters', 'Legends', 'Knights', 'Riders',
  'Stars', 'Kings', 'Challengers',
];

const BENGALI_FIRST_NAMES = [
  'Mohammad', 'Rahim', 'Karim', 'Sakib', 'Tamim', 'Mushfiqur', 'Mahmudullah',
  'Litton', 'Mustafizur', 'Shoriful', 'Nasum', 'Afif', 'Anamul', 'Ebadot',
  'Taskin', 'Mehidy', 'Nurul', 'Soumya', 'Imrul', 'Nazmul', 'Mominul',
  'Zakir', 'Rubel', 'Enamul', 'Yasir', 'Shakib', 'Jahurul', 'Naeem',
];

const BENGALI_SURNAMES = [
  'Hasan', 'Islam', 'Rahman', 'Hossain', 'Ahmed', 'Alam', 'Khan',
  'Chowdhury', 'Uddin', 'Sarkar', 'Miah', 'Molla', 'Sheikh', 'Talukder',
  'Bhuiyan', 'Mridha', 'Biswas', 'Roy', 'Das', 'Hawladar',
];

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const COMBINING_MARK_RANGE = [0x0300, 0x036f] as const;

function stripDiacritics(value: string): string {
  return Array.from(value.normalize('NFD'))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARK_RANGE[0] || code > COMBINING_MARK_RANGE[1];
    })
    .join('');
}

function buildShortName(city: string, suffix: string, used: Set<string>): string {
  const cityCode = stripDiacritics(city).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  const suffixInitial = suffix.charAt(0).toUpperCase();
  let candidate = `${cityCode}${suffixInitial}`;
  let n = 1;
  while (used.has(candidate)) {
    candidate = `${cityCode}${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function buildTeam(index: number, usedShortNames: Set<string>): { name: string; shortName: string } {
  const comboSize = FINNISH_CITIES.length * CLUB_SUFFIXES.length;
  const city = FINNISH_CITIES[index % FINNISH_CITIES.length];
  const suffix = CLUB_SUFFIXES[Math.floor(index / FINNISH_CITIES.length) % CLUB_SUFFIXES.length];
  const cycle = Math.floor(index / comboSize);
  const name = cycle === 0
    ? `${city} Bangla ${suffix} CC`
    : `${city} Bangla ${suffix} CC ${cycle + 1}`;
  return { name, shortName: buildShortName(city, suffix, usedShortNames) };
}

function generateSuomisportId(used: Set<string>): string {
  let id: string;
  do {
    id = String(Math.floor(100_000_000 + Math.random() * 900_000_000));
  } while (used.has(id));
  used.add(id);
  return id;
}

function groupName(index: number): string {
  return index < 26 ? `Group ${String.fromCharCode(65 + index)}` : `Group ${index + 1}`;
}

/** Circle-method round robin. Odd team counts get a bye each round. */
function roundRobinPairs<T>(items: T[]): [T, T][][] {
  if (items.length < 2) return [];

  const list: (T | null)[] = [...items];
  if (list.length % 2 !== 0) list.push(null);

  const n = list.length;
  const fixed = list[0];
  let rotating = list.slice(1);
  const rounds: [T, T][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const roundTeams = [fixed, ...rotating];
    const pairs: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = roundTeams[i];
      const b = roundTeams[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

function validateConfig(config: Record<string, number>): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value < 1) {
      throw new Error(`${name} must be a positive integer, got ${value}`);
    }
  }
}

async function run(): Promise<void> {
  const TEAMS = intEnv('TEAMS', 42);
  const PLAYERS_PER_TEAM = intEnv('PLAYERS_PER_TEAM', 13);
  const GROUP_SIZE = intEnv('GROUP_SIZE', 6);
  const GROUNDS = intEnv('GROUNDS', 4);
  const OVERS = intEnv('OVERS', 10);

  validateConfig({ TEAMS, PLAYERS_PER_TEAM, GROUP_SIZE, GROUNDS, OVERS });

  await db.transaction().execute(async (trx) => {
    // --- Idempotency: wipe any previous run of this tournament, FK-safe order ---
    const existing = await trx
      .selectFrom('tournaments')
      .select('id')
      .where('slug', '=', SLUG)
      .executeTakeFirst();

    if (existing) {
      const tournamentId = existing.id;

      const teamRows = await trx
        .selectFrom('tournament_teams')
        .select('team_id')
        .where('tournament_id', '=', tournamentId)
        .execute();
      const playerRows = await trx
        .selectFrom('team_squads')
        .select('player_id')
        .where('tournament_id', '=', tournamentId)
        .execute();
      const groundRows = await trx
        .selectFrom('matches')
        .select('ground_id')
        .where('tournament_id', '=', tournamentId)
        .where('ground_id', 'is not', null)
        .execute();

      const teamIds = [...new Set(teamRows.map((r) => r.team_id))];
      const playerIds = [...new Set(playerRows.map((r) => r.player_id))];
      const groundIds = [...new Set(groundRows.map((r) => r.ground_id as string))];

      // Cascades tournament_rules, stages, groups, group_teams, matches,
      // team_squads, tournament_teams, tournament_memberships.
      await trx.deleteFrom('tournaments').where('id', '=', tournamentId).execute();

      if (teamIds.length) await trx.deleteFrom('teams').where('id', 'in', teamIds).execute();
      if (playerIds.length) await trx.deleteFrom('players').where('id', 'in', playerIds).execute();
      if (groundIds.length) await trx.deleteFrom('grounds').where('id', 'in', groundIds).execute();
    }

    // --- Tournament & rules ---
    const tournamentId = randomUUID();
    await trx
      .insertInto('tournaments')
      .values({
        id: tournamentId,
        name: 'Finn-Bangla Cricket Tournament 2026',
        season_year: 2026,
        slug: SLUG,
        organizer_org: 'Cricket Finland',
        country_code: 'FI',
        ball: 'leather',
      })
      .execute();

    await trx
      .insertInto('tournament_rules')
      .values({
        tournament_id: tournamentId,
        overs_per_innings: OVERS,
        max_overs_per_bowler: Math.ceil(OVERS / 5),
        powerplay_overs: Math.ceil(OVERS * 0.3),
      })
      .execute();

    // --- Grounds ---
    const groundIds: string[] = [];
    const groundValues = Array.from({ length: GROUNDS }, (_, i) => {
      const id = randomUUID();
      groundIds.push(id);
      const cycle = Math.floor(i / FINNISH_CITIES.length);
      const city = FINNISH_CITIES[i % FINNISH_CITIES.length];
      return {
        id,
        name: cycle === 0 ? `${city} Cricket Ground` : `${city} Cricket Ground ${cycle + 1}`,
        city,
      };
    });
    await trx.insertInto('grounds').values(groundValues).execute();

    // --- Teams ---
    const usedShortNames = new Set<string>();
    const teams = Array.from({ length: TEAMS }, (_, i) => {
      const { name, shortName } = buildTeam(i, usedShortNames);
      return { id: randomUUID(), name, shortName };
    });
    await trx
      .insertInto('teams')
      .values(teams.map((t) => ({ id: t.id, name: t.name, short_name: t.shortName })))
      .execute();

    await trx
      .insertInto('tournament_teams')
      .values(teams.map((t) => ({ tournament_id: tournamentId, team_id: t.id })))
      .execute();

    // --- Players & squads ---
    const usedSuomisportIds = new Set<string>();
    const playerValues: {
      id: string;
      full_name: string;
      suomisport_id: string;
      batting: (typeof BATTING_STYLES)[number];
      bowling: (typeof BOWLING_STYLES)[number];
    }[] = [];
    const squadValues: {
      id: string;
      tournament_id: string;
      team_id: string;
      player_id: string;
      jersey_number: number;
      is_captain: boolean;
      is_keeper: boolean;
      licence_verified: boolean;
      licence_verified_at: Date;
      approved_at: Date;
    }[] = [];

    for (const team of teams) {
      for (let p = 0; p < PLAYERS_PER_TEAM; p++) {
        const playerId = randomUUID();
        playerValues.push({
          id: playerId,
          full_name: `${pick(BENGALI_FIRST_NAMES)} ${pick(BENGALI_SURNAMES)}`,
          suomisport_id: generateSuomisportId(usedSuomisportIds),
          batting: pick(BATTING_STYLES),
          bowling: pick(BOWLING_STYLES),
        });
        squadValues.push({
          id: randomUUID(),
          tournament_id: tournamentId,
          team_id: team.id,
          player_id: playerId,
          jersey_number: p + 1,
          is_captain: p === 0,
          is_keeper: p === 1,
          licence_verified: true,
          licence_verified_at: new Date(),
          approved_at: new Date(),
        });
      }
    }
    await trx.insertInto('players').values(playerValues).execute();
    await trx.insertInto('team_squads').values(squadValues).execute();

    // --- Stage & groups ---
    const stageId = randomUUID();
    await trx
      .insertInto('stages')
      .values({ id: stageId, tournament_id: tournamentId, kind: 'group', name: 'Group Stage', sequence: 1 })
      .execute();

    const groupCount = Math.max(1, Math.ceil(TEAMS / GROUP_SIZE));
    const baseSize = Math.floor(TEAMS / groupCount);
    const remainder = TEAMS % groupCount;

    const groups: { id: string; name: string; teams: typeof teams }[] = [];
    let cursor = 0;
    for (let i = 0; i < groupCount; i++) {
      const size = baseSize + (i < remainder ? 1 : 0);
      groups.push({ id: randomUUID(), name: groupName(i), teams: teams.slice(cursor, cursor + size) });
      cursor += size;
    }

    await trx
      .insertInto('groups')
      .values(groups.map((g) => ({ id: g.id, stage_id: stageId, name: g.name })))
      .execute();

    await trx
      .insertInto('group_teams')
      .values(groups.flatMap((g) => g.teams.map((t) => ({ group_id: g.id, team_id: t.id }))))
      .execute();

    // --- Fixtures: full round robin per group, spread across grounds in 90-min slots ---
    const fixtures = groups.flatMap((group) =>
      roundRobinPairs(group.teams).flatMap((round) =>
        round.map(([a, b]) => ({ groupId: group.id, teamAId: a.id, teamBId: b.id })),
      ),
    );

    const matchValues = fixtures.map((fixture, i) => {
      const groundIndex = i % groundIds.length;
      const slotIndex = Math.floor(i / groundIds.length);
      return {
        id: randomUUID(),
        tournament_id: tournamentId,
        stage_id: stageId,
        group_id: fixture.groupId,
        match_number: i + 1,
        team_a_id: fixture.teamAId,
        team_b_id: fixture.teamBId,
        ground_id: groundIds[groundIndex],
        scheduled_start: new Date(SEASON_START.getTime() + slotIndex * SLOT_MINUTES * 60_000),
      };
    });

    if (matchValues.length) {
      await trx.insertInto('matches').values(matchValues).execute();
    }

    console.log(
      `Seeded ${SLUG}: ${TEAMS} teams, ${PLAYERS_PER_TEAM} players/team, ` +
        `${groupCount} group(s), ${GROUNDS} ground(s), ${matchValues.length} fixture(s).`,
    );
  });
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });

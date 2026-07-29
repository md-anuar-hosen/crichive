import { Router } from 'express';
import { sql } from 'kysely';
import { db } from '../db/index';
import { selectBestPerformer } from '../domain/scoring';
import { parsePagination, paginated } from '../lib/pagination';
import { serializePlayer, serializeTeam, serializeTournament } from '../serializers/public';
import { getMatchScorecard } from '../services/matchScorecard';

const router = Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'public, max-age=30');
  next();
});

async function findTournamentBySlug(slug: string) {
  return db.selectFrom('tournaments').selectAll().where('slug', '=', slug).executeTakeFirst();
}

router.get('/tournaments', async (req, res) => {
  const pagination = parsePagination(req.query);

  const [rows, countRow] = await Promise.all([
    db
      .selectFrom('tournaments')
      .selectAll()
      .where('is_public', '=', true)
      .orderBy('season_year', 'desc')
      .orderBy('name', 'asc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute(),
    db
      .selectFrom('tournaments')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('is_public', '=', true)
      .executeTakeFirstOrThrow(),
  ]);

  res.json(paginated(rows.map(serializeTournament), pagination, Number(countRow.count)));
});

router.get('/tournaments/:slug', async (req, res) => {
  const tournament = await findTournamentBySlug(req.params.slug);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  const rules = await db
    .selectFrom('tournament_rules')
    .selectAll()
    .where('tournament_id', '=', tournament.id)
    .executeTakeFirst();

  res.json({
    ...serializeTournament(tournament),
    rules: rules
      ? {
          overs_per_innings: rules.overs_per_innings,
          balls_per_over: rules.balls_per_over,
          max_overs_per_bowler: rules.max_overs_per_bowler,
          powerplay_overs: rules.powerplay_overs,
          players_per_side: rules.players_per_side,
          wide_runs: rules.wide_runs,
          noball_runs: rules.noball_runs,
          free_hit_after_noball: rules.free_hit_after_noball,
          points_win: rules.points_win,
          points_tie: rules.points_tie,
          points_no_result: rules.points_no_result,
          points_loss: rules.points_loss,
          bonus_point_enabled: rules.bonus_point_enabled,
          super_over_on_tie: rules.super_over_on_tie,
          dls_enabled: rules.dls_enabled,
        }
      : null,
  });
});

router.get('/tournaments/:slug/teams', async (req, res) => {
  const tournament = await findTournamentBySlug(req.params.slug);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  const pagination = parsePagination(req.query);

  const [rows, countRow] = await Promise.all([
    db
      .selectFrom('tournament_teams')
      .innerJoin('teams', 'teams.id', 'tournament_teams.team_id')
      .select(['teams.id', 'teams.name', 'teams.short_name', 'teams.logo_url', 'teams.home_city'])
      .where('tournament_teams.tournament_id', '=', tournament.id)
      .orderBy('teams.name', 'asc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute(),
    db
      .selectFrom('tournament_teams')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('tournament_id', '=', tournament.id)
      .executeTakeFirstOrThrow(),
  ]);

  res.json(paginated(rows.map(serializeTeam), pagination, Number(countRow.count)));
});

router.get('/tournaments/:slug/fixtures', async (req, res) => {
  const tournament = await findTournamentBySlug(req.params.slug);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  const pagination = parsePagination(req.query);
  const { group, date, team, status } = req.query;

  let query = db.selectFrom('matches').where('matches.tournament_id', '=', tournament.id);
  let countQuery = db.selectFrom('matches').where('matches.tournament_id', '=', tournament.id);

  if (typeof group === 'string') {
    query = query.where('matches.group_id', '=', group);
    countQuery = countQuery.where('matches.group_id', '=', group);
  }
  if (typeof team === 'string') {
    query = query.where((eb) => eb.or([eb('matches.team_a_id', '=', team), eb('matches.team_b_id', '=', team)]));
    countQuery = countQuery.where((eb) => eb.or([eb('matches.team_a_id', '=', team), eb('matches.team_b_id', '=', team)]));
  }
  if (typeof status === 'string') {
    query = query.where('matches.status', '=', status as never);
    countQuery = countQuery.where('matches.status', '=', status as never);
  }
  if (typeof date === 'string') {
    query = query.where((eb) =>
      eb.and([eb('matches.scheduled_start', '>=', new Date(`${date}T00:00:00.000Z`)), eb('matches.scheduled_start', '<', new Date(`${date}T23:59:59.999Z`))]),
    );
    countQuery = countQuery.where((eb) =>
      eb.and([eb('matches.scheduled_start', '>=', new Date(`${date}T00:00:00.000Z`)), eb('matches.scheduled_start', '<', new Date(`${date}T23:59:59.999Z`))]),
    );
  }

  const [rows, countRow] = await Promise.all([
    query
      .innerJoin('teams as team_a', 'team_a.id', 'matches.team_a_id')
      .innerJoin('teams as team_b', 'team_b.id', 'matches.team_b_id')
      .leftJoin('grounds', 'grounds.id', 'matches.ground_id')
      .select([
        'matches.id',
        'matches.match_number',
        'matches.scheduled_start',
        'matches.status',
        'matches.result',
        'matches.result_note',
        'matches.win_margin_runs',
        'matches.win_margin_wickets',
        'team_a.id as team_a_id',
        'team_a.name as team_a_name',
        'team_a.short_name as team_a_short_name',
        'team_b.id as team_b_id',
        'team_b.name as team_b_name',
        'team_b.short_name as team_b_short_name',
        'grounds.id as ground_id',
        'grounds.name as ground_name',
        'grounds.city as ground_city',
      ])
      .orderBy('matches.scheduled_start', 'asc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute(),
    countQuery.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow(),
  ]);

  const data = rows.map((m) => ({
    id: m.id,
    match_number: m.match_number,
    scheduled_start: m.scheduled_start,
    status: m.status,
    result: m.result,
    result_note: m.result_note,
    win_margin_runs: m.win_margin_runs,
    win_margin_wickets: m.win_margin_wickets,
    team_a: { id: m.team_a_id, name: m.team_a_name, short_name: m.team_a_short_name },
    team_b: { id: m.team_b_id, name: m.team_b_name, short_name: m.team_b_short_name },
    ground: m.ground_id ? { id: m.ground_id, name: m.ground_name, city: m.ground_city } : null,
  }));

  res.json(paginated(data, pagination, Number(countRow.count)));
});

router.get('/tournaments/:slug/standings', async (req, res) => {
  const tournament = await findTournamentBySlug(req.params.slug);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  const rows = await db
    .selectFrom('standings')
    .innerJoin('groups', 'groups.id', 'standings.group_id')
    .innerJoin('stages', 'stages.id', 'groups.stage_id')
    .innerJoin('teams', 'teams.id', 'standings.team_id')
    .select([
      'groups.id as group_id',
      'groups.name as group_name',
      'teams.id as team_id',
      'teams.name as team_name',
      'teams.short_name as team_short_name',
      'standings.played',
      'standings.won',
      'standings.lost',
      'standings.tied',
      'standings.no_result',
      'standings.points',
      'standings.net_run_rate',
      'standings.rank',
    ])
    .where('stages.tournament_id', '=', tournament.id)
    .orderBy('groups.name', 'asc')
    .orderBy((eb) => eb.ref('standings.rank'), 'asc')
    .orderBy('standings.points', 'desc')
    .orderBy('standings.net_run_rate', 'desc')
    .orderBy('teams.name', 'asc')
    .execute();

  const groups = new Map<string, { group_id: string; group_name: string; standings: unknown[] }>();
  for (const row of rows) {
    if (!groups.has(row.group_id)) {
      groups.set(row.group_id, { group_id: row.group_id, group_name: row.group_name, standings: [] });
    }
    groups.get(row.group_id)!.standings.push({
      team: { id: row.team_id, name: row.team_name, short_name: row.team_short_name },
      played: row.played,
      won: row.won,
      lost: row.lost,
      tied: row.tied,
      no_result: row.no_result,
      points: row.points,
      net_run_rate: row.net_run_rate,
      rank: row.rank,
    });
  }

  res.json({ groups: [...groups.values()] });
});

// ---------------------------------------------------------------------------
// GET /tournaments/:slug/awards — Player of the Tournament + leaderboards
// ---------------------------------------------------------------------------

router.get('/tournaments/:slug/awards', async (req, res) => {
  const tournament = await findTournamentBySlug(req.params.slug);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  // Same "which matches count" convention as standings/NRR: completed and
  // abandoned matches contribute (the cricket in them really happened),
  // super-over innings are excluded, matches still in progress don't count yet.
  const [battingAgg, bowlingAgg, fieldingAgg] = await Promise.all([
    db
      .selectFrom('batting_cards')
      .innerJoin('innings', 'innings.id', 'batting_cards.innings_id')
      .innerJoin('matches', 'matches.id', 'innings.match_id')
      .innerJoin('players', 'players.id', 'batting_cards.player_id')
      .select((eb) => [
        'batting_cards.player_id',
        'players.full_name',
        'players.display_name',
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.runs'), sql<string>`0`).as('runs'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.fours'), sql<string>`0`).as('fours'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.sixes'), sql<string>`0`).as('sixes'),
      ])
      .where('matches.tournament_id', '=', tournament.id)
      .where('matches.status', 'in', ['completed', 'abandoned'])
      .where('innings.is_super_over', '=', false)
      .groupBy(['batting_cards.player_id', 'players.full_name', 'players.display_name'])
      .execute(),
    db
      .selectFrom('bowling_cards')
      .innerJoin('innings', 'innings.id', 'bowling_cards.innings_id')
      .innerJoin('matches', 'matches.id', 'innings.match_id')
      .innerJoin('players', 'players.id', 'bowling_cards.player_id')
      .select((eb) => [
        'bowling_cards.player_id',
        'players.full_name',
        'players.display_name',
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.wickets'), sql<string>`0`).as('wickets'),
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.maidens'), sql<string>`0`).as('maidens'),
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.runs_conceded'), sql<string>`0`).as('runs_conceded'),
      ])
      .where('matches.tournament_id', '=', tournament.id)
      .where('matches.status', 'in', ['completed', 'abandoned'])
      .where('innings.is_super_over', '=', false)
      .groupBy(['bowling_cards.player_id', 'players.full_name', 'players.display_name'])
      .execute(),
    db
      .selectFrom('deliveries')
      .innerJoin('innings', 'innings.id', 'deliveries.innings_id')
      .innerJoin('matches', 'matches.id', 'innings.match_id')
      .select((eb) => [
        'deliveries.fielder_id as player_id',
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'caught').as('catches'),
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'stumped').as('stumpings'),
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'run_out').as('run_outs'),
      ])
      .where('matches.tournament_id', '=', tournament.id)
      .where('matches.status', 'in', ['completed', 'abandoned'])
      .where('innings.is_super_over', '=', false)
      .where('deliveries.voided_at', 'is', null)
      .where('deliveries.fielder_id', 'is not', null)
      .groupBy('deliveries.fielder_id')
      .execute(),
  ]);

  interface Aggregate {
    playerId: string;
    name: string | null;
    runs: number;
    fours: number;
    sixes: number;
    wickets: number;
    maidens: number;
    runsConceded: number;
    catches: number;
    stumpings: number;
    runOuts: number;
  }
  const players = new Map<string, Aggregate>();
  const ensure = (playerId: string, name?: string | null): Aggregate => {
    let p = players.get(playerId);
    if (!p) {
      p = { playerId, name: name ?? null, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, runsConceded: 0, catches: 0, stumpings: 0, runOuts: 0 };
      players.set(playerId, p);
    }
    if (name && !p.name) p.name = name;
    return p;
  };

  for (const row of battingAgg) {
    const p = ensure(row.player_id, row.display_name ?? row.full_name);
    p.runs = Number(row.runs);
    p.fours = Number(row.fours);
    p.sixes = Number(row.sixes);
  }
  for (const row of bowlingAgg) {
    const p = ensure(row.player_id, row.display_name ?? row.full_name);
    p.wickets = Number(row.wickets);
    p.maidens = Number(row.maidens);
    p.runsConceded = Number(row.runs_conceded);
  }
  for (const row of fieldingAgg) {
    const p = ensure(row.player_id as string);
    p.catches = Number(row.catches);
    p.stumpings = Number(row.stumpings);
    p.runOuts = Number(row.run_outs);
  }

  const all = [...players.values()];
  const playerOfTournamentId = selectBestPerformer(
    all.map((p) => ({
      playerId: p.playerId,
      runs: p.runs,
      fours: p.fours,
      sixes: p.sixes,
      wickets: p.wickets,
      maidens: p.maidens,
      catches: p.catches,
      stumpings: p.stumpings,
      runOuts: p.runOuts,
    })),
  );
  const playerOfTournament = playerOfTournamentId ? all.find((p) => p.playerId === playerOfTournamentId) : undefined;

  const mostRuns = [...all]
    .filter((p) => p.runs > 0)
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 5)
    .map((p) => ({ id: p.playerId, name: p.name, runs: p.runs, fours: p.fours, sixes: p.sixes }));

  const mostWickets = [...all]
    .filter((p) => p.wickets > 0)
    .sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded)
    .slice(0, 5)
    .map((p) => ({ id: p.playerId, name: p.name, wickets: p.wickets, maidens: p.maidens }));

  res.json({
    player_of_tournament: playerOfTournament ? { id: playerOfTournament.playerId, name: playerOfTournament.name } : null,
    most_runs: mostRuns,
    most_wickets: mostWickets,
  });
});

router.get('/teams/:id', async (req, res) => {
  const team = await db.selectFrom('teams').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  res.json(serializeTeam(team));
});

router.get('/teams/:id/squad/:tournamentSlug', async (req, res) => {
  const [team, tournament] = await Promise.all([
    db.selectFrom('teams').select('id').where('id', '=', req.params.id).executeTakeFirst(),
    findTournamentBySlug(req.params.tournamentSlug),
  ]);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  const rows = await db
    .selectFrom('team_squads')
    .innerJoin('players', 'players.id', 'team_squads.player_id')
    .select([
      'players.id',
      'players.full_name',
      'players.display_name',
      'players.batting',
      'players.bowling',
      'players.photo_url',
      'team_squads.jersey_number',
      'team_squads.is_captain',
      'team_squads.is_keeper',
      'team_squads.approved_at',
      'team_squads.licence_verified',
    ])
    .where('team_squads.team_id', '=', team.id)
    .where('team_squads.tournament_id', '=', tournament.id)
    .orderBy('team_squads.jersey_number', 'asc')
    .execute();

  res.json({
    squad: rows.map((r) => ({
      ...serializePlayer(r),
      jersey_number: r.jersey_number,
      is_captain: r.is_captain,
      is_keeper: r.is_keeper,
      is_approved: r.approved_at !== null,
      licence_verified: r.licence_verified,
    })),
  });
});

// Registered before /players/:id — otherwise Express would match "search" as an :id.
router.get('/players/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) {
    res.json({ data: [] });
    return;
  }

  const rows = await db
    .selectFrom('players')
    .select(['id', 'full_name', 'display_name', 'batting', 'bowling', 'photo_url'])
    .where('deleted_at', 'is', null)
    .where('merged_into_id', 'is', null)
    .where('full_name', 'ilike', `%${q}%`)
    .orderBy('full_name', 'asc')
    .limit(20)
    .execute();

  res.json({ data: rows.map(serializePlayer) });
});

router.get('/players/:id', async (req, res) => {
  const player = await db.selectFrom('players').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }

  const stats = await db
    .selectFrom('player_career_stats')
    .selectAll()
    .where('player_id', '=', player.id)
    .executeTakeFirst();

  res.json({
    ...serializePlayer(player),
    career_stats: stats
      ? {
          matches: stats.matches,
          innings_batted: stats.innings_batted,
          runs: stats.runs,
          balls_faced: stats.balls_faced,
          highest_score: stats.highest_score,
          not_outs: stats.not_outs,
          fifties: stats.fifties,
          hundreds: stats.hundreds,
          fours: stats.fours,
          sixes: stats.sixes,
          innings_bowled: stats.innings_bowled,
          legal_balls_bowled: stats.legal_balls_bowled,
          runs_conceded: stats.runs_conceded,
          wickets: stats.wickets,
          best_bowling_wkts: stats.best_bowling_wkts,
          best_bowling_runs: stats.best_bowling_runs,
          catches: stats.catches,
          stumpings: stats.stumpings,
          run_outs: stats.run_outs,
        }
      : null,
  });
});

router.get('/matches/:id', async (req, res) => {
  const scorecard = await getMatchScorecard(req.params.id);
  if (!scorecard) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  res.json(scorecard);
});

// Ball-by-ball feed for a single innings: powers Manhattan/Worm/wagon-wheel
// charts and a commentary list client-side. No player names here (only
// IDs) -- the client already has names from the scorecard/squad it fetched
// for this match, so nothing extra to strip for privacy.
router.get('/matches/:id/innings/:n/deliveries', async (req, res) => {
  const match = await db.selectFrom('matches').select('id').where('id', '=', req.params.id).executeTakeFirst();
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }

  const inningsNumber = Number.parseInt(req.params.n, 10);
  if (!Number.isInteger(inningsNumber) || inningsNumber < 1) {
    res.status(400).json({ error: 'Invalid innings number' });
    return;
  }

  const innings = await db
    .selectFrom('innings')
    .select('id')
    .where('match_id', '=', match.id)
    .where('innings_number', '=', inningsNumber)
    .executeTakeFirst();
  if (!innings) {
    res.status(404).json({ error: `Innings ${inningsNumber} not found for this match` });
    return;
  }

  const pagination = parsePagination(req.query);

  const [rows, countRow] = await Promise.all([
    db
      .selectFrom('deliveries')
      .select([
        'over_number',
        'ball_in_over',
        'sequence',
        'striker_id',
        'non_striker_id',
        'bowler_id',
        'runs_off_bat',
        'extra_wides',
        'extra_noballs',
        'extra_byes',
        'extra_legbyes',
        'extra_penalty',
        'is_legal_delivery',
        'is_free_hit',
        'wicket_kind',
        'player_out_id',
        'fielder_id',
        'wagon_angle_deg',
        'wagon_distance',
        'commentary',
      ])
      .where('innings_id', '=', innings.id)
      .where('voided_at', 'is', null)
      .orderBy('sequence', 'asc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute(),
    db
      .selectFrom('deliveries')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('innings_id', '=', innings.id)
      .where('voided_at', 'is', null)
      .executeTakeFirstOrThrow(),
  ]);

  res.json(paginated(rows, pagination, Number(countRow.count)));
});

router.get('/live', async (_req, res) => {
  const rows = await db
    .selectFrom('matches')
    .innerJoin('teams as team_a', 'team_a.id', 'matches.team_a_id')
    .innerJoin('teams as team_b', 'team_b.id', 'matches.team_b_id')
    .innerJoin('tournaments', 'tournaments.id', 'matches.tournament_id')
    .select([
      'matches.id',
      'matches.status',
      'matches.scheduled_start',
      'tournaments.slug as tournament_slug',
      'tournaments.name as tournament_name',
      'team_a.id as team_a_id',
      'team_a.name as team_a_name',
      'team_a.short_name as team_a_short_name',
      'team_b.id as team_b_id',
      'team_b.name as team_b_name',
      'team_b.short_name as team_b_short_name',
    ])
    .where('matches.status', 'in', ['live', 'innings_break', 'toss_done'])
    .orderBy('matches.actual_start', 'asc')
    .execute();

  res.json({
    matches: rows.map((m) => ({
      id: m.id,
      status: m.status,
      scheduled_start: m.scheduled_start,
      tournament: { slug: m.tournament_slug, name: m.tournament_name },
      team_a: { id: m.team_a_id, name: m.team_a_name, short_name: m.team_a_short_name },
      team_b: { id: m.team_b_id, name: m.team_b_name, short_name: m.team_b_short_name },
    })),
  });
});

export default router;

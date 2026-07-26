import { Router } from 'express';
import { db } from '../db/index';
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
          points_win: rules.points_win,
          points_tie: rules.points_tie,
          points_no_result: rules.points_no_result,
          points_loss: rules.points_loss,
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
    })),
  });
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

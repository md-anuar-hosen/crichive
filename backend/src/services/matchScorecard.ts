import { db } from '../db/index';
import { formatDismissal, isFollowOnEligible } from '../domain/scoring';
import { serializeGround, serializePlayer } from '../serializers/public';
import { loadTournamentRules } from './rules';

/**
 * Full match scorecard, read entirely from derived tables (innings_totals,
 * batting_cards, bowling_cards, partnerships) — never recomputed live from
 * deliveries. Returns null if the match doesn't exist.
 */
export async function getMatchScorecard(matchId: string) {
  const match = await db
    .selectFrom('matches')
    .innerJoin('teams as team_a', 'team_a.id', 'matches.team_a_id')
    .innerJoin('teams as team_b', 'team_b.id', 'matches.team_b_id')
    .innerJoin('tournaments', 'tournaments.id', 'matches.tournament_id')
    .leftJoin('grounds', 'grounds.id', 'matches.ground_id')
    .leftJoin('players as player_of_match', 'player_of_match.id', 'matches.player_of_match_id')
    .select([
      'matches.id',
      'matches.tournament_id',
      'matches.match_number',
      'matches.scheduled_start',
      'matches.actual_start',
      'matches.status',
      'matches.current_day',
      'matches.toss_decision',
      'matches.toss_winner_id',
      'matches.result',
      'matches.result_note',
      'matches.win_margin_runs',
      'matches.win_margin_wickets',
      'matches.player_of_match_id',
      'player_of_match.full_name as player_of_match_full_name',
      'player_of_match.display_name as player_of_match_display_name',
      'tournaments.slug as tournament_slug',
      'tournaments.name as tournament_name',
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
    .where('matches.id', '=', matchId)
    .executeTakeFirst();

  if (!match) return null;

  const rules = await loadTournamentRules(db, match.tournament_id);

  const inningsRows = await db
    .selectFrom('innings')
    .selectAll()
    .where('match_id', '=', match.id)
    .orderBy('innings_number', 'asc')
    .execute();

  const innings = await Promise.all(
    inningsRows.map(async (inn) => {
      const [totals, battingRows, bowlingRows, partnershipRows, interruptionRows, dismissalRows] = await Promise.all([
        db.selectFrom('innings_totals').selectAll().where('innings_id', '=', inn.id).executeTakeFirst(),
        db
          .selectFrom('batting_cards')
          .innerJoin('players', 'players.id', 'batting_cards.player_id')
          .select([
            'players.id',
            'players.full_name',
            'players.display_name',
            'players.batting',
            'players.bowling',
            'players.photo_url',
            'batting_cards.runs',
            'batting_cards.balls_faced',
            'batting_cards.fours',
            'batting_cards.sixes',
            'batting_cards.is_out',
            'batting_cards.position',
          ])
          .where('batting_cards.innings_id', '=', inn.id)
          .orderBy('batting_cards.position', 'asc')
          .execute(),
        db
          .selectFrom('bowling_cards')
          .innerJoin('players', 'players.id', 'bowling_cards.player_id')
          .select([
            'players.id',
            'players.full_name',
            'players.display_name',
            'players.batting',
            'players.bowling',
            'players.photo_url',
            'bowling_cards.legal_balls',
            'bowling_cards.runs_conceded',
            'bowling_cards.wickets',
            'bowling_cards.maidens',
            'bowling_cards.wides',
            'bowling_cards.noballs',
            'bowling_cards.dots',
          ])
          .where('bowling_cards.innings_id', '=', inn.id)
          .execute(),
        db
          .selectFrom('partnerships')
          .innerJoin('players as player_a', 'player_a.id', 'partnerships.player_a_id')
          .innerJoin('players as player_b', 'player_b.id', 'partnerships.player_b_id')
          .select([
            'partnerships.wicket_number',
            'partnerships.runs',
            'partnerships.balls',
            'player_a.id as player_a_id',
            'player_a.full_name as player_a_full_name',
            'player_a.display_name as player_a_display_name',
            'player_b.id as player_b_id',
            'player_b.full_name as player_b_full_name',
            'player_b.display_name as player_b_display_name',
          ])
          .where('partnerships.innings_id', '=', inn.id)
          .orderBy('partnerships.wicket_number', 'asc')
          .execute(),
        db
          .selectFrom('match_interruptions')
          .select(['id', 'overs_remaining_before', 'overs_remaining_after', 'wickets_lost_at', 'reason', 'created_at'])
          .where('innings_id', '=', inn.id)
          .orderBy('created_at', 'asc')
          .execute(),
        db
          .selectFrom('deliveries')
          .innerJoin('players as bowler', 'bowler.id', 'deliveries.bowler_id')
          .leftJoin('players as fielder', 'fielder.id', 'deliveries.fielder_id')
          .select([
            'deliveries.player_out_id',
            'deliveries.wicket_kind',
            'deliveries.bowler_id',
            'bowler.full_name as bowler_full_name',
            'bowler.display_name as bowler_display_name',
            'deliveries.fielder_id',
            'fielder.full_name as fielder_full_name',
            'fielder.display_name as fielder_display_name',
          ])
          .where('deliveries.innings_id', '=', inn.id)
          .where('deliveries.player_out_id', 'is not', null)
          .where('deliveries.voided_at', 'is', null)
          .orderBy('deliveries.sequence', 'asc')
          .execute(),
      ]);

      // A retired-hurt batter can return and be dismissed properly later in the
      // same innings — ordering by sequence means the later, real dismissal
      // wins the map entry over the earlier "retired hurt" one.
      const dismissalTextByPlayerId = new Map(
        dismissalRows.map((d) => [
          d.player_out_id as string,
          formatDismissal({
            kind: d.wicket_kind!,
            bowlerId: d.bowler_id,
            bowlerName: d.bowler_display_name ?? d.bowler_full_name,
            fielderId: d.fielder_id ?? undefined,
            fielderName: d.fielder_display_name ?? d.fielder_full_name ?? undefined,
          }),
        ]),
      );

      return {
        innings_number: inn.innings_number,
        batting_team_id: inn.batting_team_id,
        bowling_team_id: inn.bowling_team_id,
        is_super_over: inn.is_super_over,
        target: inn.target,
        max_overs: inn.max_overs,
        declared: inn.declared,
        closed_at: inn.closed_at,
        totals: totals
          ? { runs: totals.runs, wickets: totals.wickets, legal_balls: totals.legal_balls, extras: totals.extras }
          : null,
        batting: battingRows.map((r) => ({
          ...serializePlayer(r),
          runs: r.runs,
          balls_faced: r.balls_faced,
          fours: r.fours,
          sixes: r.sixes,
          is_out: r.is_out,
          dismissal_text: r.is_out ? (dismissalTextByPlayerId.get(r.id) ?? null) : null,
          position: r.position,
        })),
        bowling: bowlingRows.map((r) => ({
          ...serializePlayer(r),
          legal_balls: r.legal_balls,
          runs_conceded: r.runs_conceded,
          wickets: r.wickets,
          maidens: r.maidens,
          wides: r.wides,
          noballs: r.noballs,
          dots: r.dots,
        })),
        partnerships: partnershipRows.map((p) => ({
          wicket_number: p.wicket_number,
          runs: p.runs,
          balls: p.balls,
          player_a: { id: p.player_a_id, name: p.player_a_display_name ?? p.player_a_full_name },
          player_b: { id: p.player_b_id, name: p.player_b_display_name ?? p.player_b_full_name },
        })),
        // "CricHive Rain Rule" interruption log for this innings — never label this DLS/D-L.
        interruptions: interruptionRows.map((r) => ({
          id: r.id,
          overs_remaining_before: Number(r.overs_remaining_before),
          overs_remaining_after: Number(r.overs_remaining_after),
          wickets_lost_at: r.wickets_lost_at,
          reason: r.reason,
          created_at: r.created_at,
        })),
      };
    }),
  );

  // Only meaningful for a Test match sitting right at the innings 2 -> 3
  // transition: whether the side that just bowled second may enforce a
  // follow-on. The organizer decides via POST /matches/:id/next-innings.
  const closedInnings = innings.filter((i) => i.closed_at !== null);
  const followOnAvailable =
    rules.matchType === 'test' &&
    match.status === 'innings_break' &&
    closedInnings.length === 2 &&
    innings.every((i) => i.innings_number <= 2) &&
    isFollowOnEligible({ runs: closedInnings[0].totals?.runs ?? 0 }, { runs: closedInnings[1].totals?.runs ?? 0 }, rules);

  return {
    id: match.id,
    match_number: match.match_number,
    tournament: { slug: match.tournament_slug, name: match.tournament_name },
    scheduled_start: match.scheduled_start,
    actual_start: match.actual_start,
    status: match.status,
    match_type: rules.matchType,
    current_day: match.current_day,
    days_per_match: rules.daysPerMatch,
    follow_on_available: followOnAvailable,
    toss_decision: match.toss_decision,
    toss_winner_id: match.toss_winner_id,
    result: match.result,
    result_note: match.result_note,
    win_margin_runs: match.win_margin_runs,
    win_margin_wickets: match.win_margin_wickets,
    player_of_match: match.player_of_match_id
      ? { id: match.player_of_match_id, name: match.player_of_match_display_name ?? match.player_of_match_full_name }
      : null,
    team_a: { id: match.team_a_id, name: match.team_a_name, short_name: match.team_a_short_name },
    team_b: { id: match.team_b_id, name: match.team_b_name, short_name: match.team_b_short_name },
    ground: match.ground_id ? serializeGround({ id: match.ground_id, name: match.ground_name!, city: match.ground_city }) : null,
    innings,
  };
}

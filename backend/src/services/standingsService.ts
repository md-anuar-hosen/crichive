import { db } from '../db/index';
import {
  computeMatchPoints,
  computeNetRunRate,
  rankStandings,
  type InningsNrrInput,
  type MatchOutcomeForTeam,
  type StandingsRow,
} from '../domain/standings';
import { loadTournamentRules } from './rules';

/** 'abandoned' carries no head-to-head result, same as 'no_result', for standings purposes. */
function outcomeForTeam(
  teamId: string,
  match: { team_a_id: string; team_b_id: string; result: string | null; winner_team_id: string | null },
): MatchOutcomeForTeam {
  if (match.result === 'tie') return 'tie';
  if (match.result === 'draw') return 'draw';
  if (match.result === 'no_result' || match.result === 'abandoned' || !match.result) return 'no_result';
  return match.winner_team_id === teamId ? 'win' : 'loss';
}

/**
 * Recomputes the whole standings table for one group from every completed
 * match in it — a full replace, same pattern as the derived scoring tables.
 */
export async function recomputeGroupStandings(groupId: string): Promise<void> {
  const groupTeams = await db.selectFrom('group_teams').select(['team_id']).where('group_id', '=', groupId).execute();
  const teamIds = groupTeams.map((t) => t.team_id);
  if (teamIds.length === 0) return;

  const teams = await db.selectFrom('teams').select(['id', 'name']).where('id', 'in', teamIds).execute();
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  const rawMatches = await db
    .selectFrom('matches')
    .select(['id', 'tournament_id', 'team_a_id', 'team_b_id', 'result', 'winner_team_id', 'overs_override', 'status'])
    .where('group_id', '=', groupId)
    .where('status', 'in', ['completed', 'abandoned', 'forfeited'])
    .execute();

  // A group-stage match always has both teams known when created — only
  // bracket (knockout) matches can have a null team, and those never
  // belong to a group. This narrows the type to match that reality.
  const matches = rawMatches.filter((m): m is typeof m & { team_a_id: string; team_b_id: string } => m.team_a_id !== null && m.team_b_id !== null);

  if (matches.length === 0) {
    await db.deleteFrom('standings').where('group_id', '=', groupId).execute();
    return;
  }

  const rules = await loadTournamentRules(db, matches[0].tournament_id);

  const inningsByTeam = new Map<string, InningsNrrInput[]>();
  const played = new Map<string, number>();
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  const tied = new Map<string, number>();
  const noResult = new Map<string, number>();
  const drawn = new Map<string, number>();
  const points = new Map<string, number>();
  const headToHeadWins = new Map<string, Set<string>>(); // teamId -> set of teamIds it beat

  for (const id of teamIds) {
    inningsByTeam.set(id, []);
    played.set(id, 0);
    won.set(id, 0);
    lost.set(id, 0);
    tied.set(id, 0);
    noResult.set(id, 0);
    drawn.set(id, 0);
    points.set(id, 0);
    headToHeadWins.set(id, new Set());
  }

  for (const match of matches) {
    const matchIsNoResult = match.result === 'no_result' || match.result === 'abandoned' || !match.result;
    // Net run rate has no meaningful definition for unlimited-overs Test
    // innings (real Test competitions like the WTC rank by points instead) —
    // skip it entirely for test-format tournaments rather than dividing by
    // an overs-allotted figure that doesn't exist.
    if (rules.matchType !== 'test') {
      const oversAllotted = match.overs_override ?? rules.oversPerInnings ?? 0;

      const inningsRows = await db
        .selectFrom('innings')
        .innerJoin('innings_totals', 'innings_totals.innings_id', 'innings.id')
        .select([
          'innings.batting_team_id',
          'innings.bowling_team_id',
          'innings.is_super_over',
          'innings_totals.runs',
          'innings_totals.wickets',
          'innings_totals.legal_balls',
        ])
        .where('innings.match_id', '=', match.id)
        .execute();

      for (const inn of inningsRows) {
        const nrrInput: InningsNrrInput = {
          battingTeamId: inn.batting_team_id,
          bowlingTeamId: inn.bowling_team_id,
          runsScored: inn.runs,
          legalBallsBowled: inn.legal_balls,
          battingTeamAllOut: inn.wickets >= rules.playersPerSide - 1,
          oversAllotted,
          isSuperOver: inn.is_super_over,
          isNoResult: matchIsNoResult,
        };
        inningsByTeam.get(inn.batting_team_id)?.push(nrrInput);
        inningsByTeam.get(inn.bowling_team_id)?.push(nrrInput);
      }
    }

    for (const teamId of [match.team_a_id, match.team_b_id]) {
      if (!teamIds.includes(teamId)) continue;
      const outcome = outcomeForTeam(teamId, match);
      played.set(teamId, (played.get(teamId) ?? 0) + 1);
      if (outcome === 'win') won.set(teamId, (won.get(teamId) ?? 0) + 1);
      if (outcome === 'loss') lost.set(teamId, (lost.get(teamId) ?? 0) + 1);
      if (outcome === 'tie') tied.set(teamId, (tied.get(teamId) ?? 0) + 1);
      if (outcome === 'no_result') noResult.set(teamId, (noResult.get(teamId) ?? 0) + 1);
      if (outcome === 'draw') drawn.set(teamId, (drawn.get(teamId) ?? 0) + 1);
      points.set(teamId, (points.get(teamId) ?? 0) + computeMatchPoints(outcome, rules));
    }

    if (match.result === 'team_a_won' || match.result === 'team_b_won') {
      const winnerId = match.winner_team_id!;
      const loserId = winnerId === match.team_a_id ? match.team_b_id : match.team_a_id;
      headToHeadWins.get(winnerId)?.add(loserId);
    }
  }

  const rows: StandingsRow[] = teamIds.map((teamId) => ({
    teamId,
    teamName: teamNameById.get(teamId) ?? teamId,
    played: played.get(teamId) ?? 0,
    won: won.get(teamId) ?? 0,
    lost: lost.get(teamId) ?? 0,
    tied: tied.get(teamId) ?? 0,
    noResult: noResult.get(teamId) ?? 0,
    drawn: drawn.get(teamId) ?? 0,
    points: points.get(teamId) ?? 0,
    netRunRate: computeNetRunRate(teamId, inningsByTeam.get(teamId) ?? [], rules.ballsPerOver),
  }));

  const ranked = rankStandings(rows, (a, b) => {
    if (headToHeadWins.get(a)?.has(b)) return 1;
    if (headToHeadWins.get(b)?.has(a)) return -1;
    return 0;
  });

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('standings').where('group_id', '=', groupId).execute();
    await trx
      .insertInto('standings')
      .values(
        ranked.map((row, index) => ({
          group_id: groupId,
          team_id: row.teamId,
          played: row.played,
          won: row.won,
          lost: row.lost,
          tied: row.tied,
          no_result: row.noResult,
          drawn: row.drawn,
          points: row.points,
          net_run_rate: row.netRunRate,
          rank: index + 1,
        })),
      )
      .execute();
  });
}

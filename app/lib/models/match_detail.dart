import '../utils/cricket_math.dart';
import 'json_utils.dart';
import 'player.dart';
import 'team.dart';

class InningsTotals {
  const InningsTotals({
    required this.runs,
    required this.wickets,
    required this.legalBalls,
    required this.extras,
  });

  final int runs;
  final int wickets;
  final int legalBalls;
  final int extras;

  factory InningsTotals.fromJson(Map<String, dynamic> json) => InningsTotals(
    runs: json['runs'] as int,
    wickets: json['wickets'] as int,
    legalBalls: json['legal_balls'] as int,
    extras: json['extras'] as int,
  );

  String oversDisplay(int ballsPerOver) =>
      formatOvers(legalBalls, ballsPerOver);
}

class BattingCardRow {
  const BattingCardRow({
    required this.id,
    required this.name,
    required this.runs,
    required this.ballsFaced,
    required this.fours,
    required this.sixes,
    required this.isOut,
    this.dismissalText,
    required this.position,
  });

  final String id;
  final String name;
  final int runs;
  final int ballsFaced;
  final int fours;
  final int sixes;
  final bool isOut;
  final String? dismissalText;
  final int position;

  factory BattingCardRow.fromJson(Map<String, dynamic> json) => BattingCardRow(
    id: json['id'] as String,
    name: json['name'] as String,
    runs: json['runs'] as int,
    ballsFaced: json['balls_faced'] as int,
    fours: json['fours'] as int,
    sixes: json['sixes'] as int,
    isOut: json['is_out'] as bool,
    dismissalText: json['dismissal_text'] as String?,
    position: json['position'] as int,
  );

  double get strikeRate => ballsFaced == 0 ? 0 : (runs / ballsFaced) * 100;
}

class BowlingCardRow {
  const BowlingCardRow({
    required this.id,
    required this.name,
    required this.legalBalls,
    required this.runsConceded,
    required this.wickets,
    required this.maidens,
    required this.wides,
    required this.noballs,
    required this.dots,
  });

  final String id;
  final String name;
  final int legalBalls;
  final int runsConceded;
  final int wickets;
  final int maidens;
  final int wides;
  final int noballs;
  final int dots;

  factory BowlingCardRow.fromJson(Map<String, dynamic> json) => BowlingCardRow(
    id: json['id'] as String,
    name: json['name'] as String,
    legalBalls: json['legal_balls'] as int,
    runsConceded: json['runs_conceded'] as int,
    wickets: json['wickets'] as int,
    maidens: json['maidens'] as int,
    wides: json['wides'] as int,
    noballs: json['noballs'] as int,
    dots: json['dots'] as int,
  );

  String oversDisplay(int ballsPerOver) =>
      formatOvers(legalBalls, ballsPerOver);
  double economy(int ballsPerOver) =>
      runRate(runsConceded, legalBalls, ballsPerOver);
}

class PartnershipPlayerRef {
  const PartnershipPlayerRef({required this.id, required this.name});

  final String id;
  final String name;

  factory PartnershipPlayerRef.fromJson(Map<String, dynamic> json) =>
      PartnershipPlayerRef(
        id: json['id'] as String,
        name: json['name'] as String,
      );
}

class Partnership {
  const Partnership({
    required this.wicketNumber,
    required this.runs,
    required this.balls,
    required this.playerA,
    required this.playerB,
  });

  final int wicketNumber;
  final int runs;
  final int balls;
  final PartnershipPlayerRef playerA;
  final PartnershipPlayerRef playerB;

  factory Partnership.fromJson(Map<String, dynamic> json) => Partnership(
    wicketNumber: json['wicket_number'] as int,
    runs: json['runs'] as int,
    balls: json['balls'] as int,
    playerA: PartnershipPlayerRef.fromJson(
      json['player_a'] as Map<String, dynamic>,
    ),
    playerB: PartnershipPlayerRef.fromJson(
      json['player_b'] as Map<String, dynamic>,
    ),
  );
}

/// A rain/weather stoppage recorded against an innings under CricHive's own
/// resource-based target-revision method ("CricHive Rain Rule") — NOT the
/// licensed DLS. Never label this DLS/D-L in UI copy.
class MatchInterruption {
  const MatchInterruption({
    required this.id,
    required this.oversRemainingBefore,
    required this.oversRemainingAfter,
    required this.wicketsLostAt,
    this.reason,
    required this.createdAt,
  });

  final String id;
  final double oversRemainingBefore;
  final double oversRemainingAfter;
  final int wicketsLostAt;
  final String? reason;
  final DateTime createdAt;

  factory MatchInterruption.fromJson(Map<String, dynamic> json) =>
      MatchInterruption(
        id: json['id'] as String,
        oversRemainingBefore: parseNumeric(json['overs_remaining_before']),
        oversRemainingAfter: parseNumeric(json['overs_remaining_after']),
        wicketsLostAt: json['wickets_lost_at'] as int,
        reason: json['reason'] as String?,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}

class InningsDetail {
  const InningsDetail({
    required this.inningsNumber,
    required this.battingTeamId,
    required this.bowlingTeamId,
    required this.isSuperOver,
    this.target,
    required this.maxOvers,
    required this.declared,
    this.closedAt,
    this.totals,
    required this.batting,
    required this.bowling,
    required this.partnerships,
    required this.interruptions,
  });

  final int inningsNumber;
  final String battingTeamId;
  final String bowlingTeamId;
  final bool isSuperOver;
  final int? target;

  /// Null for a Test innings — no overs cap.
  final double? maxOvers;

  /// Only meaningful for a Test innings: closed before all-out/target reached.
  final bool declared;
  final DateTime? closedAt;
  final InningsTotals? totals;
  final List<BattingCardRow> batting;
  final List<BowlingCardRow> bowling;
  final List<Partnership> partnerships;
  final List<MatchInterruption> interruptions;

  factory InningsDetail.fromJson(Map<String, dynamic> json) => InningsDetail(
    inningsNumber: json['innings_number'] as int,
    battingTeamId: json['batting_team_id'] as String,
    bowlingTeamId: json['bowling_team_id'] as String,
    isSuperOver: json['is_super_over'] as bool,
    target: json['target'] as int?,
    maxOvers: json['max_overs'] == null
        ? null
        : parseNumeric(json['max_overs']),
    declared: json['declared'] as bool? ?? false,
    closedAt: json['closed_at'] == null
        ? null
        : DateTime.parse(json['closed_at'] as String),
    totals: json['totals'] == null
        ? null
        : InningsTotals.fromJson(json['totals'] as Map<String, dynamic>),
    batting: (json['batting'] as List)
        .cast<Map<String, dynamic>>()
        .map(BattingCardRow.fromJson)
        .toList(),
    bowling: (json['bowling'] as List)
        .cast<Map<String, dynamic>>()
        .map(BowlingCardRow.fromJson)
        .toList(),
    partnerships: (json['partnerships'] as List)
        .cast<Map<String, dynamic>>()
        .map(Partnership.fromJson)
        .toList(),
    interruptions: (json['interruptions'] as List? ?? [])
        .cast<Map<String, dynamic>>()
        .map(MatchInterruption.fromJson)
        .toList(),
  );
}

class MatchDetail {
  const MatchDetail({
    required this.id,
    required this.matchNumber,
    required this.tournamentSlug,
    required this.tournamentName,
    this.scheduledStart,
    this.actualStart,
    required this.status,
    required this.matchType,
    required this.currentDay,
    this.daysPerMatch,
    required this.followOnAvailable,
    required this.assignedScorers,
    this.tossDecision,
    this.tossWinnerId,
    this.result,
    this.resultNote,
    this.winMarginRuns,
    this.winMarginWickets,
    this.playerOfMatch,
    required this.teamA,
    required this.teamB,
    this.ground,
    required this.innings,
  });

  final String id;
  final int matchNumber;
  final String tournamentSlug;
  final String tournamentName;
  final DateTime? scheduledStart;
  final DateTime? actualStart;
  final String status;

  /// 'limited_overs' or 'test'.
  final String matchType;
  final int currentDay;
  final int? daysPerMatch;

  /// True only right at the innings 2 -> 3 transition of a Test match, when
  /// the side that bowled second may enforce a follow-on.
  final bool followOnAvailable;
  final List<MatchScorer> assignedScorers;
  final String? tossDecision;
  final String? tossWinnerId;
  final String? result;
  final String? resultNote;
  final int? winMarginRuns;
  final int? winMarginWickets;
  final PartnershipPlayerRef? playerOfMatch;
  final TeamRef teamA;
  final TeamRef teamB;
  final GroundRef? ground;
  final List<InningsDetail> innings;

  factory MatchDetail.fromJson(Map<String, dynamic> json) => MatchDetail(
    id: json['id'] as String,
    matchNumber: json['match_number'] as int,
    tournamentSlug:
        (json['tournament'] as Map<String, dynamic>)['slug'] as String,
    tournamentName:
        (json['tournament'] as Map<String, dynamic>)['name'] as String,
    scheduledStart: json['scheduled_start'] == null
        ? null
        : DateTime.parse(json['scheduled_start'] as String),
    actualStart: json['actual_start'] == null
        ? null
        : DateTime.parse(json['actual_start'] as String),
    status: json['status'] as String,
    matchType: json['match_type'] as String? ?? 'limited_overs',
    currentDay: json['current_day'] as int? ?? 1,
    daysPerMatch: json['days_per_match'] as int?,
    followOnAvailable: json['follow_on_available'] as bool? ?? false,
    assignedScorers: (json['assigned_scorers'] as List? ?? [])
        .cast<Map<String, dynamic>>()
        .map(MatchScorer.fromJson)
        .toList(),
    tossDecision: json['toss_decision'] as String?,
    tossWinnerId: json['toss_winner_id'] as String?,
    result: json['result'] as String?,
    resultNote: json['result_note'] as String?,
    winMarginRuns: json['win_margin_runs'] as int?,
    winMarginWickets: json['win_margin_wickets'] as int?,
    playerOfMatch: json['player_of_match'] == null
        ? null
        : PartnershipPlayerRef.fromJson(
            json['player_of_match'] as Map<String, dynamic>,
          ),
    teamA: TeamRef.fromJson(json['team_a'] as Map<String, dynamic>),
    teamB: TeamRef.fromJson(json['team_b'] as Map<String, dynamic>),
    ground: json['ground'] == null
        ? null
        : GroundRef.fromJson(json['ground'] as Map<String, dynamic>),
    innings: (json['innings'] as List)
        .cast<Map<String, dynamic>>()
        .map(InningsDetail.fromJson)
        .toList(),
  );

  bool get isLive =>
      status == 'live' ||
      status == 'innings_break' ||
      status == 'toss_done' ||
      status == 'super_over' ||
      status == 'day_break';
}

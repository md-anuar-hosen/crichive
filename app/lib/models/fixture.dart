import 'team.dart';

class Fixture {
  const Fixture({
    required this.id,
    required this.matchNumber,
    this.scheduledStart,
    required this.status,
    this.result,
    this.resultNote,
    this.winMarginRuns,
    this.winMarginWickets,
    required this.teamA,
    required this.teamB,
    this.ground,
  });

  final String id;
  final int matchNumber;
  final DateTime? scheduledStart;
  final String status;
  final String? result;
  final String? resultNote;
  final int? winMarginRuns;
  final int? winMarginWickets;
  final TeamRef teamA;
  final TeamRef teamB;
  final GroundRef? ground;

  factory Fixture.fromJson(Map<String, dynamic> json) => Fixture(
        id: json['id'] as String,
        matchNumber: json['match_number'] as int,
        scheduledStart: json['scheduled_start'] == null ? null : DateTime.parse(json['scheduled_start'] as String),
        status: json['status'] as String,
        result: json['result'] as String?,
        resultNote: json['result_note'] as String?,
        winMarginRuns: json['win_margin_runs'] as int?,
        winMarginWickets: json['win_margin_wickets'] as int?,
        teamA: TeamRef.fromJson(json['team_a'] as Map<String, dynamic>),
        teamB: TeamRef.fromJson(json['team_b'] as Map<String, dynamic>),
        ground: json['ground'] == null ? null : GroundRef.fromJson(json['ground'] as Map<String, dynamic>),
      );

  bool get isLive => status == 'live' || status == 'innings_break' || status == 'toss_done';
  bool get isCompleted => status == 'completed' || status == 'abandoned' || status == 'cancelled' || status == 'forfeited';
}

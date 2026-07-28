import 'team.dart';

class StandingRow {
  const StandingRow({
    required this.team,
    required this.played,
    required this.won,
    required this.lost,
    required this.tied,
    required this.noResult,
    required this.points,
    required this.netRunRate,
    this.rank,
  });

  final TeamRef team;
  final int played;
  final int won;
  final int lost;
  final int tied;
  final int noResult;
  final int points;
  final double netRunRate;
  final int? rank;

  factory StandingRow.fromJson(Map<String, dynamic> json) => StandingRow(
        team: TeamRef.fromJson(json['team'] as Map<String, dynamic>),
        played: json['played'] as int,
        won: json['won'] as int,
        lost: json['lost'] as int,
        tied: json['tied'] as int,
        noResult: json['no_result'] as int,
        points: json['points'] as int,
        netRunRate: (json['net_run_rate'] as num).toDouble(),
        rank: json['rank'] as int?,
      );
}

class StandingGroup {
  const StandingGroup({required this.groupId, required this.groupName, required this.standings});

  final String groupId;
  final String groupName;
  final List<StandingRow> standings;

  factory StandingGroup.fromJson(Map<String, dynamic> json) => StandingGroup(
        groupId: json['group_id'] as String,
        groupName: json['group_name'] as String,
        standings: (json['standings'] as List).cast<Map<String, dynamic>>().map(StandingRow.fromJson).toList(),
      );
}

import 'team.dart';

class LiveMatch {
  const LiveMatch({
    required this.id,
    required this.status,
    this.scheduledStart,
    required this.tournamentSlug,
    required this.tournamentName,
    required this.teamA,
    required this.teamB,
  });

  final String id;
  final String status;
  final DateTime? scheduledStart;
  final String tournamentSlug;
  final String tournamentName;
  final TeamRef teamA;
  final TeamRef teamB;

  factory LiveMatch.fromJson(Map<String, dynamic> json) => LiveMatch(
        id: json['id'] as String,
        status: json['status'] as String,
        scheduledStart: json['scheduled_start'] == null ? null : DateTime.parse(json['scheduled_start'] as String),
        tournamentSlug: (json['tournament'] as Map<String, dynamic>)['slug'] as String,
        tournamentName: (json['tournament'] as Map<String, dynamic>)['name'] as String,
        teamA: TeamRef.fromJson(json['team_a'] as Map<String, dynamic>),
        teamB: TeamRef.fromJson(json['team_b'] as Map<String, dynamic>),
      );
}

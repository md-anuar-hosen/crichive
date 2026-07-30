import 'team.dart';

class BracketMatch {
  const BracketMatch({
    required this.id,
    required this.matchNumber,
    required this.status,
    required this.result,
    required this.resultNote,
    required this.winnerTeamId,
    required this.nextMatchId,
    required this.seedA,
    required this.seedB,
    required this.teamA,
    required this.teamB,
  });

  final String id;
  final int? matchNumber;
  final String status;
  final String? result;
  final String? resultNote;
  final String? winnerTeamId;
  final String? nextMatchId;
  final int? seedA;
  final int? seedB;
  final Team? teamA;
  final Team? teamB;

  bool get isDecided => teamA != null && teamB != null;

  factory BracketMatch.fromJson(Map<String, dynamic> json) => BracketMatch(
        id: json['id'] as String,
        matchNumber: json['match_number'] as int?,
        status: json['status'] as String,
        result: json['result'] as String?,
        resultNote: json['result_note'] as String?,
        winnerTeamId: json['winner_team_id'] as String?,
        nextMatchId: json['next_match_id'] as String?,
        seedA: json['seed_a'] as int?,
        seedB: json['seed_b'] as int?,
        teamA: json['team_a'] == null ? null : Team.fromJson(json['team_a'] as Map<String, dynamic>),
        teamB: json['team_b'] == null ? null : Team.fromJson(json['team_b'] as Map<String, dynamic>),
      );
}

class BracketRound {
  const BracketRound({required this.round, required this.name, required this.matches});

  final int round;
  final String name;
  final List<BracketMatch> matches;

  factory BracketRound.fromJson(Map<String, dynamic> json) => BracketRound(
        round: json['round'] as int,
        name: json['name'] as String,
        matches: (json['matches'] as List).cast<Map<String, dynamic>>().map(BracketMatch.fromJson).toList(),
      );
}

class KnockoutBracket {
  const KnockoutBracket({required this.stageId, required this.stageName, required this.rounds});

  final String? stageId;
  final String? stageName;
  final List<BracketRound> rounds;

  bool get exists => stageId != null;

  factory KnockoutBracket.fromJson(Map<String, dynamic> json) => KnockoutBracket(
        stageId: (json['stage'] as Map<String, dynamic>?)?['id'] as String?,
        stageName: (json['stage'] as Map<String, dynamic>?)?['name'] as String?,
        rounds: (json['rounds'] as List).cast<Map<String, dynamic>>().map(BracketRound.fromJson).toList(),
      );
}

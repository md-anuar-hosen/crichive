class AwardPlayerRef {
  const AwardPlayerRef({required this.id, required this.name});

  final String id;
  final String? name;

  factory AwardPlayerRef.fromJson(Map<String, dynamic> json) =>
      AwardPlayerRef(id: json['id'] as String, name: json['name'] as String?);
}

class RunScorerRow {
  const RunScorerRow({required this.id, required this.name, required this.runs, required this.fours, required this.sixes});

  final String id;
  final String? name;
  final int runs;
  final int fours;
  final int sixes;

  factory RunScorerRow.fromJson(Map<String, dynamic> json) => RunScorerRow(
        id: json['id'] as String,
        name: json['name'] as String?,
        runs: json['runs'] as int,
        fours: json['fours'] as int,
        sixes: json['sixes'] as int,
      );
}

class WicketTakerRow {
  const WicketTakerRow({required this.id, required this.name, required this.wickets, required this.maidens});

  final String id;
  final String? name;
  final int wickets;
  final int maidens;

  factory WicketTakerRow.fromJson(Map<String, dynamic> json) => WicketTakerRow(
        id: json['id'] as String,
        name: json['name'] as String?,
        wickets: json['wickets'] as int,
        maidens: json['maidens'] as int,
      );
}

/// CricHive's own performance-score heuristic for Player of the Tournament —
/// not an attempt to replicate a human judge panel's picks.
class TournamentAwards {
  const TournamentAwards({this.playerOfTournament, required this.mostRuns, required this.mostWickets});

  final AwardPlayerRef? playerOfTournament;
  final List<RunScorerRow> mostRuns;
  final List<WicketTakerRow> mostWickets;

  factory TournamentAwards.fromJson(Map<String, dynamic> json) => TournamentAwards(
        playerOfTournament: json['player_of_tournament'] == null
            ? null
            : AwardPlayerRef.fromJson(json['player_of_tournament'] as Map<String, dynamic>),
        mostRuns: (json['most_runs'] as List).cast<Map<String, dynamic>>().map(RunScorerRow.fromJson).toList(),
        mostWickets: (json['most_wickets'] as List).cast<Map<String, dynamic>>().map(WicketTakerRow.fromJson).toList(),
      );
}

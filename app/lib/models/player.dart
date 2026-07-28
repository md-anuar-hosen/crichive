class Player {
  const Player({required this.id, required this.name, this.batting, this.bowling, this.photoUrl});

  final String id;
  final String name;
  final String? batting;
  final String? bowling;
  final String? photoUrl;

  factory Player.fromJson(Map<String, dynamic> json) => Player(
        id: json['id'] as String,
        name: json['name'] as String,
        batting: json['batting'] as String?,
        bowling: json['bowling'] as String?,
        photoUrl: json['photo_url'] as String?,
      );
}

class SquadPlayer extends Player {
  const SquadPlayer({
    required super.id,
    required super.name,
    super.batting,
    super.bowling,
    super.photoUrl,
    this.jerseyNumber,
    required this.isCaptain,
    required this.isKeeper,
  });

  final int? jerseyNumber;
  final bool isCaptain;
  final bool isKeeper;

  factory SquadPlayer.fromJson(Map<String, dynamic> json) => SquadPlayer(
        id: json['id'] as String,
        name: json['name'] as String,
        batting: json['batting'] as String?,
        bowling: json['bowling'] as String?,
        photoUrl: json['photo_url'] as String?,
        jerseyNumber: json['jersey_number'] as int?,
        isCaptain: json['is_captain'] as bool? ?? false,
        isKeeper: json['is_keeper'] as bool? ?? false,
      );
}

class CareerStats {
  const CareerStats({
    required this.matches,
    required this.inningsBatted,
    required this.runs,
    required this.ballsFaced,
    required this.highestScore,
    required this.notOuts,
    required this.fifties,
    required this.hundreds,
    required this.fours,
    required this.sixes,
    required this.inningsBowled,
    required this.legalBallsBowled,
    required this.runsConceded,
    required this.wickets,
    required this.bestBowlingWkts,
    required this.bestBowlingRuns,
    required this.catches,
    required this.stumpings,
    required this.runOuts,
  });

  final int matches;
  final int inningsBatted;
  final int runs;
  final int ballsFaced;
  final int highestScore;
  final int notOuts;
  final int fifties;
  final int hundreds;
  final int fours;
  final int sixes;
  final int inningsBowled;
  final int legalBallsBowled;
  final int runsConceded;
  final int wickets;
  final int? bestBowlingWkts;
  final int? bestBowlingRuns;
  final int catches;
  final int stumpings;
  final int runOuts;

  factory CareerStats.fromJson(Map<String, dynamic> json) => CareerStats(
        matches: json['matches'] as int? ?? 0,
        inningsBatted: json['innings_batted'] as int? ?? 0,
        runs: json['runs'] as int? ?? 0,
        ballsFaced: json['balls_faced'] as int? ?? 0,
        highestScore: json['highest_score'] as int? ?? 0,
        notOuts: json['not_outs'] as int? ?? 0,
        fifties: json['fifties'] as int? ?? 0,
        hundreds: json['hundreds'] as int? ?? 0,
        fours: json['fours'] as int? ?? 0,
        sixes: json['sixes'] as int? ?? 0,
        inningsBowled: json['innings_bowled'] as int? ?? 0,
        legalBallsBowled: json['legal_balls_bowled'] as int? ?? 0,
        runsConceded: json['runs_conceded'] as int? ?? 0,
        wickets: json['wickets'] as int? ?? 0,
        bestBowlingWkts: json['best_bowling_wkts'] as int?,
        bestBowlingRuns: json['best_bowling_runs'] as int?,
        catches: json['catches'] as int? ?? 0,
        stumpings: json['stumpings'] as int? ?? 0,
        runOuts: json['run_outs'] as int? ?? 0,
      );

  double get battingAverage {
    final dismissals = inningsBatted - notOuts;
    if (dismissals <= 0) return runs.toDouble();
    return runs / dismissals;
  }

  double get strikeRate => ballsFaced == 0 ? 0 : (runs / ballsFaced) * 100;

  double get economy => legalBallsBowled == 0 ? 0 : runsConceded / (legalBallsBowled / 6);
}

class PlayerDetail extends Player {
  const PlayerDetail({
    required super.id,
    required super.name,
    super.batting,
    super.bowling,
    super.photoUrl,
    this.careerStats,
  });

  final CareerStats? careerStats;

  factory PlayerDetail.fromJson(Map<String, dynamic> json) => PlayerDetail(
        id: json['id'] as String,
        name: json['name'] as String,
        batting: json['batting'] as String?,
        bowling: json['bowling'] as String?,
        photoUrl: json['photo_url'] as String?,
        careerStats: json['career_stats'] == null ? null : CareerStats.fromJson(json['career_stats'] as Map<String, dynamic>),
      );
}

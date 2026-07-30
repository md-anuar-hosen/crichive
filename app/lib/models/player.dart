class Player {
  const Player({
    required this.id,
    required this.name,
    this.batting,
    this.bowling,
    this.photoUrl,
  });

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
    this.isApproved = true,
    this.licenceVerified = false,
  });

  final int? jerseyNumber;
  final bool isCaptain;
  final bool isKeeper;

  /// Whether the organiser has confirmed this squad placement. A team
  /// manager's own addition/edit starts unapproved; an organiser's own
  /// addition is approved immediately. Defaults true so older API
  /// responses without this field (there are none left, but just in
  /// case) don't spuriously look pending.
  final bool isApproved;
  final bool licenceVerified;

  factory SquadPlayer.fromJson(Map<String, dynamic> json) => SquadPlayer(
    id: json['id'] as String,
    name: json['name'] as String,
    batting: json['batting'] as String?,
    bowling: json['bowling'] as String?,
    photoUrl: json['photo_url'] as String?,
    jerseyNumber: json['jersey_number'] as int?,
    isCaptain: json['is_captain'] as bool? ?? false,
    isKeeper: json['is_keeper'] as bool? ?? false,
    isApproved: json['is_approved'] as bool? ?? true,
    licenceVerified: json['licence_verified'] as bool? ?? false,
  );
}

class TeamManager {
  const TeamManager({
    required this.membershipId,
    required this.userId,
    required this.displayName,
    required this.email,
  });

  final String membershipId;
  final String userId;
  final String displayName;
  final String? email;

  factory TeamManager.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    return TeamManager(
      membershipId: json['id'] as String,
      userId: user['id'] as String,
      displayName: user['display_name'] as String,
      email: user['email'] as String?,
    );
  }
}

/// A tournament scorer assigned to one specific match — see [MatchDetail]'s
/// assignedScorers and the tournament-wide scorer roster (reuses
/// [TeamManager] for that list, same {id, user:{...}} response shape).
class MatchScorer {
  const MatchScorer({required this.userId, required this.displayName});

  final String userId;
  final String displayName;

  factory MatchScorer.fromJson(Map<String, dynamic> json) => MatchScorer(
    userId: json['id'] as String,
    displayName: json['display_name'] as String,
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

  double get economy =>
      legalBallsBowled == 0 ? 0 : runsConceded / (legalBallsBowled / 6);
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
    careerStats: json['career_stats'] == null
        ? null
        : CareerStats.fromJson(json['career_stats'] as Map<String, dynamic>),
  );
}

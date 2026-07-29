class TournamentRules {
  const TournamentRules({
    required this.oversPerInnings,
    required this.ballsPerOver,
    required this.maxOversPerBowler,
    required this.powerplayOvers,
    required this.playersPerSide,
    required this.wideRuns,
    required this.noballRuns,
    required this.freeHitAfterNoball,
    required this.pointsWin,
    required this.pointsTie,
    required this.pointsNoResult,
    required this.pointsLoss,
    required this.bonusPointEnabled,
    required this.superOverOnTie,
    required this.dlsEnabled,
  });

  final int oversPerInnings;
  final int ballsPerOver;
  final int maxOversPerBowler;
  final int powerplayOvers;
  final int playersPerSide;
  final int wideRuns;
  final int noballRuns;
  final bool freeHitAfterNoball;
  final int pointsWin;
  final int pointsTie;
  final int pointsNoResult;
  final int pointsLoss;
  final bool bonusPointEnabled;
  final bool superOverOnTie;
  final bool dlsEnabled;

  factory TournamentRules.fromJson(Map<String, dynamic> json) => TournamentRules(
        oversPerInnings: json['overs_per_innings'] as int,
        ballsPerOver: json['balls_per_over'] as int,
        maxOversPerBowler: json['max_overs_per_bowler'] as int,
        powerplayOvers: json['powerplay_overs'] as int,
        playersPerSide: json['players_per_side'] as int,
        wideRuns: json['wide_runs'] as int,
        noballRuns: json['noball_runs'] as int,
        freeHitAfterNoball: json['free_hit_after_noball'] as bool,
        pointsWin: json['points_win'] as int,
        pointsTie: json['points_tie'] as int,
        pointsNoResult: json['points_no_result'] as int,
        pointsLoss: json['points_loss'] as int,
        bonusPointEnabled: json['bonus_point_enabled'] as bool,
        superOverOnTie: json['super_over_on_tie'] as bool,
        dlsEnabled: json['dls_enabled'] as bool,
      );
}

class Tournament {
  const Tournament({
    required this.id,
    required this.name,
    required this.seasonYear,
    required this.slug,
    this.organizerOrg,
    required this.countryCode,
    required this.ball,
    this.startsOn,
    this.endsOn,
    this.logoUrl,
    this.rules,
  });

  final String id;
  final String name;
  final int seasonYear;
  final String slug;
  final String? organizerOrg;
  final String countryCode;
  final String ball;
  final DateTime? startsOn;
  final DateTime? endsOn;
  final String? logoUrl;
  final TournamentRules? rules;

  factory Tournament.fromJson(Map<String, dynamic> json) => Tournament(
        id: json['id'] as String,
        name: json['name'] as String,
        seasonYear: json['season_year'] as int,
        slug: json['slug'] as String,
        organizerOrg: json['organizer_org'] as String?,
        countryCode: json['country_code'] as String,
        ball: json['ball'] as String,
        startsOn: json['starts_on'] == null ? null : DateTime.parse(json['starts_on'] as String),
        endsOn: json['ends_on'] == null ? null : DateTime.parse(json['ends_on'] as String),
        logoUrl: json['logo_url'] as String?,
        rules: json['rules'] == null ? null : TournamentRules.fromJson(json['rules'] as Map<String, dynamic>),
      );
}

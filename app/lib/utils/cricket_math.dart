/// Pure arithmetic over already-server-computed totals (run rate, overs
/// formatting). This is NOT scoring domain logic — it never decides what a
/// delivery counts as; it only summarizes numbers the backend already
/// returned. `ballsPerOver` always comes from `tournament_rules` and must
/// never be hardcoded to 6 (CLAUDE.md).
library;

String formatOvers(int legalBalls, int ballsPerOver) {
  final overs = legalBalls ~/ ballsPerOver;
  final balls = legalBalls % ballsPerOver;
  return '$overs.$balls';
}

/// Converts a real-number-of-overs value (e.g. `innings.maxOvers`, where 3.5
/// literally means three and a half overs — not "3 overs, 5 balls") into
/// cricket over notation ("3.3") for display. Never render such a value with
/// `toStringAsFixed` directly: it looks like cricket notation but isn't.
String formatDecimalOvers(double oversDecimal, int ballsPerOver) {
  final totalBalls = (oversDecimal * ballsPerOver).round();
  return formatOvers(totalBalls, ballsPerOver);
}

/// Inverse of [formatDecimalOvers]: parses a cricket-notation string like
/// "3.2" (3 overs, 2 balls) typed by a scorer into the real-number-of-overs
/// value the backend's rain-interruption API expects. Returns null if the
/// balls component isn't a valid ball count for [ballsPerOver].
double? parseCricketOversToDecimal(String input, int ballsPerOver) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return null;
  final parts = trimmed.split('.');
  final overs = int.tryParse(parts[0]);
  if (overs == null || overs < 0) return null;
  final balls = parts.length > 1 ? int.tryParse(parts[1]) : 0;
  if (balls == null || balls < 0 || balls >= ballsPerOver) return null;
  return (overs * ballsPerOver + balls) / ballsPerOver;
}

double oversAsDouble(int legalBalls, int ballsPerOver) => ballsPerOver == 0 ? 0 : legalBalls / ballsPerOver;

/// Runs per full over, extrapolated from balls bowled so far.
double runRate(int runs, int legalBalls, int ballsPerOver) {
  final overs = oversAsDouble(legalBalls, ballsPerOver);
  return overs == 0 ? 0 : runs / overs;
}

/// Runs per full over still required to reach [target], or null if there
/// are no legal balls left in the innings to bowl.
double? requiredRunRate({
  required int target,
  required int runsSoFar,
  required int legalBallsBowled,
  required double maxOvers,
  required int ballsPerOver,
}) {
  final maxBalls = (maxOvers * ballsPerOver).round();
  final ballsRemaining = maxBalls - legalBallsBowled;
  if (ballsRemaining <= 0) return null;
  final runsNeeded = target - runsSoFar;
  final oversRemaining = ballsRemaining / ballsPerOver;
  return runsNeeded / oversRemaining;
}

int ballsRemaining({required double maxOvers, required int ballsPerOver, required int legalBallsBowled}) {
  final maxBalls = (maxOvers * ballsPerOver).round();
  final remaining = maxBalls - legalBallsBowled;
  return remaining < 0 ? 0 : remaining;
}

/// Full-innings score projection at the current run rate.
int projectedScore({
  required int runsSoFar,
  required int legalBallsBowled,
  required double maxOvers,
  required int ballsPerOver,
}) {
  final rate = runRate(runsSoFar, legalBallsBowled, ballsPerOver);
  return (rate * maxOvers).round();
}

/// CricHive's own simplified win-probability estimate for the chasing side
/// during an active run chase. This is NOT a statistical model trained on
/// match data (unlike Cricbuzz's) — it's a transparent heuristic: how much
/// harder the required rate is than the pace already set, discounted by how
/// many wickets are still in hand. Returns the chasing team's estimated win
/// probability as a percentage in [1, 99] (never fully certain either way
/// while the chase is still live).
double chasingTeamWinProbability({
  required double requiredRunRate,
  required double currentRunRate,
  required int wicketsInHand,
  required int wicketsAvailable,
}) {
  if (wicketsAvailable <= 0) return 50;
  final wicketsFactor = (wicketsInHand / wicketsAvailable).clamp(0.0, 1.0);
  // A currentRunRate of 0 (no balls faced yet) would make the ratio blow up;
  // floor it at a token rate so an unstarted chase reads as roughly neutral.
  final safeCurrentRate = currentRunRate <= 0 ? 0.5 : currentRunRate;
  final rateRatio = requiredRunRate <= 0 ? 0 : requiredRunRate / safeCurrentRate;
  final pressure = rateRatio / (0.3 + wicketsFactor);
  final probability = 100 / (1 + pressure * pressure);
  return probability.clamp(1.0, 99.0);
}

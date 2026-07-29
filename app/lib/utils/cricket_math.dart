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

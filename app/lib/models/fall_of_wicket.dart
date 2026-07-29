import 'match_detail.dart';
import '../utils/cricket_math.dart';

class FallOfWicket {
  const FallOfWicket({required this.wicketNumber, required this.score, required this.oversDisplay, this.batterName});

  final int wicketNumber;
  final int score;
  final String oversDisplay;
  final String? batterName;
}

/// Derives "score/wicket (batter, overs)" entries from partnerships, which
/// are the only source that unambiguously ties a cumulative score to a
/// wicket number. The dismissed batter for partnership *i* is whichever of
/// its two players does NOT carry over into partnership *i+1* (the
/// survivor continues; the new batter fills the gap). The LAST partnership
/// in the list is only a fallen wicket if it actually ended in a dismissal
/// (one of its two batters is marked out) — otherwise it's just the
/// still-batting pair and must be excluded, not reported as a wicket that
/// hasn't fallen yet (e.g. an innings closed early with both openers not
/// out has exactly one partnership and zero fallen wickets).
List<FallOfWicket> computeFallOfWickets(InningsDetail innings, int ballsPerOver) {
  final partnerships = innings.partnerships;
  if (partnerships.isEmpty) return const [];

  final isOutById = {for (final b in innings.batting) b.id: b.isOut};

  var cumulativeRuns = 0;
  var cumulativeBalls = 0;
  final result = <FallOfWicket>[];

  for (var i = 0; i < partnerships.length; i++) {
    final p = partnerships[i];
    cumulativeRuns += p.runs;
    cumulativeBalls += p.balls;

    String? batterName;
    if (i + 1 < partnerships.length) {
      final next = partnerships[i + 1];
      final nextIds = {next.playerA.id, next.playerB.id};
      if (!nextIds.contains(p.playerA.id)) {
        batterName = p.playerA.name;
      } else if (!nextIds.contains(p.playerB.id)) {
        batterName = p.playerB.name;
      }
    } else {
      final aOut = isOutById[p.playerA.id] ?? false;
      final bOut = isOutById[p.playerB.id] ?? false;
      if (!aOut && !bOut) {
        // Still an unbroken partnership — nothing fell here, stop.
        break;
      }
      if (aOut && !bOut) {
        batterName = p.playerA.name;
      } else if (bOut && !aOut) {
        batterName = p.playerB.name;
      }
    }

    result.add(FallOfWicket(
      wicketNumber: p.wicketNumber,
      score: cumulativeRuns,
      oversDisplay: formatOvers(cumulativeBalls, ballsPerOver),
      batterName: batterName,
    ));
  }

  return result;
}

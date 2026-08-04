/// Client-side mirror of backend/src/domain/scoring/strikeRotation.ts, used
/// only to pre-fill the scoring screen's next striker/non-striker/bowler so
/// the scorer isn't forced to reselect them on every ball. The server is the
/// sole authority on scoring — every delivery still carries whatever
/// striker/non-striker/bowler is currently selected in the UI (correctable
/// via "Scoring shortcuts"), so a bug here can only produce an inconvenient
/// default, never a wrong persisted delivery.
library;

import '../models/delivery.dart';

int _runsRun(Delivery d, {required int wideRuns}) {
  if (d.extraByes > 0 || d.extraLegbyes > 0) return d.extraByes + d.extraLegbyes;
  if (d.extraWides > 0) {
    final extra = d.extraWides - wideRuns;
    return extra < 0 ? 0 : extra;
  }
  return d.runsOffBat;
}

/// True when [delivery] was the last (legal) ball of its over.
bool isEndOfOver(Delivery delivery, {required int ballsPerOver}) =>
    delivery.isLegalDelivery && delivery.ballInOver == ballsPerOver;

class CreasePair {
  const CreasePair(this.strikerId, this.nonStrikerId);

  final String strikerId;
  final String nonStrikerId;
}

/// Who should face the next delivery, given the one that was just bowled.
/// [incomingBatterId] is only consulted when [delivery] was a wicket that
/// needs a replacement — pass null when the innings ended on that wicket.
CreasePair computeNextStrikers(
  Delivery delivery, {
  required int wideRuns,
  required int ballsPerOver,
  String? incomingBatterId,
}) {
  var strikerId = delivery.strikerId;
  var nonStrikerId = delivery.nonStrikerId;

  if (delivery.wicketKind != null && delivery.playerOutId != null && incomingBatterId != null) {
    if (delivery.wicketKind == 'run_out') {
      final survivorId =
          delivery.playerOutId == delivery.strikerId ? delivery.nonStrikerId : delivery.strikerId;
      final survivorStartedAsStriker = survivorId == delivery.strikerId;
      final crossed = _runsRun(delivery, wideRuns: wideRuns).isOdd;
      final survivorEndsAsStriker = crossed ? !survivorStartedAsStriker : survivorStartedAsStriker;
      strikerId = survivorEndsAsStriker ? survivorId : incomingBatterId;
      nonStrikerId = survivorEndsAsStriker ? incomingBatterId : survivorId;
    } else {
      final strikerWasOut = delivery.playerOutId == delivery.strikerId;
      strikerId = strikerWasOut ? incomingBatterId : delivery.strikerId;
      nonStrikerId = strikerWasOut ? delivery.nonStrikerId : incomingBatterId;
    }
  } else if (delivery.wicketKind == null && _runsRun(delivery, wideRuns: wideRuns).isOdd) {
    final tmp = strikerId;
    strikerId = nonStrikerId;
    nonStrikerId = tmp;
  }

  if (isEndOfOver(delivery, ballsPerOver: ballsPerOver)) {
    final tmp = strikerId;
    strikerId = nonStrikerId;
    nonStrikerId = tmp;
  }

  return CreasePair(strikerId, nonStrikerId);
}

/// Mirrors isNextDeliveryFreeHit: true immediately after a no-ball, and it
/// persists through any illegal (e.g. wide) delivery bowled while still on
/// a free hit.
bool isNextDeliveryFreeHit(Delivery previous, {required bool freeHitAfterNoball}) {
  if (!freeHitAfterNoball) return false;
  if (previous.extraNoballs > 0) return true;
  return previous.isFreeHit && !previous.isLegalDelivery;
}

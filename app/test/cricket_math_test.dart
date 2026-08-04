import 'package:flutter_test/flutter_test.dart';

import 'package:crichive_app/utils/cricket_math.dart';

void main() {
  group('formatDecimalOvers', () {
    test('converts a real-number-of-overs value into cricket over notation', () {
      // 3.5 overs = 3 overs + 0.5*6 = 3 overs 3 balls, not "3 overs 5 balls".
      expect(formatDecimalOvers(3.5, 6), '3.3');
      expect(formatDecimalOvers(5.0, 6), '5.0');
      expect(formatDecimalOvers(0.5, 6), '0.3');
    });

    test('rounds to the nearest ball rather than truncating', () {
      // 0.3 legal balls out of 6 lands exactly on a ball boundary already,
      // but the underlying multiply-then-round must not drift from it.
      expect(formatDecimalOvers(0.5, 6), '0.3');
    });
  });

  group('parseCricketOversToDecimal', () {
    test('parses cricket-notation input (overs.balls) into a real-number-of-overs value', () {
      // 3 overs 2 balls -> 3 + 2/6 overs, the inverse of formatDecimalOvers.
      expect(parseCricketOversToDecimal('3.2', 6), closeTo(3 + 2 / 6, 1e-9));
      expect(parseCricketOversToDecimal('5', 6), 5.0);
      expect(parseCricketOversToDecimal('0.3', 6), 0.5);
    });

    test('rejects a ball count that is not valid for ballsPerOver', () {
      expect(parseCricketOversToDecimal('3.6', 6), isNull);
      expect(parseCricketOversToDecimal('3.-1', 6), isNull);
    });

    test('rejects unparseable or empty input', () {
      expect(parseCricketOversToDecimal('', 6), isNull);
      expect(parseCricketOversToDecimal('abc', 6), isNull);
    });
  });

  group('chasingTeamWinProbability', () {
    test('is roughly neutral when the required rate matches the current rate with half the wickets in hand', () {
      final p = chasingTeamWinProbability(requiredRunRate: 8, currentRunRate: 8, wicketsInHand: 5, wicketsAvailable: 10);
      expect(p, closeTo(50, 15));
    });

    test('favours the chasing side when the required rate is easier than the pace already set', () {
      final easy = chasingTeamWinProbability(requiredRunRate: 4, currentRunRate: 8, wicketsInHand: 8, wicketsAvailable: 10);
      final hard = chasingTeamWinProbability(requiredRunRate: 12, currentRunRate: 8, wicketsInHand: 8, wicketsAvailable: 10);
      expect(easy, greaterThan(hard));
    });

    test('favours the chasing side with more wickets in hand, rate gap held constant', () {
      final manyWickets = chasingTeamWinProbability(requiredRunRate: 10, currentRunRate: 7, wicketsInHand: 9, wicketsAvailable: 10);
      final fewWickets = chasingTeamWinProbability(requiredRunRate: 10, currentRunRate: 7, wicketsInHand: 1, wicketsAvailable: 10);
      expect(manyWickets, greaterThan(fewWickets));
    });

    test('reads as near-certain once the target is already met (required rate <= 0)', () {
      final p = chasingTeamWinProbability(requiredRunRate: 0, currentRunRate: 6, wicketsInHand: 3, wicketsAvailable: 10);
      expect(p, greaterThan(90));
    });

    test('never returns a fully certain 0 or 100', () {
      final certain = chasingTeamWinProbability(requiredRunRate: 0, currentRunRate: 10, wicketsInHand: 9, wicketsAvailable: 10);
      final hopeless = chasingTeamWinProbability(requiredRunRate: 30, currentRunRate: 4, wicketsInHand: 0, wicketsAvailable: 10);
      expect(certain, lessThanOrEqualTo(99));
      expect(hopeless, greaterThanOrEqualTo(1));
    });

    test('does not throw when no balls have been faced yet (currentRunRate 0)', () {
      final p = chasingTeamWinProbability(requiredRunRate: 8, currentRunRate: 0, wicketsInHand: 10, wicketsAvailable: 10);
      expect(p, greaterThanOrEqualTo(1));
      expect(p, lessThanOrEqualTo(99));
    });

    test('is 50 when there are no wickets available at all (guards divide-by-zero)', () {
      final p = chasingTeamWinProbability(requiredRunRate: 8, currentRunRate: 8, wicketsInHand: 0, wicketsAvailable: 0);
      expect(p, 50);
    });
  });
}

import 'package:flutter_test/flutter_test.dart';

import 'package:crichive_app/utils/cricket_math.dart';

void main() {
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

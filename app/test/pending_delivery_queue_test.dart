import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:crichive_app/models/pending_delivery.dart';
import 'package:crichive_app/services/pending_delivery_queue.dart';

PendingDelivery _delivery(String matchId, String clientEventId) => PendingDelivery(
      matchId: matchId,
      clientEventId: clientEventId,
      inningsNumber: 1,
      strikerId: 'striker',
      nonStrikerId: 'non-striker',
      bowlerId: 'bowler',
      runsOffBat: 1,
      extraWides: 0,
      extraNoballs: 0,
      extraByes: 0,
      extraLegbyes: 0,
      extraPenalty: 0,
      queuedAt: DateTime(2026, 1, 1),
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('a fresh match has nothing queued', () async {
    final queue = PendingDeliveryQueue();
    expect(await queue.all('match-1'), isEmpty);
  });

  test('enqueue preserves scoring order', () async {
    final queue = PendingDeliveryQueue();
    await queue.enqueue(_delivery('match-1', 'ball-1'));
    await queue.enqueue(_delivery('match-1', 'ball-2'));
    await queue.enqueue(_delivery('match-1', 'ball-3'));

    final all = await queue.all('match-1');
    expect(all.map((d) => d.clientEventId), ['ball-1', 'ball-2', 'ball-3']);
  });

  test('removeFirst pops from the front, not the back', () async {
    final queue = PendingDeliveryQueue();
    await queue.enqueue(_delivery('match-1', 'ball-1'));
    await queue.enqueue(_delivery('match-1', 'ball-2'));

    await queue.removeFirst('match-1');

    final remaining = await queue.all('match-1');
    expect(remaining.map((d) => d.clientEventId), ['ball-2']);
  });

  test('removeFirst on the last item clears the backlog entirely', () async {
    final queue = PendingDeliveryQueue();
    await queue.enqueue(_delivery('match-1', 'ball-1'));
    await queue.removeFirst('match-1');

    expect(await queue.all('match-1'), isEmpty);
  });

  test('removeFirst on an empty queue is a no-op, not an error', () async {
    final queue = PendingDeliveryQueue();
    await queue.removeFirst('match-1'); // should not throw
    expect(await queue.all('match-1'), isEmpty);
  });

  test('queues for different matches never mix', () async {
    final queue = PendingDeliveryQueue();
    await queue.enqueue(_delivery('match-1', 'a'));
    await queue.enqueue(_delivery('match-2', 'b'));

    expect((await queue.all('match-1')).map((d) => d.clientEventId), ['a']);
    expect((await queue.all('match-2')).map((d) => d.clientEventId), ['b']);
  });

  test('round-trips every field through JSON, including nullable wicket fields', () async {
    final queue = PendingDeliveryQueue();
    final withWicket = PendingDelivery(
      matchId: 'match-1',
      clientEventId: 'wicket-ball',
      inningsNumber: 2,
      strikerId: 'striker',
      nonStrikerId: 'non-striker',
      bowlerId: 'bowler',
      runsOffBat: 0,
      extraWides: 1,
      extraNoballs: 0,
      extraByes: 2,
      extraLegbyes: 0,
      extraPenalty: 5,
      wicketKind: 'caught',
      playerOutId: 'striker',
      fielderId: 'fielder-1',
      queuedAt: DateTime(2026, 3, 4, 12, 30),
    );
    await queue.enqueue(withWicket);

    final round = (await queue.all('match-1')).single;
    expect(round.inningsNumber, 2);
    expect(round.extraWides, 1);
    expect(round.extraByes, 2);
    expect(round.extraPenalty, 5);
    expect(round.wicketKind, 'caught');
    expect(round.playerOutId, 'striker');
    expect(round.fielderId, 'fielder-1');
    expect(round.queuedAt, DateTime(2026, 3, 4, 12, 30));
  });
}

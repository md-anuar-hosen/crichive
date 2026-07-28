import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:crichive_app/main.dart';
import 'package:crichive_app/models/live_match.dart';
import 'package:crichive_app/models/pagination.dart';
import 'package:crichive_app/models/tournament.dart';
import 'package:crichive_app/state/providers.dart';

void main() {
  testWidgets('App boots to the Tournaments tab without hitting the network', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tournamentsProvider.overrideWith(
            (ref) async => Paginated<Tournament>(
              data: const [],
              pageInfo: const PageInfo(page: 1, limit: 20, total: 0, totalPages: 1),
            ),
          ),
          liveMatchesProvider.overrideWith((ref) async => const <LiveMatch>[]),
        ],
        child: const CricHiveApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Tournaments'), findsWidgets);
    expect(find.text('No tournaments yet.'), findsOneWidget);
  });
}

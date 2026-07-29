import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/delivery.dart';
import '../models/match_detail.dart';
import '../state/providers.dart';
import '../utils/commentary.dart';
import '../widgets/async_value_view.dart';
import '../widgets/manhattan_chart.dart';
import '../widgets/wagon_wheel.dart';
import '../widgets/worm_chart.dart';

class MatchChartsScreen extends ConsumerWidget {
  const MatchChartsScreen({super.key, required this.matchId});

  final String matchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final match = ref.watch(matchProvider(matchId));

    return Scaffold(
      appBar: AppBar(title: const Text('Match center')),
      body: AsyncValueView(
        value: match,
        onRetry: () => ref.invalidate(matchProvider(matchId)),
        data: (context, m) => _ChartsBody(match: m),
      ),
    );
  }
}

class _ChartsBody extends ConsumerWidget {
  const _ChartsBody({required this.match});
  final MatchDetail match;

  String _teamLabel(String teamId) {
    if (teamId == match.teamA.id) return match.teamA.label;
    if (teamId == match.teamB.id) return match.teamB.label;
    return 'Team';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (match.innings.isEmpty) {
      return const EmptyState(message: 'No deliveries bowled yet.', icon: Icons.bar_chart_outlined);
    }

    final deliveriesAsync = [
      for (final innings in match.innings)
        ref.watch(deliveriesProvider((matchId: match.id, inningsNumber: innings.inningsNumber))),
    ];

    // Wait for every innings' deliveries before rendering the worm chart
    // (it needs all series at once); individual innings cards below render
    // independently once their own data is ready.
    final allLoaded = deliveriesAsync.every((a) => a.hasValue);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (allLoaded && match.innings.length > 1) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Worm', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  WormChart(
                    series: [
                      for (var i = 0; i < match.innings.length; i++)
                        WormSeries(
                          label: _teamLabel(match.innings[i].battingTeamId),
                          overs: aggregateByOver(deliveriesAsync[i].value!),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        for (var i = 0; i < match.innings.length; i++)
          _InningsChartsCard(
            innings: match.innings[i],
            teamLabel: _teamLabel(match.innings[i].battingTeamId),
            deliveries: deliveriesAsync[i],
            seriesSlot: i,
          ),
      ],
    );
  }
}

class _InningsChartsCard extends StatelessWidget {
  const _InningsChartsCard({required this.innings, required this.teamLabel, required this.deliveries, required this.seriesSlot});

  final InningsDetail innings;
  final String teamLabel;
  final AsyncValue<List<Delivery>> deliveries;
  final int seriesSlot;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$teamLabel — innings ${innings.inningsNumber}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            AsyncValueView(
              value: deliveries,
              data: (context, balls) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Manhattan', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: 4),
                  ManhattanChart(overs: aggregateByOver(balls), seriesSlot: seriesSlot),
                  const SizedBox(height: 16),
                  Text('Wagon wheel', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: 4),
                  SizedBox(width: 240, child: WagonWheel(deliveries: balls)),
                  const SizedBox(height: 16),
                  Text('Commentary', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: 4),
                  ...balls.reversed.take(20).map(
                        (d) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SizedBox(
                                width: 36,
                                child: Text(overBallLabel(d), style: Theme.of(context).textTheme.bodySmall),
                              ),
                              Expanded(child: Text(describeDelivery(d), style: Theme.of(context).textTheme.bodySmall)),
                            ],
                          ),
                        ),
                      ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

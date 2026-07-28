import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/providers.dart';
import '../widgets/async_value_view.dart';

class PlayerProfileScreen extends ConsumerWidget {
  const PlayerProfileScreen({super.key, required this.playerId});

  final String playerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final player = ref.watch(playerProvider(playerId));

    return Scaffold(
      appBar: AppBar(title: const Text('Player')),
      body: AsyncValueView(
        value: player,
        onRetry: () => ref.invalidate(playerProvider(playerId)),
        data: (context, p) {
          final stats = p.careerStats;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  CircleAvatar(radius: 28, child: Text(p.name.isNotEmpty ? p.name[0] : '?')),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.name, style: Theme.of(context).textTheme.titleLarge),
                        Text([p.batting, p.bowling].whereType<String>().join(' · ')),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              if (stats == null)
                const Padding(padding: EdgeInsets.only(top: 24), child: EmptyState(message: 'No career stats yet.'))
              else ...[
                Text('Batting', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                _StatGrid(stats: [
                  _Stat('Innings', '${stats.inningsBatted}'),
                  _Stat('Runs', '${stats.runs}'),
                  _Stat('Average', stats.battingAverage.toStringAsFixed(2)),
                  _Stat('Strike rate', stats.strikeRate.toStringAsFixed(1)),
                  _Stat('High score', '${stats.highestScore}'),
                  _Stat('50s / 100s', '${stats.fifties} / ${stats.hundreds}'),
                  _Stat('4s / 6s', '${stats.fours} / ${stats.sixes}'),
                ]),
                const SizedBox(height: 24),
                Text('Bowling', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                _StatGrid(stats: [
                  _Stat('Innings', '${stats.inningsBowled}'),
                  _Stat('Wickets', '${stats.wickets}'),
                  _Stat('Economy', stats.economy.toStringAsFixed(2)),
                  _Stat(
                    'Best',
                    stats.bestBowlingWkts == null ? '-' : '${stats.bestBowlingWkts}/${stats.bestBowlingRuns}',
                  ),
                ]),
                const SizedBox(height: 24),
                Text('Fielding', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                _StatGrid(stats: [
                  _Stat('Catches', '${stats.catches}'),
                  _Stat('Stumpings', '${stats.stumpings}'),
                  _Stat('Run outs', '${stats.runOuts}'),
                ]),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Stat {
  const _Stat(this.label, this.value);
  final String label;
  final String value;
}

class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.stats});
  final List<_Stat> stats;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 24,
      runSpacing: 12,
      children: stats
          .map(
            (s) => SizedBox(
              width: 120,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.value, style: Theme.of(context).textTheme.titleMedium),
                  Text(s.label, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

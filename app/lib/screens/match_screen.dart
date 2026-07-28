import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/match_detail.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

class MatchScreen extends ConsumerWidget {
  const MatchScreen({super.key, required this.matchId});

  final String matchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final match = ref.watch(matchProvider(matchId));

    return Scaffold(
      appBar: AppBar(title: const Text('Match')),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(matchProvider(matchId).future);
        },
        child: AsyncValueView(
          value: match,
          onRetry: () => ref.invalidate(matchProvider(matchId)),
          data: (context, m) => _MatchBody(match: m),
        ),
      ),
    );
  }
}

class _MatchBody extends StatelessWidget {
  const _MatchBody({required this.match});
  final MatchDetail match;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Text('${match.teamA.name} vs ${match.teamB.name}', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(_headerSubtitle(), style: Theme.of(context).textTheme.bodyMedium),
        if (match.resultNote != null) ...[
          const SizedBox(height: 8),
          Text(
            match.resultNote!,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.primary),
          ),
        ],
        const SizedBox(height: 16),
        if (match.innings.isEmpty) const EmptyState(message: 'Play has not started yet.'),
        for (final innings in match.innings) _InningsCard(match: match, innings: innings),
      ],
    );
  }

  String _headerSubtitle() {
    if (match.ground == null) return match.status;
    return '${match.ground!.name}${match.ground!.city != null ? ', ${match.ground!.city}' : ''}';
  }
}

class _InningsCard extends StatelessWidget {
  const _InningsCard({required this.match, required this.innings});
  final MatchDetail match;
  final InningsDetail innings;

  String _teamName(String teamId) {
    if (teamId == match.teamA.id) return match.teamA.label;
    if (teamId == match.teamB.id) return match.teamB.label;
    return 'Team';
  }

  @override
  Widget build(BuildContext context) {
    final totals = innings.totals;
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _teamName(innings.battingTeamId),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (totals != null)
                  Text(
                    '${totals.runs}/${totals.wickets} (${totals.oversDisplay})',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
              ],
            ),
            if (innings.target != null) Text('Target: ${innings.target}', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 12),
            if (innings.batting.isNotEmpty) ...[
              Text('Batting', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              ...innings.batting.map(
                (b) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Expanded(
                        flex: 3,
                        child: Text(
                          b.name,
                          style: b.isOut ? null : const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ),
                      Expanded(
                        flex: 4,
                        child: Text(
                          b.isOut ? (b.dismissalText ?? 'out') : 'not out',
                          style: Theme.of(context).textTheme.bodySmall,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Expanded(
                        flex: 2,
                        child: Text('${b.runs} (${b.ballsFaced})', textAlign: TextAlign.end),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (innings.bowling.isNotEmpty) ...[
              Text('Bowling', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              ...innings.bowling.map(
                (b) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Expanded(flex: 3, child: Text(b.name)),
                      Expanded(
                        flex: 5,
                        child: Text(
                          '${b.oversDisplay}-${b.maidens}-${b.runsConceded}-${b.wickets}',
                          textAlign: TextAlign.end,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            if (innings.partnerships.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Partnerships', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              ...innings.partnerships.map(
                (p) => Text(
                  '${p.playerA.name} & ${p.playerB.name}: ${p.runs} (${p.balls})',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

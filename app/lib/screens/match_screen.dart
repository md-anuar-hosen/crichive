import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/match_detail.dart';
import '../realtime/match_realtime_client.dart';
import '../state/auth_controller.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';
import 'playing_xi_screen.dart';
import 'scoring_screen.dart';
import 'toss_screen.dart';

class MatchScreen extends ConsumerStatefulWidget {
  const MatchScreen({super.key, required this.matchId});

  final String matchId;

  @override
  ConsumerState<MatchScreen> createState() => _MatchScreenState();
}

class _MatchScreenState extends ConsumerState<MatchScreen> {
  MatchRealtimeClient? _realtime;

  void _ensureRealtimeFor(MatchDetail match) {
    if (_realtime != null || !match.isLive) return;
    final client = MatchRealtimeClient(matchId: widget.matchId)
      ..connect()
      ..updates.listen((_) {
        if (mounted) ref.invalidate(matchProvider(widget.matchId));
      });
    _realtime = client;
  }

  @override
  void dispose() {
    _realtime?.dispose();
    super.dispose();
  }

  void _onScoringAction(BuildContext context, String action, MatchDetail match) {
    Widget screen;
    switch (action) {
      case 'toss':
        screen = TossScreen(matchId: match.id);
      case 'xi_a':
        screen = PlayingXiScreen(
          matchId: match.id,
          teamId: match.teamA.id,
          teamName: match.teamA.name,
          tournamentSlug: match.tournamentSlug,
        );
      case 'xi_b':
        screen = PlayingXiScreen(
          matchId: match.id,
          teamId: match.teamB.id,
          teamName: match.teamB.name,
          tournamentSlug: match.tournamentSlug,
        );
      case 'score':
        screen = ScoringScreen(matchId: match.id);
      default:
        return;
    }
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    final match = ref.watch(matchProvider(widget.matchId));
    match.whenData(_ensureRealtimeFor);
    final isAuthed = ref.watch(authControllerProvider).status == AuthStatus.authenticated;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Match'),
        actions: [
          if (isAuthed)
            match.whenOrNull(
              data: (m) => PopupMenuButton<String>(
                onSelected: (value) => _onScoringAction(context, value, m),
                itemBuilder: (context) => [
                  const PopupMenuItem(value: 'toss', child: Text('Record toss')),
                  PopupMenuItem(value: 'xi_a', child: Text('Playing XI — ${m.teamA.label}')),
                  PopupMenuItem(value: 'xi_b', child: Text('Playing XI — ${m.teamB.label}')),
                  const PopupMenuItem(value: 'score', child: Text('Score')),
                ],
              ),
            ) ??
                const SizedBox.shrink(),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(matchProvider(widget.matchId).future);
        },
        child: AsyncValueView(
          value: match,
          onRetry: () => ref.invalidate(matchProvider(widget.matchId)),
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

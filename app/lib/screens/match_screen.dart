import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/fall_of_wicket.dart';
import '../models/match_detail.dart';
import '../realtime/match_realtime_client.dart';
import '../state/auth_controller.dart';
import '../state/providers.dart';
import '../utils/cricket_math.dart';
import '../widgets/async_value_view.dart';
import 'match_charts_screen.dart';
import 'playing_xi_screen.dart';
import 'scoring_screen.dart';
import 'toss_screen.dart';

const _finishedStatuses = {'completed', 'abandoned', 'cancelled', 'forfeited'};

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
    if (action == 'abandon') {
      _showAbandonDialog(context, match.id);
      return;
    }
    if (action == 'interruption') {
      _showInterruptionDialog(context, match);
      return;
    }
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

  Future<void> _showAbandonDialog(BuildContext context, String matchId) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Abandon match'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('This ends the match now as a no-result. This cannot be undone.'),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(labelText: 'Reason (e.g. rain)'),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Abandon'),
          ),
        ],
      ),
    );
    if (reason == null || reason.isEmpty || !mounted) return;

    try {
      await ref.read(apiClientProvider).abandonMatch(matchId, reason: reason);
      ref.invalidate(matchProvider(matchId));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Match abandoned')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _showInterruptionDialog(BuildContext context, MatchDetail match) async {
    final openInnings = match.innings.where((i) => i.closedAt == null).lastOrNull;
    if (openInnings == null) return;

    final ballsPerOver = ref.read(tournamentProvider(match.tournamentSlug)).valueOrNull?.rules?.ballsPerOver ?? 6;
    final legalBalls = openInnings.totals?.legalBalls ?? 0;
    final oversRemainingBefore = openInnings.maxOvers - (legalBalls / ballsPerOver);

    final oversController = TextEditingController();
    final reasonController = TextEditingController();
    final result = await showDialog<double>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Record rain interruption'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'CricHive Rain Rule: revises the target using a resource-based '
              'method (not the licensed DLS). Currently ${oversRemainingBefore.toStringAsFixed(1)} overs remain.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: oversController,
              decoration: const InputDecoration(labelText: 'Overs remaining after stoppage'),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              decoration: const InputDecoration(labelText: 'Reason (e.g. rain)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final value = double.tryParse(oversController.text.trim());
              Navigator.of(dialogContext).pop(value);
            },
            child: const Text('Record'),
          ),
        ],
      ),
    );
    if (result == null || !mounted) return;

    try {
      await ref.read(apiClientProvider).recordInterruption(
            match.id,
            openInnings.inningsNumber,
            oversRemainingAfter: result,
            reason: reasonController.text.trim(),
          );
      ref.invalidate(matchProvider(match.id));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Interruption recorded, target revised')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final match = ref.watch(matchProvider(widget.matchId));
    match.whenData(_ensureRealtimeFor);
    final isAuthed = ref.watch(authControllerProvider).status == AuthStatus.authenticated;

    // players_per_side/balls_per_over come from tournament_rules, not
    // hardcoded — see CLAUDE.md. Defaults only cover the brief window
    // before the tournament fetch resolves.
    final ballsPerOver = match.whenOrNull(
          data: (m) => ref.watch(tournamentProvider(m.tournamentSlug)).valueOrNull?.rules?.ballsPerOver,
        ) ??
        6;
    final dlsEnabled = match.whenOrNull(
          data: (m) => ref.watch(tournamentProvider(m.tournamentSlug)).valueOrNull?.rules?.dlsEnabled,
        ) ??
        false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Match'),
        actions: [
          IconButton(
            tooltip: 'Charts & commentary',
            icon: const Icon(Icons.bar_chart_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => MatchChartsScreen(matchId: widget.matchId)),
            ),
          ),
          if (isAuthed)
            match.whenOrNull(
              data: (m) => PopupMenuButton<String>(
                onSelected: (value) => _onScoringAction(context, value, m),
                itemBuilder: (context) => [
                  const PopupMenuItem(value: 'toss', child: Text('Record toss')),
                  PopupMenuItem(value: 'xi_a', child: Text('Playing XI — ${m.teamA.label}')),
                  PopupMenuItem(value: 'xi_b', child: Text('Playing XI — ${m.teamB.label}')),
                  const PopupMenuItem(value: 'score', child: Text('Score')),
                  if (dlsEnabled && !_finishedStatuses.contains(m.status) && m.innings.any((i) => i.closedAt == null))
                    const PopupMenuItem(
                      value: 'interruption',
                      child: Text('Record rain interruption'),
                    ),
                  if (!_finishedStatuses.contains(m.status))
                    const PopupMenuItem(
                      value: 'abandon',
                      child: Text('Abandon match', style: TextStyle(color: Colors.red)),
                    ),
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
          data: (context, m) => _MatchBody(match: m, ballsPerOver: ballsPerOver),
        ),
      ),
    );
  }
}

class _MatchBody extends StatelessWidget {
  const _MatchBody({required this.match, required this.ballsPerOver});
  final MatchDetail match;
  final int ballsPerOver;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Text('${match.teamA.name} vs ${match.teamB.name}', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(_headerSubtitle(), style: Theme.of(context).textTheme.bodyMedium),
        if (_tossLine() != null) ...[
          const SizedBox(height: 4),
          Text(_tossLine()!, style: Theme.of(context).textTheme.bodySmall),
        ],
        if (match.resultNote != null) ...[
          const SizedBox(height: 8),
          Text(
            match.resultNote!,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.primary),
          ),
        ],
        if (match.playerOfMatch != null) ...[
          const SizedBox(height: 4),
          Text('Player of the match: ${match.playerOfMatch!.name}', style: Theme.of(context).textTheme.bodySmall),
        ],
        const SizedBox(height: 16),
        if (match.innings.isEmpty) const EmptyState(message: 'Play has not started yet.'),
        for (final innings in match.innings) _InningsCard(match: match, innings: innings, ballsPerOver: ballsPerOver),
      ],
    );
  }

  String _headerSubtitle() {
    if (match.ground == null) return match.status;
    return '${match.ground!.name}${match.ground!.city != null ? ', ${match.ground!.city}' : ''}';
  }

  String? _tossLine() {
    if (match.tossWinnerId == null || match.tossDecision == null) return null;
    final winner = match.tossWinnerId == match.teamA.id ? match.teamA.label : match.teamB.label;
    return '$winner won the toss, elected to ${match.tossDecision}';
  }
}

class _InningsCard extends StatelessWidget {
  const _InningsCard({required this.match, required this.innings, required this.ballsPerOver});
  final MatchDetail match;
  final InningsDetail innings;
  final int ballsPerOver;

  String _teamName(String teamId) {
    if (teamId == match.teamA.id) return match.teamA.label;
    if (teamId == match.teamB.id) return match.teamB.label;
    return 'Team';
  }

  @override
  Widget build(BuildContext context) {
    final totals = innings.totals;
    final isOpen = innings.closedAt == null;
    final fallOfWickets = computeFallOfWickets(innings, ballsPerOver);
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
                    '${totals.runs}/${totals.wickets} (${totals.oversDisplay(ballsPerOver)})',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
              ],
            ),
            if (totals != null) ..._buildRateLines(context, totals, isOpen),
            if (innings.interruptions.isNotEmpty) ...[
              const SizedBox(height: 8),
              _InterruptionBanner(innings: innings),
            ],
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
                          '${b.oversDisplay(ballsPerOver)}-${b.maidens}-${b.runsConceded}-${b.wickets}',
                          textAlign: TextAlign.end,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            if (fallOfWickets.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Fall of wickets', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              Text(
                fallOfWickets
                    .map((w) => '${w.score}-${w.wicketNumber}${w.batterName != null ? ' (${w.batterName})' : ''}')
                    .join(', '),
                style: Theme.of(context).textTheme.bodySmall,
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

  List<Widget> _buildRateLines(BuildContext context, InningsTotals totals, bool isOpen) {
    final style = Theme.of(context).textTheme.bodySmall;
    final crr = runRate(totals.runs, totals.legalBalls, ballsPerOver);
    final lines = <Widget>[Text('CRR ${crr.toStringAsFixed(2)}', style: style)];

    if (innings.target != null) {
      if (isOpen) {
        final rrr = requiredRunRate(
          target: innings.target!,
          runsSoFar: totals.runs,
          legalBallsBowled: totals.legalBalls,
          maxOvers: innings.maxOvers,
          ballsPerOver: ballsPerOver,
        );
        final remaining = ballsRemaining(
          maxOvers: innings.maxOvers,
          ballsPerOver: ballsPerOver,
          legalBallsBowled: totals.legalBalls,
        );
        final runsNeeded = innings.target! - totals.runs;
        if (rrr != null && runsNeeded > 0) {
          lines.add(Text('RRR ${rrr.toStringAsFixed(2)} · need $runsNeeded off $remaining balls', style: style));
        }
      }
    } else if (isOpen) {
      final projected = projectedScore(
        runsSoFar: totals.runs,
        legalBallsBowled: totals.legalBalls,
        maxOvers: innings.maxOvers,
        ballsPerOver: ballsPerOver,
      );
      lines.add(Text('Projected $projected', style: style));
    }

    return lines;
  }
}

/// Shows the "CricHive Rain Rule" revised target/overs and the interruption
/// history for an innings. Never label this "DLS"/"D/L" — see
/// backend/src/domain/rainRule for why.
class _InterruptionBanner extends StatelessWidget {
  const _InterruptionBanner({required this.innings});
  final InningsDetail innings;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final headline = innings.target != null
        ? 'Revised target: ${innings.target} off ${innings.maxOvers.toStringAsFixed(1)} overs (CricHive Rain Rule)'
        : 'Overs reduced to ${innings.maxOvers.toStringAsFixed(1)} (CricHive Rain Rule)';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.umbrella_outlined, size: 16, color: colors.onTertiaryContainer),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  headline,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onTertiaryContainer,
                        fontWeight: FontWeight.bold,
                      ),
                ),
              ),
            ],
          ),
          for (final event in innings.interruptions)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 22),
              child: Text(
                '${event.oversRemainingBefore.toStringAsFixed(1)} → ${event.oversRemainingAfter.toStringAsFixed(1)} overs remaining at '
                '${event.wicketsLostAt} wkt(s)${event.reason != null && event.reason!.isNotEmpty ? ' — ${event.reason}' : ''}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.onTertiaryContainer),
              ),
            ),
        ],
      ),
    );
  }
}

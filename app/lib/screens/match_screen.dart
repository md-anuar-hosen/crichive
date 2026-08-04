import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/fall_of_wicket.dart';
import '../models/match_detail.dart';
import '../realtime/match_realtime_client.dart';
import '../state/auth_controller.dart';
import '../state/providers.dart';
import '../theme/chart_palette.dart';
import '../utils/cricket_math.dart';
import '../widgets/async_value_view.dart';
import 'match_charts_screen.dart';
import 'match_scorers_screen.dart';
import 'match_squads_screen.dart';
import 'playing_xi_screen.dart';
import 'scoring_screen.dart';
import 'toss_screen.dart';
import 'tournament_detail_screen.dart';

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

  void _onScoringAction(
    BuildContext context,
    String action,
    MatchDetail match,
  ) {
    if (action == 'abandon') {
      _showAbandonDialog(context, match.id);
      return;
    }
    if (action == 'cancel') {
      _showCancelDialog(context, match.id);
      return;
    }
    if (action == 'forfeit') {
      _showForfeitDialog(context, match);
      return;
    }
    if (action == 'interruption') {
      _showInterruptionDialog(context, match);
      return;
    }
    if (action == 'follow_on') {
      _showFollowOnDialog(context, match);
      return;
    }
    if (action == 'stumps') {
      _recordStumps(context, match.id);
      return;
    }
    if (action == 'resume_play') {
      _resumePlay(context, match.id);
      return;
    }
    if (action == 'draw') {
      _showDrawDialog(context, match.id);
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
      case 'manage_scorers':
        screen = MatchScorersScreen(
          matchId: match.id,
          tournamentSlug: match.tournamentSlug,
        );
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
            const Text(
              'This ends the match now as a no-result. This cannot be undone.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'Reason (e.g. rain)',
              ),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Abandon'),
          ),
        ],
      ),
    );
    if (reason == null || reason.isEmpty || !mounted) return;

    try {
      await ref.read(apiClientProvider).abandonMatch(matchId, reason: reason);
      ref.invalidate(matchProvider(matchId));
      ref.invalidate(liveMatchesProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Match abandoned')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _showCancelDialog(BuildContext context, String matchId) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancel match'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'For a match that never started — a washout before the toss, a team withdrawing. This cannot be undone.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(labelText: 'Reason'),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Back'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Cancel match'),
          ),
        ],
      ),
    );
    if (reason == null || reason.isEmpty || !mounted) return;

    try {
      await ref.read(apiClientProvider).cancelMatch(matchId, reason: reason);
      ref.invalidate(matchProvider(matchId));
      ref.invalidate(liveMatchesProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Match cancelled')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _showForfeitDialog(
    BuildContext context,
    MatchDetail match,
  ) async {
    var winnerId = match.teamA.id;
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setState) => AlertDialog(
          title: const Text('Record forfeit'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'The other team wins by forfeit — this counts as a normal result. This cannot be undone.',
              ),
              const SizedBox(height: 12),
              Text(
                'Winner',
                style: Theme.of(dialogContext).textTheme.labelLarge,
              ),
              RadioGroup<String>(
                groupValue: winnerId,
                onChanged: (v) => setState(() => winnerId = v!),
                child: Column(
                  children: [
                    RadioListTile<String>(
                      title: Text(match.teamA.name),
                      value: match.teamA.id,
                    ),
                    RadioListTile<String>(
                      title: Text(match.teamB.name),
                      value: match.teamB.id,
                    ),
                  ],
                ),
              ),
              TextField(
                controller: reasonController,
                decoration: const InputDecoration(
                  labelText: 'Reason (optional)',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Record forfeit'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await ref
          .read(apiClientProvider)
          .forfeitMatch(
            match.id,
            winnerTeamId: winnerId,
            reason: reasonController.text.trim().isEmpty
                ? null
                : reasonController.text.trim(),
          );
      ref.invalidate(matchProvider(match.id));
      ref.invalidate(liveMatchesProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Forfeit recorded')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _showInterruptionDialog(
    BuildContext context,
    MatchDetail match,
  ) async {
    final openInnings = match.innings
        .where((i) => i.closedAt == null)
        .lastOrNull;
    if (openInnings == null) return;

    final ballsPerOver =
        ref
            .read(tournamentProvider(match.tournamentSlug))
            .valueOrNull
            ?.rules
            ?.ballsPerOver ??
        6;
    final legalBalls = openInnings.totals?.legalBalls ?? 0;
    final oversRemainingBefore =
        (openInnings.maxOvers ?? 0) - (legalBalls / ballsPerOver);

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
              'method (not the licensed DLS). Currently '
              '${formatDecimalOvers(oversRemainingBefore, ballsPerOver)} overs remain.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: oversController,
              decoration: const InputDecoration(
                labelText: 'Overs remaining after stoppage',
                hintText: 'overs.balls, e.g. 3.2 for 3 overs 2 balls',
              ),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              decoration: const InputDecoration(
                labelText: 'Reason (e.g. rain)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final value = parseCricketOversToDecimal(
                oversController.text.trim(),
                ballsPerOver,
              );
              Navigator.of(dialogContext).pop(value);
            },
            child: const Text('Record'),
          ),
        ],
      ),
    );
    if (result == null || !mounted) return;

    try {
      await ref
          .read(apiClientProvider)
          .recordInterruption(
            match.id,
            openInnings.inningsNumber,
            oversRemainingAfter: result,
            reason: reasonController.text.trim(),
          );
      ref.invalidate(matchProvider(match.id));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Interruption recorded, target revised')),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Test matches only — asks the organiser whether to enforce the
  /// follow-on now that it's available (see [MatchDetail.followOnAvailable]).
  Future<void> _showFollowOnDialog(
    BuildContext context,
    MatchDetail match,
  ) async {
    bool? enforce = false;
    if (match.followOnAvailable) {
      enforce = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Follow-on available'),
          content: const Text(
            'The side that bowled second may enforce the follow-on, making '
            'the other side bat again immediately. Otherwise, play continues '
            'in the normal order.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Bat again normally'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Enforce follow-on'),
            ),
          ],
        ),
      );
    }
    if (enforce == null || !mounted) return;

    try {
      await ref
          .read(apiClientProvider)
          .startNextTestInnings(match.id, enforceFollowOn: enforce);
      ref.invalidate(matchProvider(match.id));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(enforce ? 'Follow-on enforced' : 'Innings 3 started'),
        ),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _recordStumps(BuildContext context, String matchId) async {
    try {
      await ref.read(apiClientProvider).recordStumps(matchId);
      ref.invalidate(matchProvider(matchId));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Stumps — play paused for the day')),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _resumePlay(BuildContext context, String matchId) async {
    try {
      final day = await ref.read(apiClientProvider).resumeTestPlay(matchId);
      ref.invalidate(matchProvider(matchId));
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Day $day underway')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _showDrawDialog(BuildContext context, String matchId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('End match as a draw'),
        content: const Text(
          'Ends the match now with no result — the app never infers a draw '
          'from elapsed time on its own. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Back'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('End as draw'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await ref.read(apiClientProvider).drawMatch(matchId);
      ref.invalidate(matchProvider(matchId));
      ref.invalidate(liveMatchesProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Match drawn')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final match = ref.watch(matchProvider(widget.matchId));
    match.whenData(_ensureRealtimeFor);
    final isAuthed =
        ref.watch(authControllerProvider).status == AuthStatus.authenticated;

    // players_per_side/balls_per_over come from tournament_rules, not
    // hardcoded — see CLAUDE.md. Defaults only cover the brief window
    // before the tournament fetch resolves.
    final ballsPerOver =
        match.whenOrNull(
          data: (m) => ref
              .watch(tournamentProvider(m.tournamentSlug))
              .valueOrNull
              ?.rules
              ?.ballsPerOver,
        ) ??
        6;
    final dlsEnabled =
        match.whenOrNull(
          data: (m) => ref
              .watch(tournamentProvider(m.tournamentSlug))
              .valueOrNull
              ?.rules
              ?.dlsEnabled,
        ) ??
        false;
    final playersPerSide =
        match.whenOrNull(
          data: (m) => ref
              .watch(tournamentProvider(m.tournamentSlug))
              .valueOrNull
              ?.rules
              ?.playersPerSide,
        ) ??
        11;
    final isTest =
        match.whenOrNull(
          data: (m) => ref
              .watch(tournamentProvider(m.tournamentSlug))
              .valueOrNull
              ?.rules
              ?.isTest,
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
              MaterialPageRoute(
                builder: (_) => MatchChartsScreen(matchId: widget.matchId),
              ),
            ),
          ),
          if (isAuthed)
            match.whenOrNull(
                  data: (m) => PopupMenuButton<String>(
                    onSelected: (value) => _onScoringAction(context, value, m),
                    itemBuilder: (context) {
                      // Both innings 1 and 2 closed but innings 3 not started
                      // yet — true whether or not the follow-on threshold was
                      // reached, since starting innings 3 in the normal order
                      // needs the exact same action when there's no decision
                      // to make.
                      final awaitingInnings3 =
                          m.status == 'innings_break' &&
                          m.innings.length == 2 &&
                          m.innings.every((i) => i.closedAt != null);
                      return [
                        const PopupMenuItem(
                          value: 'toss',
                          child: Text('Record toss'),
                        ),
                        PopupMenuItem(
                          value: 'xi_a',
                          child: Text('Playing XI — ${m.teamA.label}'),
                        ),
                        PopupMenuItem(
                          value: 'xi_b',
                          child: Text('Playing XI — ${m.teamB.label}'),
                        ),
                        const PopupMenuItem(
                          value: 'score',
                          child: Text('Score'),
                        ),
                        const PopupMenuItem(
                          value: 'manage_scorers',
                          child: Text('Manage scorers'),
                        ),
                        if (dlsEnabled &&
                            !isTest &&
                            !_finishedStatuses.contains(m.status) &&
                            m.innings.any(
                              (i) => i.closedAt == null && !i.isSuperOver,
                            ))
                          const PopupMenuItem(
                            value: 'interruption',
                            child: Text('Record rain interruption'),
                          ),
                        if (isTest && (m.followOnAvailable || awaitingInnings3))
                          PopupMenuItem(
                            value: 'follow_on',
                            child: Text(
                              m.followOnAvailable
                                  ? 'Start innings 3 / follow-on'
                                  : 'Start innings 3',
                            ),
                          ),
                        if (isTest &&
                            [
                              'toss_done',
                              'live',
                              'innings_break',
                            ].contains(m.status))
                          PopupMenuItem(
                            value: 'stumps',
                            child: Text('Stumps — end day ${m.currentDay}'),
                          ),
                        if (isTest && m.status == 'day_break')
                          const PopupMenuItem(
                            value: 'resume_play',
                            child: Text('Resume play (next day)'),
                          ),
                        if (isTest && !_finishedStatuses.contains(m.status))
                          const PopupMenuItem(
                            value: 'draw',
                            child: Text(
                              'End as draw',
                              style: TextStyle(color: Colors.red),
                            ),
                          ),
                        if (!_finishedStatuses.contains(m.status))
                          const PopupMenuItem(
                            value: 'abandon',
                            child: Text(
                              'Abandon match',
                              style: TextStyle(color: Colors.red),
                            ),
                          ),
                        if (m.status == 'scheduled')
                          const PopupMenuItem(
                            value: 'cancel',
                            child: Text(
                              'Cancel match',
                              style: TextStyle(color: Colors.red),
                            ),
                          ),
                        if (!_finishedStatuses.contains(m.status))
                          const PopupMenuItem(
                            value: 'forfeit',
                            child: Text(
                              'Record forfeit',
                              style: TextStyle(color: Colors.red),
                            ),
                          ),
                      ];
                    },
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
          data: (context, m) => _MatchBody(
            match: m,
            ballsPerOver: ballsPerOver,
            playersPerSide: playersPerSide,
          ),
        ),
      ),
    );
  }
}

class _MatchBody extends StatelessWidget {
  const _MatchBody({
    required this.match,
    required this.ballsPerOver,
    required this.playersPerSide,
  });
  final MatchDetail match;
  final int ballsPerOver;
  final int playersPerSide;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          '${match.teamA.name} vs ${match.teamB.name}',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 4),
        Text(_headerSubtitle(), style: Theme.of(context).textTheme.bodyMedium),
        if (match.matchType == 'test') ...[
          const SizedBox(height: 2),
          Text(
            match.daysPerMatch == null
                ? 'Day ${match.currentDay}'
                : 'Day ${match.currentDay} of ${match.daysPerMatch}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        if (_tossLine() != null) ...[
          const SizedBox(height: 4),
          Text(_tossLine()!, style: Theme.of(context).textTheme.bodySmall),
        ],
        if (match.resultNote != null) ...[
          const SizedBox(height: 8),
          Text(
            match.resultNote!,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
        ],
        if (match.playerOfMatch != null) ...[
          const SizedBox(height: 4),
          Text(
            'Player of the match: ${match.playerOfMatch!.name}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        const SizedBox(height: 16),
        if (match.innings.isEmpty)
          const EmptyState(message: 'Play has not started yet.'),
        for (final innings in match.innings)
          _InningsCard(
            match: match,
            innings: innings,
            ballsPerOver: ballsPerOver,
            playersPerSide: playersPerSide,
          ),
        const SizedBox(height: 8),
        _QuickNavRow(match: match),
      ],
    );
  }

  String _headerSubtitle() {
    if (match.ground == null) return match.status;
    return '${match.ground!.name}${match.ground!.city != null ? ', ${match.ground!.city}' : ''}';
  }

  String? _tossLine() {
    if (match.tossWinnerId == null || match.tossDecision == null) return null;
    final winner = match.tossWinnerId == match.teamA.id
        ? match.teamA.label
        : match.teamB.label;
    return '$winner won the toss, elected to ${match.tossDecision}';
  }
}

/// Bottom quick-nav pills — the Cricbuzz reference image's own "Graphs /
/// Series Stats / Table / Schedule" row. CricHive doesn't have separate
/// Highlights/News/Full-Commentary content sources, so this links to what
/// actually exists: charts+commentary, squads, and the points table.
class _QuickNavRow extends StatelessWidget {
  const _QuickNavRow({required this.match});
  final MatchDetail match;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        OutlinedButton.icon(
          icon: const Icon(Icons.bar_chart_outlined, size: 18),
          label: const Text('Graphs'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => MatchChartsScreen(matchId: match.id),
            ),
          ),
        ),
        OutlinedButton.icon(
          icon: const Icon(Icons.groups_outlined, size: 18),
          label: const Text('Squads'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => MatchSquadsScreen(
                tournamentSlug: match.tournamentSlug,
                teamA: match.teamA,
                teamB: match.teamB,
              ),
            ),
          ),
        ),
        OutlinedButton.icon(
          icon: const Icon(Icons.table_chart_outlined, size: 18),
          label: const Text('Points Table'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TournamentDetailScreen(
                slug: match.tournamentSlug,
                initialTabIndex: 2,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _InningsCard extends StatelessWidget {
  const _InningsCard({
    required this.match,
    required this.innings,
    required this.ballsPerOver,
    required this.playersPerSide,
  });
  final MatchDetail match;
  final InningsDetail innings;
  final int ballsPerOver;
  final int playersPerSide;

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
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _teamName(innings.battingTeamId),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (innings.isSuperOver) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: Theme.of(
                            context,
                          ).colorScheme.tertiaryContainer,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'SUPER OVER',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onTertiaryContainer,
                              ),
                        ),
                      ),
                    ],
                  ],
                ),
                if (totals != null)
                  Text(
                    '${totals.runs}/${totals.wickets} (${totals.oversDisplay(ballsPerOver)})',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
              ],
            ),
            if (totals != null) ..._buildRateLines(context, totals, isOpen),
            if (totals != null && isOpen)
              ..._buildChaseHeadline(context, totals),
            if (innings.interruptions.isNotEmpty) ...[
              const SizedBox(height: 8),
              _InterruptionBanner(innings: innings, ballsPerOver: ballsPerOver),
            ],
            if (isOpen && innings.partnerships.isNotEmpty) ...[
              const SizedBox(height: 8),
              _KeyStatsBox(partnership: innings.partnerships.last),
            ],
            if (totals != null && isOpen)
              ..._buildWinProbability(context, totals),
            const SizedBox(height: 12),
            if (innings.batting.isNotEmpty) ...[
              _BattingTable(rows: innings.batting),
              const SizedBox(height: 12),
            ],
            if (innings.bowling.isNotEmpty) ...[
              _BowlingTable(rows: innings.bowling, ballsPerOver: ballsPerOver),
              const SizedBox(height: 4),
            ],
            if (fallOfWickets.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Fall of wickets',
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: 4),
              Text(
                fallOfWickets
                    .map(
                      (w) =>
                          '${w.score}-${w.wicketNumber}${w.batterName != null ? ' (${w.batterName})' : ''}',
                    )
                    .join(', '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (innings.partnerships.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                'Partnerships',
                style: Theme.of(context).textTheme.labelLarge,
              ),
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

  List<Widget> _buildRateLines(
    BuildContext context,
    InningsTotals totals,
    bool isOpen,
  ) {
    final style = Theme.of(context).textTheme.bodySmall;
    final crr = runRate(totals.runs, totals.legalBalls, ballsPerOver);
    final lines = <Widget>[Text('CRR ${crr.toStringAsFixed(2)}', style: style)];

    final maxOvers = innings.maxOvers;
    if (innings.target != null) {
      if (isOpen && maxOvers != null) {
        final rrr = requiredRunRate(
          target: innings.target!,
          runsSoFar: totals.runs,
          legalBallsBowled: totals.legalBalls,
          maxOvers: maxOvers,
          ballsPerOver: ballsPerOver,
        );
        if (rrr != null && innings.target! - totals.runs > 0) {
          lines.add(Text('RRR ${rrr.toStringAsFixed(2)}', style: style));
        }
      }
    } else if (isOpen && maxOvers != null) {
      final projected = projectedScore(
        runsSoFar: totals.runs,
        legalBallsBowled: totals.legalBalls,
        maxOvers: maxOvers,
        ballsPerOver: ballsPerOver,
      );
      lines.add(Text('Projected $projected', style: style));
    }

    return lines;
  }

  /// The bold red "{Team} need N runs [in M balls]" headline, Cricbuzz-style.
  /// A Test's deciding innings has a target but no overs cap, so it drops
  /// the "in M balls" clause rather than computing a nonsensical remainder.
  List<Widget> _buildChaseHeadline(BuildContext context, InningsTotals totals) {
    if (innings.target == null) return const [];
    final runsNeeded = innings.target! - totals.runs;
    if (runsNeeded <= 0) return const [];
    final maxOvers = innings.maxOvers;
    final needText = maxOvers == null
        ? '${_teamName(innings.battingTeamId)} need $runsNeeded runs'
        : (() {
            final remaining = ballsRemaining(
              maxOvers: maxOvers,
              ballsPerOver: ballsPerOver,
              legalBallsBowled: totals.legalBalls,
            );
            return remaining <= 0
                ? null
                : '${_teamName(innings.battingTeamId)} need $runsNeeded runs in $remaining balls';
          })();
    if (needText == null) return const [];
    return [
      const SizedBox(height: 4),
      Text(
        needText,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: Colors.red.shade700,
          fontWeight: FontWeight.bold,
        ),
      ),
    ];
  }

  /// "CricHive Win Predictor" — our own simplified heuristic (required vs.
  /// current run rate, discounted by wickets in hand), not a statistical
  /// model. Only shown once there's enough data for it to mean anything —
  /// and only for a limited-overs chase, since it needs an overs cap.
  List<Widget> _buildWinProbability(
    BuildContext context,
    InningsTotals totals,
  ) {
    final maxOvers = innings.maxOvers;
    if (innings.target == null || totals.legalBalls == 0 || maxOvers == null) {
      return const [];
    }
    final remaining = ballsRemaining(
      maxOvers: maxOvers,
      ballsPerOver: ballsPerOver,
      legalBallsBowled: totals.legalBalls,
    );
    final runsNeeded = innings.target! - totals.runs;
    if (remaining <= 0 || runsNeeded <= 0) return const [];

    final rrr = requiredRunRate(
      target: innings.target!,
      runsSoFar: totals.runs,
      legalBallsBowled: totals.legalBalls,
      maxOvers: maxOvers,
      ballsPerOver: ballsPerOver,
    );
    if (rrr == null) return const [];
    final crr = runRate(totals.runs, totals.legalBalls, ballsPerOver);
    final wicketsAvailable = playersPerSide - 1;
    final wicketsInHand = (wicketsAvailable - totals.wickets).clamp(
      0,
      wicketsAvailable,
    );
    final chasingProbability = chasingTeamWinProbability(
      requiredRunRate: rrr,
      currentRunRate: crr,
      wicketsInHand: wicketsInHand,
      wicketsAvailable: wicketsAvailable,
    );

    final brightness = Theme.of(context).brightness;
    return [
      const SizedBox(height: 8),
      _WinProbabilityBar(
        defendingLabel: _teamName(innings.bowlingTeamId),
        chasingLabel: _teamName(innings.battingTeamId),
        chasingProbability: chasingProbability,
        defendingColor: ChartPalette.categorical(0, brightness),
        chasingColor: ChartPalette.categorical(1, brightness),
      ),
    ];
  }
}

/// Fixed pixel column widths, not flex — a Row of Expanded cells squeezes
/// (and clips) on a genuinely narrow phone screen instead of scrolling.
/// Wrapping in SingleChildScrollView(horizontal) matches how the standings
/// table already handles the same problem.
class _BattingTable extends StatelessWidget {
  const _BattingTable({required this.rows});
  final List<BattingCardRow> rows;

  static const _nameWidth = 140.0;
  static const _numWidth = 36.0;
  static const _srWidth = 56.0;
  static const _totalWidth = _nameWidth + _numWidth * 4 + _srWidth;

  Widget _cell(
    String text,
    double width, {
    TextAlign align = TextAlign.end,
    TextStyle? style,
  }) => SizedBox(
    width: width,
    child: Text(
      text,
      textAlign: align,
      style: style,
      overflow: TextOverflow.ellipsis,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final headerStyle = Theme.of(context).textTheme.labelSmall?.copyWith(
      color: Theme.of(context).colorScheme.outline,
    );
    final bodyStyle = Theme.of(context).textTheme.bodySmall;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Batting', style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 4),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: _totalWidth,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _cell(
                      'Batter',
                      _nameWidth,
                      align: TextAlign.start,
                      style: headerStyle,
                    ),
                    _cell('R', _numWidth, style: headerStyle),
                    _cell('B', _numWidth, style: headerStyle),
                    _cell('4s', _numWidth, style: headerStyle),
                    _cell('6s', _numWidth, style: headerStyle),
                    _cell('SR', _srWidth, style: headerStyle),
                  ],
                ),
                const Divider(height: 8),
                for (final b in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            _cell(
                              b.name,
                              _nameWidth,
                              align: TextAlign.start,
                              style: bodyStyle?.copyWith(
                                fontWeight: b.isOut
                                    ? FontWeight.normal
                                    : FontWeight.bold,
                              ),
                            ),
                            _cell('${b.runs}', _numWidth, style: bodyStyle),
                            _cell(
                              '${b.ballsFaced}',
                              _numWidth,
                              style: bodyStyle,
                            ),
                            _cell('${b.fours}', _numWidth, style: bodyStyle),
                            _cell('${b.sixes}', _numWidth, style: bodyStyle),
                            _cell(
                              b.strikeRate.toStringAsFixed(2),
                              _srWidth,
                              style: bodyStyle,
                            ),
                          ],
                        ),
                        SizedBox(
                          width: _totalWidth,
                          child: Text(
                            b.isOut ? (b.dismissalText ?? 'out') : 'not out',
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: Theme.of(context).colorScheme.outline,
                                ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _BowlingTable extends StatelessWidget {
  const _BowlingTable({required this.rows, required this.ballsPerOver});
  final List<BowlingCardRow> rows;
  final int ballsPerOver;

  static const _nameWidth = 140.0;
  static const _numWidth = 36.0;
  static const _econWidth = 56.0;
  static const _totalWidth = _nameWidth + _numWidth * 5 + _econWidth;

  Widget _cell(
    String text,
    double width, {
    TextAlign align = TextAlign.end,
    TextStyle? style,
  }) => SizedBox(
    width: width,
    child: Text(
      text,
      textAlign: align,
      style: style,
      overflow: TextOverflow.ellipsis,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final headerStyle = Theme.of(context).textTheme.labelSmall?.copyWith(
      color: Theme.of(context).colorScheme.outline,
    );
    final bodyStyle = Theme.of(context).textTheme.bodySmall;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Bowling', style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 4),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: _totalWidth,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _cell(
                      'Bowler',
                      _nameWidth,
                      align: TextAlign.start,
                      style: headerStyle,
                    ),
                    _cell('O', _numWidth, style: headerStyle),
                    _cell('M', _numWidth, style: headerStyle),
                    _cell('R', _numWidth, style: headerStyle),
                    _cell('W', _numWidth, style: headerStyle),
                    _cell('Econ', _econWidth, style: headerStyle),
                    _cell('D', _numWidth, style: headerStyle),
                  ],
                ),
                const Divider(height: 8),
                for (final b in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        _cell(
                          b.name,
                          _nameWidth,
                          align: TextAlign.start,
                          style: bodyStyle,
                        ),
                        _cell(
                          b.oversDisplay(ballsPerOver),
                          _numWidth,
                          style: bodyStyle,
                        ),
                        _cell('${b.maidens}', _numWidth, style: bodyStyle),
                        _cell('${b.runsConceded}', _numWidth, style: bodyStyle),
                        _cell('${b.wickets}', _numWidth, style: bodyStyle),
                        _cell(
                          b.economy(ballsPerOver).toStringAsFixed(2),
                          _econWidth,
                          style: bodyStyle,
                        ),
                        _cell('${b.dots}', _numWidth, style: bodyStyle),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Boxed live stat — currently just the in-progress partnership, Cricbuzz's
/// "Key Stats" panel. Toss is shown once at the top of the match, not
/// repeated per innings.
class _KeyStatsBox extends StatelessWidget {
  const _KeyStatsBox({required this.partnership});
  final Partnership partnership;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.groups_outlined, size: 16, color: colors.outline),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Partnership: ${partnership.runs} (${partnership.balls}) — ${partnership.playerA.name} & ${partnership.playerB.name}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

/// "CricHive Win Predictor" — our own simplified heuristic bar, not a claim
/// to replicate Cricbuzz's statistical win-probability model.
class _WinProbabilityBar extends StatelessWidget {
  const _WinProbabilityBar({
    required this.defendingLabel,
    required this.chasingLabel,
    required this.chasingProbability,
    required this.defendingColor,
    required this.chasingColor,
  });

  final String defendingLabel;
  final String chasingLabel;
  final double chasingProbability;
  final Color defendingColor;
  final Color chasingColor;

  @override
  Widget build(BuildContext context) {
    final defendingProbability = 100 - chasingProbability;
    final chasingFlex = chasingProbability.round().clamp(1, 99);
    final defendingFlex = defendingProbability.round().clamp(1, 99);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'CricHive Win Predictor',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: Theme.of(context).colorScheme.outline,
          ),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '$defendingLabel ${defendingProbability.round()}%',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: defendingColor,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              '${chasingProbability.round()}% $chasingLabel',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: chasingColor,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: SizedBox(
            height: 8,
            child: Row(
              children: [
                Expanded(
                  flex: defendingFlex,
                  child: Container(color: defendingColor),
                ),
                Expanded(
                  flex: chasingFlex,
                  child: Container(color: chasingColor),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Shows the "CricHive Rain Rule" revised target/overs and the interruption
/// history for an innings. Never label this "DLS"/"D/L" — see
/// backend/src/domain/rainRule for why.
class _InterruptionBanner extends StatelessWidget {
  const _InterruptionBanner({required this.innings, required this.ballsPerOver});
  final InningsDetail innings;
  final int ballsPerOver;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    // Only ever shown for a limited-overs innings (the Rain Rule doesn't
    // apply to Test matches), so maxOvers is always set in practice.
    final maxOvers = innings.maxOvers ?? 0;
    final maxOversDisplay = formatDecimalOvers(maxOvers, ballsPerOver);
    final headline = innings.target != null
        ? 'Revised target: ${innings.target} off $maxOversDisplay overs (CricHive Rain Rule)'
        : 'Overs reduced to $maxOversDisplay (CricHive Rain Rule)';

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
              Icon(
                Icons.umbrella_outlined,
                size: 16,
                color: colors.onTertiaryContainer,
              ),
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
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: colors.onTertiaryContainer,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

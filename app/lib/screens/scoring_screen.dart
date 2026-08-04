import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/delivery.dart';
import '../models/match_detail.dart';
import '../models/pending_delivery.dart';
import '../models/player.dart';
import '../state/providers.dart';
import '../utils/cricket_math.dart';
import '../utils/strike_rotation.dart' as rotation;
import '../utils/uuid.dart';
import '../widgets/async_value_view.dart';

const _dismissalKinds = [
  'bowled',
  'caught',
  'lbw',
  'run_out',
  'stumped',
  'hit_wicket',
  'retired_hurt',
  'retired_out',
  'obstructing_the_field',
  'hit_ball_twice',
  'timed_out',
];

/// Which "extra" type is currently armed on the keypad. [legal] means no
/// extra is armed — the next run digit tapped is a plain legal delivery.
enum _ExtraMode { legal, wide, noBall, bye, legBye }

class ScoringScreen extends ConsumerStatefulWidget {
  const ScoringScreen({super.key, required this.matchId});

  final String matchId;

  @override
  ConsumerState<ScoringScreen> createState() => _ScoringScreenState();
}

class _ScoringScreenState extends ConsumerState<ScoringScreen> {
  String? _strikerId;
  String? _nonStrikerId;
  String? _bowlerId;

  _ExtraMode _extraMode = _ExtraMode.legal;

  bool _submitting = false;
  bool _undoing = false;
  String _clientEventId = generateUuidV4();

  int _pendingCount = 0;
  bool _syncing = false;

  // Set fresh on every build (see build()) — read here rather than passed
  // as a build-time-only local, since ball-tap handlers run from button
  // callbacks outside build()'s scope. Default to the common case (1 run
  // for a wide/no-ball) only for the brief window before the tournament's
  // rules have loaded, same convention as match_screen.dart's ballsPerOver.
  int _wideRuns = 1;
  int _noballRuns = 1;
  int _ballsPerOver = 6;

  // The tail of the innings' ball-by-ball feed, server-confirmed, used to
  // render the current-over history strip and to resolve which delivery
  // "undo" should void. Deliveries queued offline aren't reflected here —
  // same staleness the pending-sync banner already warns about.
  List<Delivery> _recentDeliveries = [];
  int? _seededForInnings;

  @override
  void initState() {
    super.initState();
    _flushQueue(widget.matchId, silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final match = ref.watch(matchProvider(widget.matchId));
    final rules = match.whenOrNull(
      data: (m) =>
          ref.watch(tournamentProvider(m.tournamentSlug)).valueOrNull?.rules,
    );
    _ballsPerOver = rules?.ballsPerOver ?? 6;
    _wideRuns = rules?.wideRuns ?? 1;
    _noballRuns = rules?.noballRuns ?? 1;

    return Scaffold(
      appBar: AppBar(title: const Text('Score')),
      body: AsyncValueView(
        value: match,
        onRetry: () => ref.invalidate(matchProvider(widget.matchId)),
        data: (context, m) {
          final openInnings = m.innings
              .where((i) => i.closedAt == null)
              .toList();
          if (openInnings.isEmpty) {
            return const EmptyState(
              message:
                  'No open innings. Record the toss first, or start the next innings by closing the current one.',
              icon: Icons.sports_cricket_outlined,
            );
          }
          final innings = openInnings.first;
          final battingTeam = innings.battingTeamId == m.teamA.id
              ? m.teamA
              : m.teamB;
          final bowlingTeam = innings.battingTeamId == m.teamA.id
              ? m.teamB
              : m.teamA;

          final battingSquad = ref.watch(
            squadProvider((
              teamId: battingTeam.id,
              tournamentSlug: m.tournamentSlug,
            )),
          );
          final bowlingSquad = ref.watch(
            squadProvider((
              teamId: bowlingTeam.id,
              tournamentSlug: m.tournamentSlug,
            )),
          );

          return AsyncValueView(
            value: battingSquad,
            data: (context, batting) => AsyncValueView(
              value: bowlingSquad,
              data: (context, bowling) => _buildForm(
                context,
                m,
                innings,
                batting,
                bowling,
                rules?.ballsPerOver ?? 6,
                rules?.playersPerSide ?? 11,
                rules?.freeHitAfterNoball ?? false,
                rules?.isTest ?? false,
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildForm(
    BuildContext context,
    MatchDetail match,
    InningsDetail innings,
    List<SquadPlayer> battingSquad,
    List<SquadPlayer> bowlingSquad,
    int ballsPerOver,
    int playersPerSide,
    bool freeHitAfterNoball,
    bool isTest,
  ) {
    if (_seededForInnings != innings.inningsNumber) {
      _seededForInnings = innings.inningsNumber;
      Future.microtask(
        () => _seedFromServer(match.id, innings.inningsNumber, ballsPerOver),
      );
    }

    final totals = innings.totals;
    final playersReady =
        _strikerId != null && _nonStrikerId != null && _bowlerId != null;
    final isFreeHit = _recentDeliveries.isNotEmpty &&
        rotation.isNextDeliveryFreeHit(
          _recentDeliveries.last,
          freeHitAfterNoball: freeHitAfterNoball,
        );
    final wicketsThatEndInnings = playersPerSide - 1;
    final willBeAllOut =
        (totals?.wickets ?? 0) + 1 >= wicketsThatEndInnings;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_pendingCount > 0)
          _PendingSyncBanner(
            count: _pendingCount,
            syncing: _syncing,
            onSyncNow: () => _flushQueue(match.id),
          ),
        Text(
          totals == null
              ? '0/0 (0.0)'
              : '${totals.runs}/${totals.wickets} (${totals.oversDisplay(ballsPerOver)})',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        Text(
          'Innings ${innings.inningsNumber}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (totals != null)
          _RateLine(
            innings: innings,
            totals: totals,
            ballsPerOver: ballsPerOver,
          ),
        const SizedBox(height: 16),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _BatsmanCard(
                  name: _playerName(battingSquad, _strikerId),
                  line: _battingLine(innings, _strikerId),
                  onStrike: true,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _BatsmanCard(
                  name: _playerName(battingSquad, _nonStrikerId),
                  line: _battingLine(innings, _nonStrikerId),
                  onStrike: false,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(
          _bowlerId == null
              ? 'Bowler not selected'
              : '${_playerName(bowlingSquad, _bowlerId)}  ${_bowlingLine(innings, _bowlerId, ballsPerOver)}',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 12),
        _ThisOverStrip(deliveries: _currentOverDeliveries()),
        if (isFreeHit) ...[
          const SizedBox(height: 8),
          Chip(
            label: const Text('FREE HIT'),
            backgroundColor: Theme.of(context).colorScheme.errorContainer,
            labelStyle: TextStyle(
              color: Theme.of(context).colorScheme.onErrorContainer,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
        const SizedBox(height: 16),
        if (!playersReady)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'Pick striker, non-striker and bowler in Scoring shortcuts below to start scoring.',
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(fontStyle: FontStyle.italic),
            ),
          ),
        _Keypad(
          enabled: playersReady && !_submitting,
          extraMode: _extraMode,
          onExtraModeToggled: (mode) => setState(
            () => _extraMode = _extraMode == mode ? _ExtraMode.legal : mode,
          ),
          onRuns: (runs) => _scoreBall(match.id, innings.inningsNumber, runs),
          onMoreRuns: () => _showMoreRunsSheet(match.id, innings.inningsNumber),
          onUndo: (_pendingCount > 0 || _recentDeliveries.isNotEmpty) && !_undoing
              ? () => _undo(match.id, innings.inningsNumber)
              : null,
          undoing: _undoing,
          onOut: playersReady && !_submitting
              ? () => _showWicketDialog(
                    context,
                    match.id,
                    innings.inningsNumber,
                    battingSquad,
                    bowlingSquad,
                    willBeAllOut,
                  )
              : null,
        ),
        const SizedBox(height: 16),
        ExpansionTile(
          title: const Text('Scoring shortcuts'),
          initiallyExpanded: !playersReady,
          tilePadding: EdgeInsets.zero,
          childrenPadding: const EdgeInsets.only(bottom: 12),
          children: [
            Row(
              children: [
                Expanded(
                  child: _PlayerDropdown(
                    label: 'Striker',
                    players: battingSquad,
                    value: _strikerId,
                    onChanged: (v) => setState(() => _strikerId = v),
                  ),
                ),
                IconButton(
                  tooltip: 'Swap strike',
                  icon: const Icon(Icons.swap_horiz),
                  onPressed: (_strikerId == null || _nonStrikerId == null)
                      ? null
                      : () => setState(() {
                          final tmp = _strikerId;
                          _strikerId = _nonStrikerId;
                          _nonStrikerId = tmp;
                        }),
                ),
                Expanded(
                  child: _PlayerDropdown(
                    label: 'Non-striker',
                    players: battingSquad,
                    value: _nonStrikerId,
                    onChanged: (v) => setState(() => _nonStrikerId = v),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _PlayerDropdown(
              label: 'Bowler',
              players: bowlingSquad,
              value: _bowlerId,
              onChanged: (v) => setState(() => _bowlerId = v),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => _closeInnings(match.id, innings.inningsNumber),
              // A Test innings has no overs cap, so closing it before all-out is
              // a real declaration rather than a formality.
              child: Text(
                isTest ? 'Declare / close this innings' : 'Close this innings',
              ),
            ),
          ],
        ),
      ],
    );
  }

  String _playerName(List<SquadPlayer> squad, String? id) {
    if (id == null) return '—';
    for (final p in squad) {
      if (p.id == id) return p.name;
    }
    return '—';
  }

  String _battingLine(InningsDetail innings, String? id) {
    if (id == null) return '';
    for (final b in innings.batting) {
      if (b.id == id) return '${b.runs}(${b.ballsFaced})';
    }
    return '0(0)';
  }

  String _bowlingLine(InningsDetail innings, String? id, int ballsPerOver) {
    if (id == null) return '';
    for (final b in innings.bowling) {
      if (b.id == id) {
        return '${b.oversDisplay(ballsPerOver)}-${b.maidens}-${b.runsConceded}-${b.wickets}';
      }
    }
    return '0.0-0-0-0';
  }

  /// The in-progress over's balls, newest last — everything in
  /// [_recentDeliveries] sharing the last delivery's over number.
  List<Delivery> _currentOverDeliveries() {
    if (_recentDeliveries.isEmpty) return const [];
    final currentOver = _recentDeliveries.last.overNumber;
    return _recentDeliveries
        .where((d) => d.overNumber == currentOver)
        .toList();
  }

  Future<void> _seedFromServer(
    String matchId,
    int inningsNumber,
    int ballsPerOver,
  ) async {
    try {
      final recent = await ref
          .read(apiClientProvider)
          .getRecentDeliveries(matchId, inningsNumber);
      if (!mounted) return;
      setState(() {
        _recentDeliveries = recent;
        if (_strikerId == null && _nonStrikerId == null && recent.isNotEmpty) {
          final last = recent.last;
          if (last.wicketKind == null) {
            final next = rotation.computeNextStrikers(
              last,
              wideRuns: _wideRuns,
              ballsPerOver: ballsPerOver,
            );
            _strikerId = next.strikerId;
            _nonStrikerId = next.nonStrikerId;
          }
          _bowlerId = rotation.isEndOfOver(last, ballsPerOver: ballsPerOver)
              ? null
              : last.bowlerId;
        }
      });
    } on ApiException {
      // Cold start while offline — fine, the scorer can still pick players
      // manually and the over-history strip just stays empty until synced.
    }
  }

  bool _canScore() =>
      !_submitting && _strikerId != null && _nonStrikerId != null && _bowlerId != null;

  PendingDelivery _buildPendingDelivery(
    String matchId,
    int inningsNumber,
    int runs, {
    String? wicketKind,
    String? playerOutId,
    String? fielderId,
  }) => PendingDelivery(
    matchId: matchId,
    clientEventId: _clientEventId,
    inningsNumber: inningsNumber,
    strikerId: _strikerId!,
    nonStrikerId: _nonStrikerId!,
    bowlerId: _bowlerId!,
    runsOffBat:
        _extraMode == _ExtraMode.legal || _extraMode == _ExtraMode.noBall
            ? runs
            : 0,
    extraWides: _extraMode == _ExtraMode.wide ? _wideRuns + runs : 0,
    extraNoballs: _extraMode == _ExtraMode.noBall ? _noballRuns : 0,
    extraByes: _extraMode == _ExtraMode.bye ? runs : 0,
    extraLegbyes: _extraMode == _ExtraMode.legBye ? runs : 0,
    extraPenalty: 0,
    wicketKind: wicketKind,
    playerOutId: playerOutId,
    fielderId: fielderId,
    commentary: null,
    queuedAt: DateTime.now(),
  );

  Delivery _syntheticDelivery(PendingDelivery p) => Delivery(
    id: '',
    overNumber: 0,
    // Unknown offline (server computes it) — sentinel so isEndOfOver never
    // fires on a queued ball; worst case the scorer re-picks the bowler
    // manually once a new over has actually started while still offline.
    ballInOver: -1,
    sequence: 0,
    strikerId: p.strikerId,
    nonStrikerId: p.nonStrikerId,
    bowlerId: p.bowlerId,
    runsOffBat: p.runsOffBat,
    extraWides: p.extraWides,
    extraNoballs: p.extraNoballs,
    extraByes: p.extraByes,
    extraLegbyes: p.extraLegbyes,
    extraPenalty: p.extraPenalty,
    isLegalDelivery: p.extraWides == 0 && p.extraNoballs == 0,
    isFreeHit: false,
    wicketKind: p.wicketKind,
    playerOutId: p.playerOutId,
    fielderId: p.fielderId,
  );

  Future<bool> _submitToServer(PendingDelivery d) async {
    final result = await ref
        .read(apiClientProvider)
        .postDelivery(
          d.matchId,
          clientEventId: d.clientEventId,
          inningsNumber: d.inningsNumber,
          strikerId: d.strikerId,
          nonStrikerId: d.nonStrikerId,
          bowlerId: d.bowlerId,
          runsOffBat: d.runsOffBat,
          extraWides: d.extraWides,
          extraNoballs: d.extraNoballs,
          extraByes: d.extraByes,
          extraLegbyes: d.extraLegbyes,
          extraPenalty: d.extraPenalty,
          wicketKind: d.wicketKind,
          playerOutId: d.playerOutId,
          fielderId: d.fielderId,
          commentary: d.commentary,
        );
    if (mounted) {
      setState(() => _recentDeliveries = [..._recentDeliveries, result.delivery]);
    }
    return result.inningsComplete == true;
  }

  /// Retries whatever's queued for [matchId], oldest first, stopping the
  /// moment one fails again (no network) so the rest stay queued in order.
  /// A real (non-network) error on a queued item — e.g. the innings closed
  /// under it while offline — halts the flush too rather than silently
  /// dropping scored data; that needs a human to look at it.
  Future<void> _flushQueue(String matchId, {bool silent = false}) async {
    final queue = ref.read(pendingDeliveryQueueProvider);
    var pending = await queue.all(matchId);
    if (!mounted) return;
    setState(() {
      _pendingCount = pending.length;
      if (!silent) _syncing = true;
    });
    if (pending.isEmpty) {
      if (!silent && mounted) setState(() => _syncing = false);
      return;
    }

    var syncedAny = false;
    while (pending.isNotEmpty) {
      try {
        await _submitToServer(pending.first);
        await queue.removeFirst(matchId);
        syncedAny = true;
        pending = pending.skip(1).toList();
        if (mounted) setState(() => _pendingCount = pending.length);
      } on ApiException catch (e) {
        if (mounted && !silent) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                e.statusCode == null
                    ? 'Still offline — will keep retrying.'
                    : 'Sync stopped: ${e.message}',
              ),
            ),
          );
        }
        break;
      }
    }

    if (mounted) setState(() => _syncing = false);
    if (syncedAny) ref.invalidate(matchProvider(matchId));
  }

  Future<void> _scoreBall(
    String matchId,
    int inningsNumber,
    int runs, {
    String? wicketKind,
    String? playerOutId,
    String? fielderId,
    String? incomingBatterId,
  }) async {
    if (!_canScore()) return;
    setState(() => _submitting = true);
    final delivery = _buildPendingDelivery(
      matchId,
      inningsNumber,
      runs,
      wicketKind: wicketKind,
      playerOutId: playerOutId,
      fielderId: fielderId,
    );
    try {
      // Never let a fresh ball jump ahead of a backlog — flush first so
      // delivery order to the server always matches the order they were
      // actually scored in.
      if (_pendingCount > 0) {
        await _flushQueue(matchId, silent: true);
      }

      bool inningsComplete = false;
      Delivery deliveryForRotation;
      if (_pendingCount > 0) {
        final queue = ref.read(pendingDeliveryQueueProvider);
        await queue.enqueue(delivery);
        if (mounted) setState(() => _pendingCount++);
        deliveryForRotation = _syntheticDelivery(delivery);
      } else {
        try {
          inningsComplete = await _submitToServer(delivery);
          deliveryForRotation = _recentDeliveries.last;
          ref.invalidate(matchProvider(matchId));
        } on ApiException catch (e) {
          if (e.statusCode != null) {
            rethrow; // a real server error, not a dropped connection
          }
          final queue = ref.read(pendingDeliveryQueueProvider);
          await queue.enqueue(delivery);
          if (mounted) setState(() => _pendingCount++);
          deliveryForRotation = _syntheticDelivery(delivery);
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  "Offline — ball queued, it'll sync automatically once you're back online.",
                ),
              ),
            );
          }
        }
      }

      if (!mounted) return;
      if (inningsComplete) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Innings complete')));
      }
      setState(() {
        if (deliveryForRotation.wicketKind == null) {
          final next = rotation.computeNextStrikers(
            deliveryForRotation,
            wideRuns: _wideRuns,
            ballsPerOver: _ballsPerOver,
          );
          _strikerId = next.strikerId;
          _nonStrikerId = next.nonStrikerId;
        } else if (incomingBatterId != null) {
          final next = rotation.computeNextStrikers(
            deliveryForRotation,
            wideRuns: _wideRuns,
            ballsPerOver: _ballsPerOver,
            incomingBatterId: incomingBatterId,
          );
          _strikerId = next.strikerId;
          _nonStrikerId = next.nonStrikerId;
        }
        if (rotation.isEndOfOver(deliveryForRotation, ballsPerOver: _ballsPerOver)) {
          _bowlerId = null;
        }
        _extraMode = _ExtraMode.legal;
        _clientEventId = generateUuidV4();
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _undo(String matchId, int inningsNumber) async {
    setState(() => _undoing = true);
    try {
      if (_pendingCount > 0) {
        // The most recent ball never reached the server — pop it locally,
        // there's nothing to void.
        final queue = ref.read(pendingDeliveryQueueProvider);
        final all = await queue.all(matchId);
        if (all.isEmpty) {
          if (mounted) setState(() => _pendingCount = 0);
          return;
        }
        final removed = all.last;
        await queue.removeLast(matchId);
        if (!mounted) return;
        setState(() {
          _pendingCount--;
          _strikerId = removed.strikerId;
          _nonStrikerId = removed.nonStrikerId;
          _bowlerId = removed.bowlerId;
        });
        return;
      }

      if (_recentDeliveries.isEmpty) return;
      final last = _recentDeliveries.last;
      await ref
          .read(apiClientProvider)
          .voidDelivery(matchId, last.id, reason: 'Scorer undo');
      if (!mounted) return;
      setState(() {
        _recentDeliveries = _recentDeliveries.sublist(0, _recentDeliveries.length - 1);
        _strikerId = last.strikerId;
        _nonStrikerId = last.nonStrikerId;
        _bowlerId = last.bowlerId;
      });
      ref.invalidate(matchProvider(matchId));
      if (_recentDeliveries.isEmpty) {
        // Undid the over's first ball — reload the previous over's tail so
        // the history strip and any further undo stay correct.
        await _seedFromServer(matchId, inningsNumber, _ballsPerOver);
      }
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Last ball undone')));
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _undoing = false);
    }
  }

  void _showMoreRunsSheet(String matchId, int inningsNumber) {
    if (!_canScore()) return;
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [5, 7]
              .map(
                (n) => ListTile(
                  title: Text('$n runs'),
                  onTap: () {
                    Navigator.of(context).pop();
                    _scoreBall(matchId, inningsNumber, n);
                  },
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  Future<void> _showWicketDialog(
    BuildContext context,
    String matchId,
    int inningsNumber,
    List<SquadPlayer> battingSquad,
    List<SquadPlayer> bowlingSquad,
    bool willBeAllOut,
  ) async {
    final outIds = {
      for (final b in ref
              .read(matchProvider(matchId))
              .valueOrNull
              ?.innings
              .firstWhere((i) => i.inningsNumber == inningsNumber)
              .batting ??
          const [])
        if (b.isOut) b.id,
    };
    final availableIncoming = battingSquad
        .where(
          (p) =>
              p.id != _strikerId && p.id != _nonStrikerId && !outIds.contains(p.id),
        )
        .toList();

    var kind = 'bowled';
    var playerOutId = _strikerId;
    var runs = 0;
    String? fielderId;
    String? incomingBatterId =
        availableIncoming.isEmpty ? null : availableIncoming.first.id;

    await showDialog<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Wicket'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: kind,
                  decoration: const InputDecoration(labelText: 'Dismissal'),
                  items: _dismissalKinds
                      .map((k) => DropdownMenuItem(value: k, child: Text(k)))
                      .toList(),
                  onChanged: (v) => setDialogState(() => kind = v!),
                ),
                const SizedBox(height: 12),
                Text('Player out', style: Theme.of(context).textTheme.labelLarge),
                Row(
                  children: [
                    Expanded(
                      child: RadioListTile<String?>(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Striker'),
                        value: _strikerId,
                        // ignore: deprecated_member_use
                        groupValue: playerOutId,
                        // ignore: deprecated_member_use
                        onChanged: (v) => setDialogState(() => playerOutId = v),
                      ),
                    ),
                    Expanded(
                      child: RadioListTile<String?>(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Non-striker'),
                        value: _nonStrikerId,
                        // ignore: deprecated_member_use
                        groupValue: playerOutId,
                        // ignore: deprecated_member_use
                        onChanged: (v) => setDialogState(() => playerOutId = v),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text('Runs completed', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  children: [0, 1, 2, 3]
                      .map(
                        (n) => ChoiceChip(
                          label: Text('$n'),
                          selected: runs == n,
                          onSelected: (_) => setDialogState(() => runs = n),
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: 12),
                _PlayerDropdown(
                  label: 'Fielder (optional)',
                  players: bowlingSquad,
                  value: fielderId,
                  onChanged: (v) => setDialogState(() => fielderId = v),
                  allowNone: true,
                ),
                if (!willBeAllOut) ...[
                  const SizedBox(height: 12),
                  _PlayerDropdown(
                    label: 'Incoming batter',
                    players: availableIncoming,
                    value: incomingBatterId,
                    onChanged: (v) => setDialogState(() => incomingBatterId = v),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: playerOutId == null ||
                      (!willBeAllOut && incomingBatterId == null)
                  ? null
                  : () {
                      Navigator.of(context).pop();
                      _scoreBall(
                        matchId,
                        inningsNumber,
                        runs,
                        wicketKind: kind,
                        playerOutId: playerOutId,
                        fielderId: fielderId,
                        incomingBatterId: willBeAllOut ? null : incomingBatterId,
                      );
                    },
              child: const Text('Confirm'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _closeInnings(String matchId, int inningsNumber) async {
    try {
      await ref.read(apiClientProvider).closeInnings(matchId, inningsNumber);
      ref.invalidate(matchProvider(matchId));
      ref.invalidate(liveMatchesProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Innings closed')));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}

class _BatsmanCard extends StatelessWidget {
  const _BatsmanCard({
    required this.name,
    required this.line,
    required this.onStrike,
  });

  final String name;
  final String line;
  final bool onStrike;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        border: Border.all(
          color: onStrike ? scheme.primary : scheme.outlineVariant,
          width: onStrike ? 2 : 1,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          if (onStrike) ...[
            Icon(Icons.circle, size: 8, color: scheme.primary),
            const SizedBox(width: 6),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: onStrike ? FontWeight.bold : FontWeight.normal,
                      ),
                ),
                Text(line, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ThisOverStrip extends StatelessWidget {
  const _ThisOverStrip({required this.deliveries});

  final List<Delivery> deliveries;

  String _label(Delivery d) {
    if (d.wicketKind != null) return 'W';
    if (d.extraWides > 0) return 'wd';
    if (d.extraNoballs > 0) return 'nb';
    if (d.extraByes > 0) return 'b${d.extraByes}';
    if (d.extraLegbyes > 0) return 'lb${d.extraLegbyes}';
    return '${d.runsOffBat}';
  }

  @override
  Widget build(BuildContext context) {
    if (deliveries.isEmpty) {
      return Text(
        'This over: —',
        style: Theme.of(context).textTheme.bodySmall,
      );
    }
    final scheme = Theme.of(context).colorScheme;
    return SizedBox(
      height: 32,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: deliveries.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, i) {
          final d = deliveries[i];
          final isLast = i == deliveries.length - 1;
          final isWicket = d.wicketKind != null;
          return CircleAvatar(
            radius: 15,
            backgroundColor: isWicket
                ? scheme.error
                : isLast
                    ? scheme.primary
                    : scheme.surfaceContainerHighest,
            child: Text(
              _label(d),
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: isWicket || isLast
                    ? scheme.onPrimary
                    : scheme.onSurfaceVariant,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _Keypad extends StatelessWidget {
  const _Keypad({
    required this.enabled,
    required this.extraMode,
    required this.onExtraModeToggled,
    required this.onRuns,
    required this.onMoreRuns,
    required this.onUndo,
    required this.undoing,
    required this.onOut,
  });

  final bool enabled;
  final _ExtraMode extraMode;
  final ValueChanged<_ExtraMode> onExtraModeToggled;
  final ValueChanged<int> onRuns;
  final VoidCallback onMoreRuns;
  final VoidCallback? onUndo;
  final bool undoing;
  final VoidCallback? onOut;

  Widget _runButton(BuildContext context, int runs, {String? label}) {
    return OutlinedButton(
      onPressed: enabled ? () => onRuns(runs) : null,
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 18),
      ),
      child: Text(label ?? '$runs'),
    );
  }

  Widget _extraChip(BuildContext context, _ExtraMode mode, String label) {
    return ChoiceChip(
      label: Text(label),
      selected: extraMode == mode,
      onSelected: enabled ? (_) => onExtraModeToggled(mode) : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          flex: 3,
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(child: _runButton(context, 0)),
                  const SizedBox(width: 8),
                  Expanded(child: _runButton(context, 1)),
                  const SizedBox(width: 8),
                  Expanded(child: _runButton(context, 2)),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: _runButton(context, 3)),
                  const SizedBox(width: 8),
                  Expanded(child: _runButton(context, 4, label: 'FOUR')),
                  const SizedBox(width: 8),
                  Expanded(child: _runButton(context, 6, label: 'SIX')),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _extraChip(context, _ExtraMode.wide, 'WD'),
                  _extraChip(context, _ExtraMode.noBall, 'NB'),
                  _extraChip(context, _ExtraMode.bye, 'BYE'),
                  _extraChip(context, _ExtraMode.legBye, 'LB'),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: 1,
          child: Column(
            children: [
              OutlinedButton(
                onPressed: onUndo,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: undoing
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('UNDO'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: enabled ? onMoreRuns : null,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: const Text('5, 7'),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: onOut,
                style: FilledButton.styleFrom(
                  backgroundColor: Theme.of(context).colorScheme.error,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: const Text('OUT'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PendingSyncBanner extends StatelessWidget {
  const _PendingSyncBanner({
    required this.count,
    required this.syncing,
    required this.onSyncNow,
  });

  final int count;
  final bool syncing;
  final VoidCallback onSyncNow;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off, size: 18, color: scheme.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              count == 1
                  ? '1 ball waiting to sync — the score above is not up to date.'
                  : '$count balls waiting to sync — the score above is not up to date.',
              style: TextStyle(color: scheme.onErrorContainer),
            ),
          ),
          TextButton(
            onPressed: syncing ? null : onSyncNow,
            child: syncing
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Sync now'),
          ),
        ],
      ),
    );
  }
}

class _RateLine extends StatelessWidget {
  const _RateLine({
    required this.innings,
    required this.totals,
    required this.ballsPerOver,
  });

  final InningsDetail innings;
  final InningsTotals totals;
  final int ballsPerOver;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    final crr = runRate(totals.runs, totals.legalBalls, ballsPerOver);
    final parts = ['CRR ${crr.toStringAsFixed(2)}'];

    final maxOvers = innings.maxOvers;
    if (innings.target != null) {
      final runsNeeded = innings.target! - totals.runs;
      if (maxOvers == null) {
        // Test match: unlimited overs, so there's no "off N balls" to show.
        if (runsNeeded > 0) parts.add('need $runsNeeded');
      } else {
        final rrr = requiredRunRate(
          target: innings.target!,
          runsSoFar: totals.runs,
          legalBallsBowled: totals.legalBalls,
          maxOvers: maxOvers,
          ballsPerOver: ballsPerOver,
        );
        final remaining = ballsRemaining(
          maxOvers: maxOvers,
          ballsPerOver: ballsPerOver,
          legalBallsBowled: totals.legalBalls,
        );
        if (rrr != null && runsNeeded > 0) {
          parts.add(
            'RRR ${rrr.toStringAsFixed(2)} · need $runsNeeded off $remaining',
          );
        }
      }
    }

    return Text(parts.join(' · '), style: style);
  }
}

class _PlayerDropdown extends StatelessWidget {
  const _PlayerDropdown({
    required this.label,
    required this.players,
    required this.value,
    required this.onChanged,
    this.allowNone = false,
  });

  final String label;
  final List<SquadPlayer> players;
  final String? value;
  final ValueChanged<String?> onChanged;
  final bool allowNone;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        if (allowNone)
          const DropdownMenuItem<String>(value: null, child: Text('None')),
        ...players.map(
          (p) => DropdownMenuItem(
            value: p.id,
            child: Text(p.name, overflow: TextOverflow.ellipsis),
          ),
        ),
      ],
      onChanged: onChanged,
    );
  }
}

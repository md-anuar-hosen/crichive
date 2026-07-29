import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/match_detail.dart';
import '../models/player.dart';
import '../state/providers.dart';
import '../utils/cricket_math.dart';
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

enum _BallMode { legal, wide, noBall, bye, legBye }

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

  _BallMode _mode = _BallMode.legal;
  int _runs = 0;
  bool _isWicket = false;
  String _wicketKind = 'bowled';
  String? _playerOutId;
  String? _fielderId;

  bool _submitting = false;
  String _clientEventId = generateUuidV4();

  @override
  Widget build(BuildContext context) {
    final match = ref.watch(matchProvider(widget.matchId));
    final ballsPerOver = match.whenOrNull(
          data: (m) => ref.watch(tournamentProvider(m.tournamentSlug)).valueOrNull?.rules?.ballsPerOver,
        ) ??
        6;

    return Scaffold(
      appBar: AppBar(title: const Text('Score')),
      body: AsyncValueView(
        value: match,
        onRetry: () => ref.invalidate(matchProvider(widget.matchId)),
        data: (context, m) {
          final openInnings = m.innings.where((i) => i.closedAt == null).toList();
          if (openInnings.isEmpty) {
            return const EmptyState(
              message: 'No open innings. Record the toss first, or start the next innings by closing the current one.',
              icon: Icons.sports_cricket_outlined,
            );
          }
          final innings = openInnings.first;
          final battingTeam = innings.battingTeamId == m.teamA.id ? m.teamA : m.teamB;
          final bowlingTeam = innings.battingTeamId == m.teamA.id ? m.teamB : m.teamA;

          final battingSquad = ref.watch(squadProvider((teamId: battingTeam.id, tournamentSlug: m.tournamentSlug)));
          final bowlingSquad = ref.watch(squadProvider((teamId: bowlingTeam.id, tournamentSlug: m.tournamentSlug)));

          return AsyncValueView(
            value: battingSquad,
            data: (context, batting) => AsyncValueView(
              value: bowlingSquad,
              data: (context, bowling) => _buildForm(context, m, innings, batting, bowling, ballsPerOver),
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
  ) {
    final totals = innings.totals;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          totals == null ? '0/0 (0.0)' : '${totals.runs}/${totals.wickets} (${totals.oversDisplay(ballsPerOver)})',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        Text('Innings ${innings.inningsNumber}', style: Theme.of(context).textTheme.bodySmall),
        if (totals != null) _RateLine(innings: innings, totals: totals, ballsPerOver: ballsPerOver),
        const SizedBox(height: 16),
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
        const SizedBox(height: 20),
        Text('Ball type', style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(label: const Text('Legal'), selected: _mode == _BallMode.legal, onSelected: (_) => setState(() => _mode = _BallMode.legal)),
            ChoiceChip(label: const Text('Wide'), selected: _mode == _BallMode.wide, onSelected: (_) => setState(() => _mode = _BallMode.wide)),
            ChoiceChip(label: const Text('No ball'), selected: _mode == _BallMode.noBall, onSelected: (_) => setState(() => _mode = _BallMode.noBall)),
            ChoiceChip(label: const Text('Bye'), selected: _mode == _BallMode.bye, onSelected: (_) => setState(() => _mode = _BallMode.bye)),
            ChoiceChip(label: const Text('Leg bye'), selected: _mode == _BallMode.legBye, onSelected: (_) => setState(() => _mode = _BallMode.legBye)),
          ],
        ),
        const SizedBox(height: 16),
        Text(_runsLabel(), style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [0, 1, 2, 3, 4, 5, 6]
              .map((n) => ChoiceChip(label: Text('$n'), selected: _runs == n, onSelected: (_) => setState(() => _runs = n)))
              .toList(),
        ),
        const SizedBox(height: 16),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Wicket'),
          value: _isWicket,
          onChanged: (v) => setState(() {
            _isWicket = v;
            _playerOutId ??= _strikerId;
          }),
        ),
        if (_isWicket) ...[
          DropdownButtonFormField<String>(
            initialValue: _wicketKind,
            decoration: const InputDecoration(labelText: 'Dismissal'),
            items: _dismissalKinds.map((k) => DropdownMenuItem(value: k, child: Text(k))).toList(),
            onChanged: (v) => setState(() => _wicketKind = v!),
          ),
          const SizedBox(height: 8),
          _PlayerDropdown(
            label: 'Player out',
            players: battingSquad,
            value: _playerOutId,
            onChanged: (v) => setState(() => _playerOutId = v),
          ),
          const SizedBox(height: 8),
          _PlayerDropdown(
            label: 'Fielder (optional)',
            players: bowlingSquad,
            value: _fielderId,
            onChanged: (v) => setState(() => _fielderId = v),
            allowNone: true,
          ),
        ],
        const SizedBox(height: 24),
        FilledButton(
          onPressed: _canSubmit() ? () => _submit(match.id, innings.inningsNumber) : null,
          child: _submitting
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Submit ball'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => _closeInnings(match.id, innings.inningsNumber),
          child: const Text('Close this innings'),
        ),
      ],
    );
  }

  String _runsLabel() {
    switch (_mode) {
      case _BallMode.legal:
        return 'Runs off the bat';
      case _BallMode.wide:
        return 'Runs run (in addition to the wide)';
      case _BallMode.noBall:
        return 'Runs off the bat';
      case _BallMode.bye:
        return 'Byes';
      case _BallMode.legBye:
        return 'Leg byes';
    }
  }

  bool _canSubmit() {
    if (_submitting || _strikerId == null || _nonStrikerId == null || _bowlerId == null) return false;
    if (_isWicket && _playerOutId == null) return false;
    return true;
  }

  Future<void> _submit(String matchId, int inningsNumber) async {
    setState(() => _submitting = true);
    try {
      final result = await ref.read(apiClientProvider).postDelivery(
            matchId,
            clientEventId: _clientEventId,
            inningsNumber: inningsNumber,
            strikerId: _strikerId!,
            nonStrikerId: _nonStrikerId!,
            bowlerId: _bowlerId!,
            runsOffBat: _mode == _BallMode.legal || _mode == _BallMode.noBall ? _runs : 0,
            extraWides: _mode == _BallMode.wide ? 1 + _runs : 0,
            extraNoballs: _mode == _BallMode.noBall ? 1 : 0,
            extraByes: _mode == _BallMode.bye ? _runs : 0,
            extraLegbyes: _mode == _BallMode.legBye ? _runs : 0,
            wicketKind: _isWicket ? _wicketKind : null,
            playerOutId: _isWicket ? _playerOutId : null,
            fielderId: _isWicket ? _fielderId : null,
          );
      ref.invalidate(matchProvider(matchId));

      if (!mounted) return;
      if (result.inningsComplete == true) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Innings complete: ${result.completionReason ?? ''}')));
      }
      setState(() {
        _mode = _BallMode.legal;
        _runs = 0;
        _isWicket = false;
        _playerOutId = null;
        _fielderId = null;
        _clientEventId = generateUuidV4();
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _closeInnings(String matchId, int inningsNumber) async {
    try {
      await ref.read(apiClientProvider).closeInnings(matchId, inningsNumber);
      ref.invalidate(matchProvider(matchId));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Innings closed')));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}

class _RateLine extends StatelessWidget {
  const _RateLine({required this.innings, required this.totals, required this.ballsPerOver});

  final InningsDetail innings;
  final InningsTotals totals;
  final int ballsPerOver;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    final crr = runRate(totals.runs, totals.legalBalls, ballsPerOver);
    final parts = ['CRR ${crr.toStringAsFixed(2)}'];

    if (innings.target != null) {
      final rrr = requiredRunRate(
        target: innings.target!,
        runsSoFar: totals.runs,
        legalBallsBowled: totals.legalBalls,
        maxOvers: innings.maxOvers,
        ballsPerOver: ballsPerOver,
      );
      final runsNeeded = innings.target! - totals.runs;
      final remaining = ballsRemaining(maxOvers: innings.maxOvers, ballsPerOver: ballsPerOver, legalBallsBowled: totals.legalBalls);
      if (rrr != null && runsNeeded > 0) {
        parts.add('RRR ${rrr.toStringAsFixed(2)} · need $runsNeeded off $remaining');
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
      decoration: InputDecoration(labelText: label),
      items: [
        if (allowNone) const DropdownMenuItem<String>(value: null, child: Text('None')),
        ...players.map((p) => DropdownMenuItem(value: p.id, child: Text(p.name))),
      ],
      onChanged: onChanged,
    );
  }
}

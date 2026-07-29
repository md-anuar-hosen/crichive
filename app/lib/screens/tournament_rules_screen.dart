import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/tournament.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

class TournamentRulesScreen extends ConsumerWidget {
  const TournamentRulesScreen({super.key, required this.tournamentSlug});

  final String tournamentSlug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tournament = ref.watch(tournamentProvider(tournamentSlug));

    return Scaffold(
      appBar: AppBar(title: const Text('Tournament rules')),
      body: AsyncValueView(
        value: tournament,
        onRetry: () => ref.invalidate(tournamentProvider(tournamentSlug)),
        data: (context, t) => t.rules == null
            ? const EmptyState(message: 'This tournament has no rules configured yet.')
            : _RulesForm(tournamentSlug: tournamentSlug, rules: t.rules!),
      ),
    );
  }
}

class _RulesForm extends ConsumerStatefulWidget {
  const _RulesForm({required this.tournamentSlug, required this.rules});
  final String tournamentSlug;
  final TournamentRules rules;

  @override
  ConsumerState<_RulesForm> createState() => _RulesFormState();
}

class _RulesFormState extends ConsumerState<_RulesForm> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _controllers;
  late bool _freeHitAfterNoball;
  late bool _bonusPointEnabled;
  late bool _superOverOnTie;
  late bool _dlsEnabled;
  bool _saving = false;

  static const _intFields = {
    'overs_per_innings': 'Overs per innings',
    'balls_per_over': 'Balls per over',
    'max_overs_per_bowler': 'Max overs per bowler',
    'powerplay_overs': 'Powerplay overs',
    'players_per_side': 'Players per side',
    'wide_runs': 'Wide runs',
    'noball_runs': 'No-ball runs',
    'points_win': 'Points — win',
    'points_tie': 'Points — tie',
    'points_no_result': 'Points — no result',
    'points_loss': 'Points — loss',
  };

  @override
  void initState() {
    super.initState();
    final r = widget.rules;
    _controllers = {
      'overs_per_innings': TextEditingController(text: '${r.oversPerInnings}'),
      'balls_per_over': TextEditingController(text: '${r.ballsPerOver}'),
      'max_overs_per_bowler': TextEditingController(text: '${r.maxOversPerBowler}'),
      'powerplay_overs': TextEditingController(text: '${r.powerplayOvers}'),
      'players_per_side': TextEditingController(text: '${r.playersPerSide}'),
      'wide_runs': TextEditingController(text: '${r.wideRuns}'),
      'noball_runs': TextEditingController(text: '${r.noballRuns}'),
      'points_win': TextEditingController(text: '${r.pointsWin}'),
      'points_tie': TextEditingController(text: '${r.pointsTie}'),
      'points_no_result': TextEditingController(text: '${r.pointsNoResult}'),
      'points_loss': TextEditingController(text: '${r.pointsLoss}'),
    };
    _freeHitAfterNoball = r.freeHitAfterNoball;
    _bonusPointEnabled = r.bonusPointEnabled;
    _superOverOnTie = r.superOverOnTie;
    _dlsEnabled = r.dlsEnabled;
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final entry in _intFields.entries) ...[
            TextFormField(
              controller: _controllers[entry.key],
              decoration: InputDecoration(labelText: entry.value),
              keyboardType: TextInputType.number,
              validator: (v) => (v == null || int.tryParse(v) == null) ? 'Enter a whole number' : null,
            ),
            const SizedBox(height: 12),
          ],
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Free hit after no-ball'),
            value: _freeHitAfterNoball,
            onChanged: (v) => setState(() => _freeHitAfterNoball = v),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Bonus point enabled'),
            value: _bonusPointEnabled,
            onChanged: (v) => setState(() => _bonusPointEnabled = v),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Super over on tie'),
            value: _superOverOnTie,
            onChanged: (v) => setState(() => _superOverOnTie = v),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('DLS enabled'),
            value: _dlsEnabled,
            onChanged: (v) => setState(() => _dlsEnabled = v),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Save rules'),
          ),
        ],
      ),
    );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final fields = <String, dynamic>{
        for (final key in _intFields.keys) key: int.parse(_controllers[key]!.text),
        'free_hit_after_noball': _freeHitAfterNoball,
        'bonus_point_enabled': _bonusPointEnabled,
        'super_over_on_tie': _superOverOnTie,
        'dls_enabled': _dlsEnabled,
      };
      await ref.read(apiClientProvider).updateTournamentRules(widget.tournamentSlug, fields);
      ref.invalidate(tournamentProvider(widget.tournamentSlug));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Rules saved')));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

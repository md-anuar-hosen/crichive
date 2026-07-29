import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

class TossScreen extends ConsumerStatefulWidget {
  const TossScreen({super.key, required this.matchId});

  final String matchId;

  @override
  ConsumerState<TossScreen> createState() => _TossScreenState();
}

class _TossScreenState extends ConsumerState<TossScreen> {
  String? _winnerTeamId;
  String _decision = 'bat';
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    final match = ref.watch(matchProvider(widget.matchId));

    return Scaffold(
      appBar: AppBar(title: const Text('Record toss')),
      body: AsyncValueView(
        value: match,
        onRetry: () => ref.invalidate(matchProvider(widget.matchId)),
        data: (context, m) {
          _winnerTeamId ??= m.teamA.id;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('${m.teamA.name} vs ${m.teamB.name}', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 24),
              Text('Toss winner', style: Theme.of(context).textTheme.labelLarge),
              RadioGroup<String>(
                groupValue: _winnerTeamId,
                onChanged: (v) => setState(() => _winnerTeamId = v),
                child: Column(
                  children: [
                    RadioListTile<String>(title: Text(m.teamA.name), value: m.teamA.id),
                    RadioListTile<String>(title: Text(m.teamB.name), value: m.teamB.id),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text('Decision', style: Theme.of(context).textTheme.labelLarge),
              RadioGroup<String>(
                groupValue: _decision,
                onChanged: (v) => setState(() => _decision = v!),
                child: const Column(
                  children: [
                    RadioListTile<String>(title: Text('Bat'), value: 'bat'),
                    RadioListTile<String>(title: Text('Bowl'), value: 'bowl'),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _submitting ? null : () => _submit(m.id),
                child: _submitting
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Save toss'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _submit(String matchId) async {
    if (_winnerTeamId == null) return;
    setState(() => _submitting = true);
    try {
      await ref
          .read(apiClientProvider)
          .recordToss(matchId, winnerTeamId: _winnerTeamId!, decision: _decision);
      ref.invalidate(matchProvider(matchId));
      if (!mounted) return;
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}

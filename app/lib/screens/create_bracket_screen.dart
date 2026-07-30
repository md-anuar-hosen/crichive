import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/team.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

/// Organiser-only in practice (backend 403s anyone else). Teams are tapped
/// in seed order — seed 1 first — matching the standard-bracket-seeding
/// convention the backend uses (seed 1 vs seed N, etc.), so the order
/// teams are selected in here is meaningful, not incidental.
class CreateBracketScreen extends ConsumerStatefulWidget {
  const CreateBracketScreen({super.key, required this.tournamentSlug});

  final String tournamentSlug;

  @override
  ConsumerState<CreateBracketScreen> createState() => _CreateBracketScreenState();
}

class _CreateBracketScreenState extends ConsumerState<CreateBracketScreen> {
  final _nameController = TextEditingController();
  final List<Team> _seeded = [];
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  void _toggle(Team team) {
    setState(() {
      if (_seeded.any((t) => t.id == team.id)) {
        _seeded.removeWhere((t) => t.id == team.id);
      } else {
        _seeded.add(team);
      }
    });
  }

  Future<void> _submit() async {
    if (_seeded.length < 2) {
      setState(() => _error = 'Select at least 2 teams.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).createKnockoutBracket(
            widget.tournamentSlug,
            name: _nameController.text.trim(),
            teamIdsBySeed: _seeded.map((t) => t.id).toList(),
          );
      ref.invalidate(knockoutBracketProvider(widget.tournamentSlug));
      if (!mounted) return;
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final teams = ref.watch(teamsProvider(widget.tournamentSlug));

    return Scaffold(
      appBar: AppBar(title: const Text('Create knockout bracket')),
      body: AsyncValueView(
        value: teams,
        onRetry: () => ref.invalidate(teamsProvider(widget.tournamentSlug)),
        data: (context, page) {
          if (page.data.isEmpty) {
            return const EmptyState(message: 'Add teams to the tournament before generating a bracket.');
          }
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_error != null) ...[
                      Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      const SizedBox(height: 8),
                    ],
                    TextField(
                      controller: _nameController,
                      decoration: const InputDecoration(labelText: 'Stage name (optional, defaults to "Knockout Stage")'),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Tap teams in seed order — the first team tapped is the top seed. '
                      "If the count isn't a power of two, the top seeds get a bye into round 2.",
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.separated(
                  itemCount: page.data.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final team = page.data[index];
                    final seedIndex = _seeded.indexWhere((t) => t.id == team.id);
                    return ListTile(
                      leading: seedIndex == -1
                          ? const Icon(Icons.circle_outlined)
                          : CircleAvatar(radius: 12, child: Text('${seedIndex + 1}', style: const TextStyle(fontSize: 12))),
                      title: Text(team.name),
                      onTap: () => _toggle(team),
                      selected: seedIndex != -1,
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text('Create bracket with ${_seeded.length} team${_seeded.length == 1 ? '' : 's'}'),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

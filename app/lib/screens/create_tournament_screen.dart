import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/api_exception.dart';
import '../state/providers.dart';

class CreateTournamentScreen extends ConsumerStatefulWidget {
  const CreateTournamentScreen({super.key});

  @override
  ConsumerState<CreateTournamentScreen> createState() => _CreateTournamentScreenState();
}

class _CreateTournamentScreenState extends ConsumerState<CreateTournamentScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _slug = TextEditingController();
  final _seasonYear = TextEditingController(text: DateTime.now().year.toString());
  final _oversPerInnings = TextEditingController(text: '20');
  final _maxOversPerBowler = TextEditingController(text: '4');
  final _organizerOrg = TextEditingController();
  String _ball = 'leather';

  var _submitting = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _slug.dispose();
    _seasonYear.dispose();
    _oversPerInnings.dispose();
    _maxOversPerBowler.dispose();
    _organizerOrg.dispose();
    super.dispose();
  }

  String _slugify(String name) => name
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final tournament = await ref.read(apiClientProvider).createTournament(
            name: _name.text.trim(),
            slug: _slug.text.trim().isEmpty ? _slugify(_name.text) : _slug.text.trim(),
            seasonYear: int.parse(_seasonYear.text.trim()),
            oversPerInnings: int.parse(_oversPerInnings.text.trim()),
            maxOversPerBowler: int.parse(_maxOversPerBowler.text.trim()),
            organizerOrg: _organizerOrg.text.trim().isEmpty ? null : _organizerOrg.text.trim(),
            ball: _ball,
          );
      ref.invalidate(tournamentsProvider);
      if (!mounted) return;

      if (tournament.isApproved) {
        context.go('/tournaments/${tournament.slug}');
      } else {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Tournament created — it will appear once a platform admin approves it.'),
            duration: Duration(seconds: 5),
          ),
        );
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(platformSettingsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Create tournament')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              settings.when(
                data: (s) => s.isOpen
                    ? const SizedBox.shrink()
                    : Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          'New tournaments currently need platform-admin approval before they go live. '
                          "You'll be its organiser immediately and can set it up while you wait.",
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
                        ),
                      ),
                loading: () => const SizedBox.shrink(),
                error: (_, _) => const SizedBox.shrink(),
              ),
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                const SizedBox(height: 12),
              ],
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Tournament name'),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _slug,
                decoration: const InputDecoration(labelText: 'URL slug (optional — derived from the name if left blank)'),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return null;
                  return RegExp(r'^[a-z0-9-]+$').hasMatch(v.trim()) ? null : 'Lowercase letters, numbers and hyphens only';
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _seasonYear,
                decoration: const InputDecoration(labelText: 'Season year'),
                keyboardType: TextInputType.number,
                validator: (v) => int.tryParse(v ?? '') == null ? 'Enter a year' : null,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _oversPerInnings,
                      decoration: const InputDecoration(labelText: 'Overs per innings'),
                      keyboardType: TextInputType.number,
                      validator: (v) => int.tryParse(v ?? '') == null ? 'Required' : null,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextFormField(
                      controller: _maxOversPerBowler,
                      decoration: const InputDecoration(labelText: "Bowler's over quota"),
                      keyboardType: TextInputType.number,
                      validator: (v) {
                        final quota = int.tryParse(v ?? '');
                        final overs = int.tryParse(_oversPerInnings.text);
                        if (quota == null) return 'Required';
                        if (overs != null && quota > overs) return 'Cannot exceed overs per innings';
                        return null;
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _organizerOrg,
                decoration: const InputDecoration(labelText: 'Organising club/association (optional)'),
              ),
              const SizedBox(height: 16),
              Text('Ball', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'leather', label: Text('Leather')),
                  ButtonSegment(value: 'tennis', label: Text('Tennis')),
                  ButtonSegment(value: 'tape', label: Text('Tape')),
                ],
                selected: {_ball},
                onSelectionChanged: (selection) => setState(() => _ball = selection.first),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Create'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

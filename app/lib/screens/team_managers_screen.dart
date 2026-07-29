import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

/// Organiser-only in practice — the backend 403s anyone else, same
/// convention as the rest of the app (the menu doesn't pre-filter by role).
class TeamManagersScreen extends ConsumerWidget {
  const TeamManagersScreen({super.key, required this.teamId, required this.tournamentSlug});

  final String teamId;
  final String tournamentSlug;

  SquadKey get _key => (teamId: teamId, tournamentSlug: tournamentSlug);

  Future<void> _grant(BuildContext context, WidgetRef ref) async {
    final nameController = TextEditingController();
    final emailController = TextEditingController();
    final entry = await showDialog<(String, String)>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Add a team manager'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('They must already have a CricHive account. Enter both so you can confirm it\'s the right person.'),
            const SizedBox(height: 12),
            TextField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Their name'),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: emailController,
              decoration: const InputDecoration(labelText: 'Email address'),
              keyboardType: TextInputType.emailAddress,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop((nameController.text.trim(), emailController.text.trim())),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (entry == null) return;
    final (expectedName, email) = entry;
    if (email.isEmpty) return;

    try {
      final manager = await ref.read(apiClientProvider).grantTeamManager(tournamentSlug, teamId, email: email);
      ref.invalidate(teamManagersProvider(_key));
      if (!context.mounted) return;

      final nameMatches = expectedName.isEmpty || expectedName.toLowerCase() == manager.displayName.toLowerCase();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            nameMatches
                ? 'Added ${manager.displayName} as team manager.'
                : 'Added the account named "${manager.displayName}" for that email — '
                    'you typed "$expectedName". Double-check this is the right person; revoke below if not.',
          ),
          duration: nameMatches ? const Duration(seconds: 4) : const Duration(seconds: 8),
        ),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _revoke(BuildContext context, WidgetRef ref, String membershipId) async {
    try {
      await ref.read(apiClientProvider).revokeTeamManager(tournamentSlug, teamId, membershipId);
      ref.invalidate(teamManagersProvider(_key));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final managers = ref.watch(teamManagersProvider(_key));

    return Scaffold(
      appBar: AppBar(title: const Text('Team managers')),
      body: AsyncValueView(
        value: managers,
        onRetry: () => ref.invalidate(teamManagersProvider(_key)),
        data: (context, list) {
          if (list.isEmpty) {
            return const EmptyState(message: 'No team managers added yet.', icon: Icons.admin_panel_settings_outlined);
          }
          return ListView.separated(
            itemCount: list.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final m = list[index];
              return ListTile(
                title: Text(m.displayName),
                subtitle: m.email == null ? null : Text(m.email!),
                trailing: IconButton(
                  tooltip: 'Revoke access',
                  icon: const Icon(Icons.remove_circle_outline),
                  onPressed: () => _revoke(context, ref, m.membershipId),
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _grant(context, ref),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Add manager'),
      ),
    );
  }
}

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
    final controller = TextEditingController();
    final email = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Add a team manager'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('They must already have a CricHive account.'),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(labelText: 'Email address'),
              keyboardType: TextInputType.emailAddress,
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()), child: const Text('Add')),
        ],
      ),
    );
    if (email == null || email.isEmpty) return;

    try {
      await ref.read(apiClientProvider).grantTeamManager(tournamentSlug, teamId, email: email);
      ref.invalidate(teamManagersProvider(_key));
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

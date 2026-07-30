import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

/// Organiser-only in practice — the backend 403s anyone else, same
/// convention as the rest of the app (the menu doesn't pre-filter by role).
/// Grants who may ever score for this tournament; which specific match(es)
/// they can actually act on is a separate per-match assignment, made from
/// the match screen itself — see [MatchDetail.assignedScorers].
class TournamentScorersScreen extends ConsumerWidget {
  const TournamentScorersScreen({super.key, required this.tournamentSlug});

  final String tournamentSlug;

  Future<void> _grant(BuildContext context, WidgetRef ref) async {
    final nameController = TextEditingController();
    final emailController = TextEditingController();
    final entry = await showDialog<(String, String)>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Add a scorer'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'They must already have a CricHive account. Enter both so you can confirm it\'s the right person.',
            ),
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
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(
              dialogContext,
            ).pop((nameController.text.trim(), emailController.text.trim())),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (entry == null) return;
    final (expectedName, email) = entry;
    if (email.isEmpty) return;

    try {
      final scorer = await ref
          .read(apiClientProvider)
          .grantTournamentScorer(tournamentSlug, email: email);
      ref.invalidate(tournamentScorersProvider(tournamentSlug));
      if (!context.mounted) return;

      final nameMatches =
          expectedName.isEmpty ||
          expectedName.toLowerCase() == scorer.displayName.toLowerCase();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            nameMatches
                ? 'Added ${scorer.displayName} as a scorer.'
                : 'Added the account named "${scorer.displayName}" for that email — '
                      'you typed "$expectedName". Double-check this is the right person; revoke below if not.',
          ),
          duration: nameMatches
              ? const Duration(seconds: 4)
              : const Duration(seconds: 8),
        ),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _revoke(
    BuildContext context,
    WidgetRef ref,
    String membershipId,
  ) async {
    try {
      await ref
          .read(apiClientProvider)
          .revokeTournamentScorer(tournamentSlug, membershipId);
      ref.invalidate(tournamentScorersProvider(tournamentSlug));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scorers = ref.watch(tournamentScorersProvider(tournamentSlug));

    return Scaffold(
      appBar: AppBar(title: const Text('Scorers')),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(
            tournamentScorersProvider(tournamentSlug).future,
          );
        },
        child: AsyncValueView(
          value: scorers,
          onRetry: () =>
              ref.invalidate(tournamentScorersProvider(tournamentSlug)),
          data: (context, list) {
            if (list.isEmpty) {
              return const EmptyState(
                message:
                    'No scorers added yet. Add one here, then assign them '
                    'to specific matches from each match screen.',
                icon: Icons.edit_note_outlined,
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: list.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final s = list[index];
                return ListTile(
                  title: Text(s.displayName),
                  subtitle: s.email == null ? null : Text(s.email!),
                  trailing: IconButton(
                    tooltip: 'Revoke access',
                    icon: const Icon(Icons.remove_circle_outline),
                    onPressed: () => _revoke(context, ref, s.membershipId),
                  ),
                );
              },
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _grant(context, ref),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Add scorer'),
      ),
    );
  }
}

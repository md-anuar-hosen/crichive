import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

/// Organiser-only in practice — the backend 403s anyone else, same
/// convention as the rest of the app. Assigns which of the tournament's
/// scorers (granted from [TournamentScorersScreen]) may act on THIS match —
/// the piece that actually restricts a scorer to one match at a time when
/// several are running concurrently.
class MatchScorersScreen extends ConsumerWidget {
  const MatchScorersScreen({
    super.key,
    required this.matchId,
    required this.tournamentSlug,
  });

  final String matchId;
  final String tournamentSlug;

  Future<void> _assign(
    BuildContext context,
    WidgetRef ref,
    String userId,
  ) async {
    try {
      await ref
          .read(apiClientProvider)
          .assignMatchScorer(matchId, userId: userId);
      ref.invalidate(matchScorersProvider(matchId));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _unassign(
    BuildContext context,
    WidgetRef ref,
    String userId,
  ) async {
    try {
      await ref.read(apiClientProvider).unassignMatchScorer(matchId, userId);
      ref.invalidate(matchScorersProvider(matchId));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tournamentScorers = ref.watch(
      tournamentScorersProvider(tournamentSlug),
    );
    final matchScorers = ref.watch(matchScorersProvider(matchId));

    return Scaffold(
      appBar: AppBar(title: const Text('Match scorers')),
      body: AsyncValueView(
        value: tournamentScorers,
        onRetry: () =>
            ref.invalidate(tournamentScorersProvider(tournamentSlug)),
        data: (context, roster) => AsyncValueView(
          value: matchScorers,
          onRetry: () => ref.invalidate(matchScorersProvider(matchId)),
          data: (context, assigned) {
            if (roster.isEmpty) {
              return const EmptyState(
                message:
                    "This tournament has no scorers yet — add one from the "
                    'tournament\'s Scorers screen first, then come back here '
                    'to assign them to this match.',
                icon: Icons.person_add_alt_1,
              );
            }
            final assignedIds = assigned.map((s) => s.userId).toSet();
            return ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: roster.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final scorer = roster[index];
                final isAssigned = assignedIds.contains(scorer.userId);
                return CheckboxListTile(
                  title: Text(scorer.displayName),
                  subtitle: Text(
                    isAssigned
                        ? 'Can score this match'
                        : 'Not assigned to this match',
                  ),
                  value: isAssigned,
                  onChanged: (checked) => checked == true
                      ? _assign(context, ref, scorer.userId)
                      : _unassign(context, ref, scorer.userId),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../state/auth_controller.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';
import 'create_tournament_screen.dart';

class TournamentListScreen extends ConsumerWidget {
  const TournamentListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tournaments = ref.watch(tournamentsProvider);
    final isAuthed = ref.watch(authControllerProvider).status == AuthStatus.authenticated;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tournaments'),
        actions: [
          if (isAuthed)
            IconButton(
              tooltip: 'Create tournament',
              icon: const Icon(Icons.add),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CreateTournamentScreen()),
              ),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(tournamentsProvider.future);
        },
        child: AsyncValueView(
          value: tournaments,
          onRetry: () => ref.invalidate(tournamentsProvider),
          data: (context, page) {
            if (page.data.isEmpty) {
              return const EmptyState(message: 'No tournaments yet.');
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: page.data.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final t = page.data[index];
                return ListTile(
                  leading: t.logoUrl == null
                      ? null
                      : ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: Image.network(
                            t.logoUrl!,
                            width: 40,
                            height: 40,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => const Icon(Icons.emoji_events_outlined),
                          ),
                        ),
                  title: Text(t.name),
                  subtitle: Text(
                    [
                      '${t.seasonYear}',
                      if (t.organizerOrg != null) t.organizerOrg!,
                      if (t.startsOn != null) DateFormat.yMMMd().format(t.startsOn!),
                    ].join(' · '),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/tournaments/${t.slug}'),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

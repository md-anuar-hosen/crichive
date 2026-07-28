import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../state/providers.dart';
import '../widgets/async_value_view.dart';

class LiveScreen extends ConsumerWidget {
  const LiveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = ref.watch(liveMatchesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Live')),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(liveMatchesProvider.future);
        },
        child: AsyncValueView(
          value: live,
          onRetry: () => ref.invalidate(liveMatchesProvider),
          data: (context, matches) {
            if (matches.isEmpty) {
              return const EmptyState(message: 'No matches live right now.', icon: Icons.live_tv_outlined);
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: matches.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final m = matches[index];
                return ListTile(
                  leading: const CircleAvatar(backgroundColor: Colors.redAccent, radius: 5),
                  title: Text('${m.teamA.label} vs ${m.teamB.label}'),
                  subtitle: Text(m.tournamentName),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/matches/${m.id}'),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

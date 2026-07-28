import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../state/providers.dart';
import '../widgets/async_value_view.dart';

class TeamSquadScreen extends ConsumerWidget {
  const TeamSquadScreen({super.key, required this.teamId, required this.tournamentSlug});

  final String teamId;
  final String tournamentSlug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final squad = ref.watch(squadProvider((teamId: teamId, tournamentSlug: tournamentSlug)));

    return Scaffold(
      appBar: AppBar(title: const Text('Squad')),
      body: AsyncValueView(
        value: squad,
        onRetry: () => ref.invalidate(squadProvider((teamId: teamId, tournamentSlug: tournamentSlug))),
        data: (context, players) {
          if (players.isEmpty) {
            return const EmptyState(message: 'Squad not announced yet.');
          }
          return ListView.separated(
            itemCount: players.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final p = players[index];
              final roles = [p.batting, p.bowling].whereType<String>().join(' · ');
              return ListTile(
                leading: CircleAvatar(child: Text(p.jerseyNumber?.toString() ?? '?')),
                title: Text(p.name),
                subtitle: roles.isEmpty ? null : Text(roles),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (p.isCaptain) const Padding(padding: EdgeInsets.only(right: 4), child: Chip(label: Text('C'), visualDensity: VisualDensity.compact)),
                    if (p.isKeeper) const Chip(label: Text('WK'), visualDensity: VisualDensity.compact),
                  ],
                ),
                onTap: () => context.push('/players/${p.id}'),
              );
            },
          );
        },
      ),
    );
  }
}

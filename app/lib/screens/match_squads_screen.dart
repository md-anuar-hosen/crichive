import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../models/team.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

/// Both teams' squads for a single match, Cricbuzz "Squads" tab style.
class MatchSquadsScreen extends StatelessWidget {
  const MatchSquadsScreen({super.key, required this.tournamentSlug, required this.teamA, required this.teamB});

  final String tournamentSlug;
  final TeamRef teamA;
  final TeamRef teamB;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Squads'),
          bottom: TabBar(tabs: [Tab(text: teamA.label), Tab(text: teamB.label)]),
        ),
        body: TabBarView(
          children: [
            _TeamSquadList(teamId: teamA.id, tournamentSlug: tournamentSlug),
            _TeamSquadList(teamId: teamB.id, tournamentSlug: tournamentSlug),
          ],
        ),
      ),
    );
  }
}

class _TeamSquadList extends ConsumerWidget {
  const _TeamSquadList({required this.teamId, required this.tournamentSlug});
  final String teamId;
  final String tournamentSlug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final squad = ref.watch(squadProvider((teamId: teamId, tournamentSlug: tournamentSlug)));

    return AsyncValueView(
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
    );
  }
}

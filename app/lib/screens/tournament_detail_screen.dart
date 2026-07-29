import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../models/fixture.dart';
import '../state/auth_controller.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';
import 'tournament_rules_screen.dart';

class TournamentDetailScreen extends ConsumerWidget {
  const TournamentDetailScreen({super.key, required this.slug, this.initialTabIndex = 0});

  final String slug;
  final int initialTabIndex;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tournament = ref.watch(tournamentProvider(slug));
    final isAuthed = ref.watch(authControllerProvider).status == AuthStatus.authenticated;

    return DefaultTabController(
      length: 4,
      initialIndex: initialTabIndex,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            tournament.whenOrNull(data: (t) => t.name) ?? 'Tournament',
            overflow: TextOverflow.ellipsis,
          ),
          actions: [
            if (isAuthed)
              IconButton(
                tooltip: 'Edit rules',
                icon: const Icon(Icons.tune),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => TournamentRulesScreen(tournamentSlug: slug)),
                ),
              ),
          ],
          bottom: const TabBar(
            tabs: [Tab(text: 'Fixtures'), Tab(text: 'Teams'), Tab(text: 'Standings'), Tab(text: 'Awards')],
          ),
        ),
        body: TabBarView(
          children: [
            _FixturesTab(slug: slug),
            _TeamsTab(slug: slug),
            _StandingsTab(slug: slug),
            _AwardsTab(slug: slug),
          ],
        ),
      ),
    );
  }
}

class _FixturesTab extends ConsumerWidget {
  const _FixturesTab({required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fixtures = ref.watch(fixturesProvider(slug));
    return AsyncValueView(
      value: fixtures,
      onRetry: () => ref.invalidate(fixturesProvider(slug)),
      data: (context, page) {
        if (page.data.isEmpty) {
          return const EmptyState(message: 'No fixtures scheduled yet.', icon: Icons.sports_cricket_outlined);
        }
        return ListView.separated(
          itemCount: page.data.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final f = page.data[index];
            return ListTile(
              leading: _StatusDot(fixture: f),
              title: Text('${f.teamA.label} vs ${f.teamB.label}'),
              subtitle: Text(_subtitle(f)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/matches/${f.id}'),
            );
          },
        );
      },
    );
  }

  String _subtitle(Fixture f) {
    if (f.isCompleted) return f.resultNote ?? 'Completed';
    if (f.isLive) return 'Live now';
    if (f.scheduledStart == null) return f.status;
    return DateFormat.yMMMd().add_jm().format(f.scheduledStart!.toLocal());
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.fixture});
  final Fixture fixture;

  @override
  Widget build(BuildContext context) {
    final color = fixture.isLive
        ? Colors.redAccent
        : fixture.isCompleted
            ? Colors.grey
            : Theme.of(context).colorScheme.primary;
    return CircleAvatar(radius: 5, backgroundColor: color);
  }
}

class _TeamsTab extends ConsumerWidget {
  const _TeamsTab({required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teams = ref.watch(teamsProvider(slug));
    return AsyncValueView(
      value: teams,
      onRetry: () => ref.invalidate(teamsProvider(slug)),
      data: (context, page) {
        if (page.data.isEmpty) {
          return const EmptyState(message: 'No teams yet.');
        }
        return ListView.separated(
          itemCount: page.data.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final team = page.data[index];
            return ListTile(
              leading: CircleAvatar(child: Text(team.label.isNotEmpty ? team.label[0] : '?')),
              title: Text(team.name),
              subtitle: team.homeCity == null ? null : Text(team.homeCity!),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/teams/${team.id}/squad/$slug'),
            );
          },
        );
      },
    );
  }
}

class _StandingsTab extends ConsumerWidget {
  const _StandingsTab({required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final standings = ref.watch(standingsProvider(slug));
    return AsyncValueView(
      value: standings,
      onRetry: () => ref.invalidate(standingsProvider(slug)),
      data: (context, groups) {
        if (groups.isEmpty) {
          return const EmptyState(message: 'Standings will appear once matches are played.');
        }
        return ListView.builder(
          itemCount: groups.length,
          itemBuilder: (context, index) {
            final group = groups[index];
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                    child: Text(group.groupName, style: Theme.of(context).textTheme.titleMedium),
                  ),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columns: const [
                        DataColumn(label: Text('Team')),
                        DataColumn(label: Text('P'), numeric: true),
                        DataColumn(label: Text('W'), numeric: true),
                        DataColumn(label: Text('L'), numeric: true),
                        DataColumn(label: Text('T'), numeric: true),
                        DataColumn(label: Text('NR'), numeric: true),
                        DataColumn(label: Text('Pts'), numeric: true),
                        DataColumn(label: Text('NRR'), numeric: true),
                      ],
                      rows: group.standings
                          .map(
                            (s) => DataRow(
                              cells: [
                                DataCell(Text(s.team.label)),
                                DataCell(Text('${s.played}')),
                                DataCell(Text('${s.won}')),
                                DataCell(Text('${s.lost}')),
                                DataCell(Text('${s.tied}')),
                                DataCell(Text('${s.noResult}')),
                                DataCell(Text('${s.points}')),
                                DataCell(Text(s.netRunRate.toStringAsFixed(3))),
                              ],
                            ),
                          )
                          .toList(),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _AwardsTab extends ConsumerWidget {
  const _AwardsTab({required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final awards = ref.watch(awardsProvider(slug));
    return AsyncValueView(
      value: awards,
      onRetry: () => ref.invalidate(awardsProvider(slug)),
      data: (context, a) {
        if (a.playerOfTournament == null && a.mostRuns.isEmpty && a.mostWickets.isEmpty) {
          return const EmptyState(message: 'Awards will appear once matches are completed.');
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (a.playerOfTournament != null) ...[
              Card(
                color: Theme.of(context).colorScheme.primaryContainer,
                child: ListTile(
                  leading: Icon(Icons.emoji_events, color: Theme.of(context).colorScheme.onPrimaryContainer),
                  title: Text(
                    a.playerOfTournament!.name ?? 'Unknown player',
                    style: TextStyle(color: Theme.of(context).colorScheme.onPrimaryContainer, fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text(
                    'Player of the Tournament',
                    style: TextStyle(color: Theme.of(context).colorScheme.onPrimaryContainer),
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
            if (a.mostRuns.isNotEmpty) ...[
              Text('Most runs', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              ...a.mostRuns.map(
                (r) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(r.name ?? 'Unknown player'),
                  subtitle: Text('${r.fours} fours · ${r.sixes} sixes'),
                  trailing: Text('${r.runs}', style: Theme.of(context).textTheme.titleMedium),
                ),
              ),
              const SizedBox(height: 16),
            ],
            if (a.mostWickets.isNotEmpty) ...[
              Text('Most wickets', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              ...a.mostWickets.map(
                (w) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(w.name ?? 'Unknown player'),
                  subtitle: Text('${w.maidens} maidens'),
                  trailing: Text('${w.wickets}', style: Theme.of(context).textTheme.titleMedium),
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

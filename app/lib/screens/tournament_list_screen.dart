import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../state/auth_controller.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';
import 'create_tournament_screen.dart';

class TournamentListScreen extends ConsumerStatefulWidget {
  const TournamentListScreen({super.key});

  @override
  ConsumerState<TournamentListScreen> createState() => _TournamentListScreenState();
}

class _TournamentListScreenState extends ConsumerState<TournamentListScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;

  String? _q;
  String? _ball;
  String? _country;
  int? _seasonYear;

  TournamentFilter get _filter => (q: _q, country: _country, seasonYear: _seasonYear, ball: _ball);

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      setState(() => _q = value.trim().isEmpty ? null : value.trim());
    });
  }

  Future<void> _openMoreFilters() async {
    final countryController = TextEditingController(text: _country ?? '');
    final seasonController = TextEditingController(text: _seasonYear?.toString() ?? '');
    final result = await showDialog<(String?, int?)>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('More filters'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: countryController,
              maxLength: 2,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(labelText: 'Country code (e.g. FI)'),
            ),
            TextField(
              controller: seasonController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Season year'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop((null, null)),
            child: const Text('Clear'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop((
              countryController.text.trim().isEmpty ? null : countryController.text.trim(),
              int.tryParse(seasonController.text.trim()),
            )),
            child: const Text('Apply'),
          ),
        ],
      ),
    );
    if (result == null) return;
    setState(() {
      _country = result.$1;
      _seasonYear = result.$2;
    });
  }

  @override
  Widget build(BuildContext context) {
    final tournaments = ref.watch(tournamentsProvider(_filter));
    final isAuthed = ref.watch(authControllerProvider).status == AuthStatus.authenticated;
    final hasMoreFilters = _country != null || _seasonYear != null;

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
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search tournaments or clubs',
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final ball in const ['leather', 'tennis', 'tape'])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(ball[0].toUpperCase() + ball.substring(1)),
                        selected: _ball == ball,
                        onSelected: (selected) => setState(() => _ball = selected ? ball : null),
                      ),
                    ),
                  ActionChip(
                    avatar: Icon(Icons.tune, size: 18, color: hasMoreFilters ? Theme.of(context).colorScheme.primary : null),
                    label: Text(hasMoreFilters ? 'Filters (${(_country != null ? 1 : 0) + (_seasonYear != null ? 1 : 0)})' : 'More filters'),
                    onPressed: _openMoreFilters,
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                final _ = await ref.refresh(tournamentsProvider(_filter).future);
              },
              child: AsyncValueView(
                value: tournaments,
                onRetry: () => ref.invalidate(tournamentsProvider(_filter)),
                data: (context, page) {
                  if (page.data.isEmpty) {
                    return const RefreshableEmptyState(
                      message: 'No tournaments match those filters.',
                    );
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
          ),
        ],
      ),
    );
  }
}

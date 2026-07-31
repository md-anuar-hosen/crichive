import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/api_exception.dart';
import '../models/player.dart';
import '../state/auth_controller.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';
import 'team_managers_screen.dart';

class TeamSquadScreen extends ConsumerStatefulWidget {
  const TeamSquadScreen({
    super.key,
    required this.teamId,
    required this.tournamentSlug,
  });

  final String teamId;
  final String tournamentSlug;

  @override
  ConsumerState<TeamSquadScreen> createState() => _TeamSquadScreenState();
}

class _TeamSquadScreenState extends ConsumerState<TeamSquadScreen> {
  bool _manageMode = false;

  SquadKey get _key =>
      (teamId: widget.teamId, tournamentSlug: widget.tournamentSlug);

  void _refresh() {
    ref.invalidate(squadProvider(_key));
    ref.invalidate(managedSquadProvider(_key));
  }

  Future<void> _showAddPlayerFlow(BuildContext context) async {
    final player = await Navigator.of(context).push<Player>(
      MaterialPageRoute(builder: (_) => const _PlayerSearchScreen()),
    );
    if (player == null || !context.mounted) return;

    final entry = await _showSquadEntryDialog(
      context,
      title: 'Add ${player.name}',
    );
    if (entry == null || !context.mounted) return;

    try {
      await ref
          .read(apiClientProvider)
          .addSquadPlayer(
            widget.tournamentSlug,
            widget.teamId,
            playerId: player.id,
            jerseyNumber: entry.jerseyNumber,
            isCaptain: entry.isCaptain,
            isKeeper: entry.isKeeper,
          );
      _refresh();
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Player added')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _editPlayer(BuildContext context, SquadPlayer player) async {
    final entry = await _showSquadEntryDialog(
      context,
      title: 'Edit ${player.name}',
      jerseyNumber: player.jerseyNumber,
      isCaptain: player.isCaptain,
      isKeeper: player.isKeeper,
    );
    if (entry == null || !mounted) return;

    try {
      await ref
          .read(apiClientProvider)
          .editSquadPlayer(
            widget.tournamentSlug,
            widget.teamId,
            player.id,
            jerseyNumber: entry.jerseyNumber,
            isCaptain: entry.isCaptain,
            isKeeper: entry.isKeeper,
          );
      _refresh();
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Player updated')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _removePlayer(BuildContext context, SquadPlayer player) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Remove ${player.name}?'),
        content: const Text(
          'They will need to be added again to rejoin this squad.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await ref
          .read(apiClientProvider)
          .removeSquadPlayer(widget.tournamentSlug, widget.teamId, player.id);
      _refresh();
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _approvePlayer(BuildContext context, SquadPlayer player) async {
    try {
      await ref
          .read(apiClientProvider)
          .approveSquadPlayer(
            widget.tournamentSlug,
            widget.teamId,
            player.id,
            licenceVerified: true,
          );
      _refresh();
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('${player.name} approved')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAuthed =
        ref.watch(authControllerProvider).status == AuthStatus.authenticated;
    final squad = _manageMode
        ? ref.watch(managedSquadProvider(_key))
        : ref.watch(squadProvider(_key));

    return Scaffold(
      appBar: AppBar(
        title: Text(_manageMode ? 'Manage squad' : 'Squad'),
        actions: [
          if (isAuthed)
            IconButton(
              tooltip: _manageMode ? 'Done' : 'Manage squad',
              icon: Icon(_manageMode ? Icons.check : Icons.edit_outlined),
              onPressed: () => setState(() => _manageMode = !_manageMode),
            ),
          if (isAuthed && _manageMode)
            IconButton(
              tooltip: 'Team managers',
              icon: const Icon(Icons.admin_panel_settings_outlined),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => TeamManagersScreen(
                    teamId: widget.teamId,
                    tournamentSlug: widget.tournamentSlug,
                  ),
                ),
              ),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          if (_manageMode) {
            final _ = await ref.refresh(managedSquadProvider(_key).future);
          } else {
            final _ = await ref.refresh(squadProvider(_key).future);
          }
        },
        child: AsyncValueView(
          value: squad,
          onRetry: _refresh,
          data: (context, players) {
            if (players.isEmpty) {
              return RefreshableEmptyState(
                message: _manageMode
                    ? 'No players in the squad yet — add one below.'
                    : 'Squad not announced yet.',
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: players.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final p = players[index];
                final roles = [
                  p.batting,
                  p.bowling,
                ].whereType<String>().join(' · ');
                return ListTile(
                  leading: CircleAvatar(
                    child: Text(p.jerseyNumber?.toString() ?? '?'),
                  ),
                  title: Text(p.name),
                  subtitle: Text(
                    [
                      if (roles.isNotEmpty) roles,
                      if (_manageMode && !p.isApproved)
                        'Pending organiser approval',
                    ].join(roles.isNotEmpty ? ' · ' : ''),
                    style: (_manageMode && !p.isApproved)
                        ? TextStyle(color: Theme.of(context).colorScheme.error)
                        : null,
                  ),
                  trailing: _manageMode
                      ? Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (p.isCaptain)
                              const Padding(
                                padding: EdgeInsets.only(right: 4),
                                child: Chip(
                                  label: Text('C'),
                                  visualDensity: VisualDensity.compact,
                                ),
                              ),
                            if (p.isKeeper)
                              const Padding(
                                padding: EdgeInsets.only(right: 4),
                                child: Chip(
                                  label: Text('WK'),
                                  visualDensity: VisualDensity.compact,
                                ),
                              ),
                            PopupMenuButton<String>(
                              onSelected: (action) {
                                switch (action) {
                                  case 'edit':
                                    _editPlayer(context, p);
                                  case 'approve':
                                    _approvePlayer(context, p);
                                  case 'remove':
                                    _removePlayer(context, p);
                                }
                              },
                              itemBuilder: (context) => [
                                const PopupMenuItem(
                                  value: 'edit',
                                  child: Text('Edit'),
                                ),
                                if (!p.isApproved)
                                  const PopupMenuItem(
                                    value: 'approve',
                                    child: Text('Approve'),
                                  ),
                                const PopupMenuItem(
                                  value: 'remove',
                                  child: Text(
                                    'Remove',
                                    style: TextStyle(color: Colors.red),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        )
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (p.isCaptain)
                              const Padding(
                                padding: EdgeInsets.only(right: 4),
                                child: Chip(
                                  label: Text('C'),
                                  visualDensity: VisualDensity.compact,
                                ),
                              ),
                            if (p.isKeeper)
                              const Chip(
                                label: Text('WK'),
                                visualDensity: VisualDensity.compact,
                              ),
                          ],
                        ),
                  onTap: _manageMode
                      ? null
                      : () => context.push('/players/${p.id}'),
                );
              },
            );
          },
        ),
      ),
      floatingActionButton: (isAuthed && _manageMode)
          ? FloatingActionButton.extended(
              onPressed: () => _showAddPlayerFlow(context),
              icon: const Icon(Icons.person_add_alt_1),
              label: const Text('Add player'),
            )
          : null,
    );
  }
}

class _SquadEntryResult {
  const _SquadEntryResult({
    this.jerseyNumber,
    required this.isCaptain,
    required this.isKeeper,
  });
  final int? jerseyNumber;
  final bool isCaptain;
  final bool isKeeper;
}

Future<_SquadEntryResult?> _showSquadEntryDialog(
  BuildContext context, {
  required String title,
  int? jerseyNumber,
  bool isCaptain = false,
  bool isKeeper = false,
}) {
  final jerseyController = TextEditingController(
    text: jerseyNumber?.toString() ?? '',
  );
  var captain = isCaptain;
  var keeper = isKeeper;

  return showDialog<_SquadEntryResult>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setState) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: jerseyController,
              decoration: const InputDecoration(
                labelText: 'Jersey number (optional)',
              ),
              keyboardType: TextInputType.number,
              autofocus: true,
            ),
            CheckboxListTile(
              title: const Text('Captain'),
              value: captain,
              onChanged: (v) => setState(() => captain = v ?? false),
              contentPadding: EdgeInsets.zero,
            ),
            CheckboxListTile(
              title: const Text('Wicketkeeper'),
              value: keeper,
              onChanged: (v) => setState(() => keeper = v ?? false),
              contentPadding: EdgeInsets.zero,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(
              _SquadEntryResult(
                jerseyNumber: int.tryParse(jerseyController.text.trim()),
                isCaptain: captain,
                isKeeper: keeper,
              ),
            ),
            child: const Text('Save'),
          ),
        ],
      ),
    ),
  );
}

/// Search existing players by name and hand the pick back to the caller —
/// squad management only adds *existing* player records; registering a
/// brand-new player (Suomisport ID, DOB, GDPR consent) stays organiser-only,
/// same as before this feature.
class _PlayerSearchScreen extends ConsumerStatefulWidget {
  const _PlayerSearchScreen();

  @override
  ConsumerState<_PlayerSearchScreen> createState() =>
      _PlayerSearchScreenState();
}

class _PlayerSearchScreenState extends ConsumerState<_PlayerSearchScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<Player> _results = const [];
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String query) {
    _debounce?.cancel();
    final trimmed = query.trim();
    if (trimmed.length < 2) {
      setState(() {
        _results = const [];
        _error = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      setState(() {
        _loading = true;
        _error = null;
      });
      try {
        final results = await ref
            .read(apiClientProvider)
            .searchPlayers(trimmed);
        if (!mounted) return;
        setState(() {
          _results = results;
          _loading = false;
        });
      } on ApiException catch (e) {
        if (!mounted) return;
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Search players by name',
            border: InputBorder.none,
          ),
          onChanged: _onChanged,
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text(_error!))
          : _results.isEmpty
          ? EmptyState(
              message: _controller.text.trim().length >= 2
                  ? 'No players found matching that name.'
                  : 'Type at least 2 characters to search.',
            )
          : ListView.separated(
              itemCount: _results.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final p = _results[index];
                final roles = [
                  p.batting,
                  p.bowling,
                ].whereType<String>().join(' · ');
                return ListTile(
                  title: Text(p.name),
                  subtitle: roles.isEmpty ? null : Text(roles),
                  onTap: () => Navigator.of(context).pop(p),
                );
              },
            ),
    );
  }
}

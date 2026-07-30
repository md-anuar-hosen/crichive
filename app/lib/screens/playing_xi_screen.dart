import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/player.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

class PlayingXiScreen extends ConsumerStatefulWidget {
  const PlayingXiScreen({
    super.key,
    required this.matchId,
    required this.teamId,
    required this.teamName,
    required this.tournamentSlug,
  });

  final String matchId;
  final String teamId;
  final String teamName;
  final String tournamentSlug;

  @override
  ConsumerState<PlayingXiScreen> createState() => _PlayingXiScreenState();
}

class _PlayingXiScreenState extends ConsumerState<PlayingXiScreen> {
  final Set<String> _selected = {};
  String? _captainId;
  String? _keeperId;
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    final squad = ref.watch(
      squadProvider((
        teamId: widget.teamId,
        tournamentSlug: widget.tournamentSlug,
      )),
    );
    final tournament = ref.watch(tournamentProvider(widget.tournamentSlug));

    return Scaffold(
      appBar: AppBar(title: Text('Playing XI — ${widget.teamName}')),
      body: AsyncValueView(
        value: squad,
        onRetry: () => ref.invalidate(
          squadProvider((
            teamId: widget.teamId,
            tournamentSlug: widget.tournamentSlug,
          )),
        ),
        data: (context, players) => AsyncValueView(
          value: tournament,
          onRetry: () =>
              ref.invalidate(tournamentProvider(widget.tournamentSlug)),
          data: (context, t) {
            final requiredCount = t.rules?.playersPerSide ?? 11;
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'Select $requiredCount players (${_selected.length}/$requiredCount)',
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: players.length,
                    itemBuilder: (context, index) {
                      final p = players[index];
                      final checked = _selected.contains(p.id);
                      return CheckboxListTile(
                        value: checked,
                        title: Text(p.name),
                        subtitle: Text(
                          [
                            p.batting,
                            p.bowling,
                          ].whereType<String>().join(' · '),
                        ),
                        onChanged: (v) {
                          setState(() {
                            if (v == true) {
                              if (_selected.length < requiredCount) {
                                _selected.add(p.id);
                              }
                            } else {
                              _selected.remove(p.id);
                              if (_captainId == p.id) _captainId = null;
                              if (_keeperId == p.id) _keeperId = null;
                            }
                          });
                        },
                      );
                    },
                  ),
                ),
                if (_selected.length == requiredCount)
                  _CaptainKeeperPicker(
                    players: players
                        .where((p) => _selected.contains(p.id))
                        .toList(),
                    captainId: _captainId,
                    keeperId: _keeperId,
                    onCaptainChanged: (v) => setState(() => _captainId = v),
                    onKeeperChanged: (v) => setState(() => _keeperId = v),
                  ),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton(
                    onPressed:
                        (_selected.length == requiredCount &&
                            _captainId != null &&
                            _keeperId != null &&
                            !_submitting)
                        ? _submit
                        : null,
                    child: _submitting
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Save playing XI'),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await ref
          .read(apiClientProvider)
          .setPlayingXi(
            widget.matchId,
            teamId: widget.teamId,
            playerIds: _selected.toList(),
            captainId: _captainId!,
            keeperId: _keeperId!,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}

class _CaptainKeeperPicker extends StatelessWidget {
  const _CaptainKeeperPicker({
    required this.players,
    required this.captainId,
    required this.keeperId,
    required this.onCaptainChanged,
    required this.onKeeperChanged,
  });

  final List<SquadPlayer> players;
  final String? captainId;
  final String? keeperId;
  final ValueChanged<String?> onCaptainChanged;
  final ValueChanged<String?> onKeeperChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: captainId,
              decoration: const InputDecoration(labelText: 'Captain'),
              items: players
                  .map(
                    (p) => DropdownMenuItem(value: p.id, child: Text(p.name)),
                  )
                  .toList(),
              onChanged: onCaptainChanged,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: keeperId,
              decoration: const InputDecoration(labelText: 'Keeper'),
              items: players
                  .map(
                    (p) => DropdownMenuItem(value: p.id, child: Text(p.name)),
                  )
                  .toList(),
              onChanged: onKeeperChanged,
            ),
          ),
        ],
      ),
    );
  }
}

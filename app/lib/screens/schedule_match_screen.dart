import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../api/api_exception.dart';
import '../models/team.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

/// Organiser-only in practice (backend 403s anyone else). Covers both a
/// single standalone match and a small round-robin scheduled one match at
/// a time — there's no group/bracket ceremony required.
class ScheduleMatchScreen extends ConsumerStatefulWidget {
  const ScheduleMatchScreen({super.key, required this.tournamentSlug});

  final String tournamentSlug;

  @override
  ConsumerState<ScheduleMatchScreen> createState() =>
      _ScheduleMatchScreenState();
}

class _ScheduleMatchScreenState extends ConsumerState<ScheduleMatchScreen> {
  String? _teamAId;
  String? _teamBId;
  DateTime? _scheduledStart;
  bool _submitting = false;
  String? _error;

  Future<void> _pickDateTime() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _scheduledStart ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: _scheduledStart == null
          ? TimeOfDay.now()
          : TimeOfDay.fromDateTime(_scheduledStart!),
    );
    if (time == null) return;
    setState(
      () => _scheduledStart = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      ),
    );
  }

  Future<void> _submit() async {
    if (_teamAId == null || _teamBId == null) {
      setState(() => _error = 'Select both teams.');
      return;
    }
    if (_teamAId == _teamBId) {
      setState(() => _error = 'The two teams must differ.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .createMatch(
            widget.tournamentSlug,
            teamAId: _teamAId!,
            teamBId: _teamBId!,
            scheduledStart: _scheduledStart,
          );
      ref.invalidate(fixturesProvider(widget.tournamentSlug));
      if (!mounted) return;
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final teams = ref.watch(teamsProvider(widget.tournamentSlug));

    return Scaffold(
      appBar: AppBar(title: const Text('Schedule a match')),
      body: AsyncValueView(
        value: teams,
        onRetry: () => ref.invalidate(teamsProvider(widget.tournamentSlug)),
        data: (context, page) {
          if (page.data.length < 2) {
            return const EmptyState(
              message:
                  'Add at least 2 teams to the tournament before scheduling a match.',
            );
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_error != null) ...[
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
                const SizedBox(height: 12),
              ],
              _TeamDropdown(
                label: 'Team A',
                teams: page.data,
                value: _teamAId,
                onChanged: (v) => setState(() => _teamAId = v),
              ),
              const SizedBox(height: 12),
              _TeamDropdown(
                label: 'Team B',
                teams: page.data,
                value: _teamBId,
                onChanged: (v) => setState(() => _teamBId = v),
              ),
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Scheduled start (optional)'),
                subtitle: Text(
                  _scheduledStart == null
                      ? 'Not set'
                      : DateFormat.yMMMd().add_jm().format(_scheduledStart!),
                ),
                trailing: const Icon(Icons.calendar_today_outlined),
                onTap: _pickDateTime,
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Schedule match'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _TeamDropdown extends StatelessWidget {
  const _TeamDropdown({
    required this.label,
    required this.teams,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final List<Team> teams;
  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: teams
          .map((t) => DropdownMenuItem(value: t.id, child: Text(t.name)))
          .toList(),
      onChanged: onChanged,
    );
  }
}

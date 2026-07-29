import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../api/api_exception.dart';
import '../state/providers.dart';
import '../widgets/async_value_view.dart';

/// Platform-admin only in practice — the backend 403s anyone else, same
/// convention as team management. Unlike a tournament role, is_platform_admin
/// rides in the JWT itself, so gating the entry point on it client-side
/// (see ProfileScreen) is legitimate, not just a UI nicety.
class PlatformAdminScreen extends ConsumerWidget {
  const PlatformAdminScreen({super.key});

  Future<void> _setMode(BuildContext context, WidgetRef ref, String mode) async {
    try {
      await ref.read(apiClientProvider).updatePlatformSettings(organizerSignupMode: mode);
      ref.invalidate(platformSettingsProvider);
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _approve(BuildContext context, WidgetRef ref, String slug, String name) async {
    try {
      await ref.read(apiClientProvider).approveTournament(slug);
      ref.invalidate(pendingTournamentsProvider);
      ref.invalidate(tournamentsProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$name approved')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(platformSettingsProvider);
    final pending = ref.watch(pendingTournamentsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Platform admin')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Organiser signup', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Controls whether creating a tournament makes someone its organiser immediately, or waits for your approval.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
          ),
          const SizedBox(height: 8),
          settings.when(
            data: (s) => SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'open', label: Text('Open')),
                ButtonSegment(value: 'approval_required', label: Text('Approval required')),
              ],
              selected: {s.organizerSignupMode},
              onSelectionChanged: (selection) => _setMode(context, ref, selection.first),
            ),
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Text('$e'),
          ),
          const SizedBox(height: 24),
          Text('Pending tournaments', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          AsyncValueView(
            value: pending,
            onRetry: () => ref.invalidate(pendingTournamentsProvider),
            data: (context, list) {
              if (list.isEmpty) {
                return const EmptyState(message: 'Nothing waiting for approval.', icon: Icons.task_alt);
              }
              return Column(
                children: [
                  for (final t in list)
                    Card(
                      child: ListTile(
                        title: Text(t.name),
                        subtitle: Text('${t.seasonYear} · ${t.createdBy.name} · ${DateFormat.yMMMd().format(t.createdAt)}'),
                        trailing: FilledButton(
                          onPressed: () => _approve(context, ref, t.slug, t.name),
                          child: const Text('Approve'),
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

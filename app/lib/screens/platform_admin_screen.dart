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

  Future<void> _resolveDataRequest(BuildContext context, WidgetRef ref, String id) async {
    final noteController = TextEditingController();
    final status = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Resolve data request'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: noteController,
              decoration: const InputDecoration(labelText: 'Resolution note (optional)'),
              maxLines: 3,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(dialogContext).pop('rejected'), child: const Text('Reject')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop('resolved'), child: const Text('Resolve')),
        ],
      ),
    );
    if (status == null) return;

    try {
      await ref.read(apiClientProvider).resolveDataRequest(id, status: status, resolutionNote: noteController.text.trim().isEmpty ? null : noteController.text.trim());
      ref.invalidate(dataRequestsProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(status == 'resolved' ? 'Marked resolved' : 'Marked rejected')));
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(platformSettingsProvider);
    final pending = ref.watch(pendingTournamentsProvider);
    final openDataRequests = ref.watch(dataRequestsProvider('open'));

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
          AsyncValueView(
            value: settings,
            onRetry: () => ref.invalidate(platformSettingsProvider),
            data: (context, s) => SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'open', label: Text('Open')),
                ButtonSegment(value: 'approval_required', label: Text('Approval required')),
              ],
              selected: {s.organizerSignupMode},
              onSelectionChanged: (selection) => _setMode(context, ref, selection.first),
            ),
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
          const SizedBox(height: 24),
          Text('Open data requests', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'GDPR access/correction/erasure/objection requests raised via the app.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
          ),
          const SizedBox(height: 8),
          AsyncValueView(
            value: openDataRequests,
            onRetry: () => ref.invalidate(dataRequestsProvider('open')),
            data: (context, list) {
              if (list.isEmpty) {
                return const EmptyState(message: 'No open data requests.', icon: Icons.task_alt);
              }
              return Column(
                children: [
                  for (final r in list)
                    Card(
                      child: ListTile(
                        title: Text('${r.kind[0].toUpperCase()}${r.kind.substring(1)} — ${r.raisedByEmail}'),
                        subtitle: Text(
                          [
                            DateFormat.yMMMd().format(r.createdAt),
                            if (r.details != null && r.details!.isNotEmpty) r.details!,
                          ].join(' · '),
                        ),
                        isThreeLine: r.details != null && r.details!.isNotEmpty,
                        trailing: FilledButton(
                          onPressed: () => _resolveDataRequest(context, ref, r.id),
                          child: const Text('Resolve'),
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

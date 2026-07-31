import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';

/// Renders loading / error / data states consistently so no screen ships a
/// bare spinner-forever or a silent failure.
class AsyncValueView<T> extends StatelessWidget {
  const AsyncValueView({
    super.key,
    required this.value,
    required this.data,
    this.onRetry,
  });

  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) data;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: (d) => data(context, d),
      loading: () => const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      ),
      error: (error, stack) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 40),
              const SizedBox(height: 12),
              Text(_friendlyMessage(error), textAlign: TextAlign.center),
              if (onRetry != null) ...[
                const SizedBox(height: 12),
                OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _friendlyMessage(Object error) {
    // ApiException.toString() is already a clean, server-provided message.
    // Anything else (a type-cast failure on a malformed response, a socket
    // error, etc.) is a raw Dart/platform message that wouldn't mean
    // anything to a user — show a generic fallback instead.
    if (error is ApiException) {
      final message = error.message;
      return message.isEmpty ? 'Something went wrong.' : message;
    }
    return 'Something went wrong. Please try again.';
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
  });

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

/// Same content as [EmptyState], but scrollable so a [RefreshIndicator]
/// ancestor still has something to drag against. A bare [EmptyState] has no
/// scrollable descendant, so pulling down over it does nothing — use this
/// instead whenever the empty branch sits directly under a
/// [RefreshIndicator] (the non-empty branch's ListView already satisfies
/// this on its own).
class RefreshableEmptyState extends StatelessWidget {
  const RefreshableEmptyState({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
  });

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: EmptyState(message: message, icon: icon),
        ),
      ),
    );
  }
}

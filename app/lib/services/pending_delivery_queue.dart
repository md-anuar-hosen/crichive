import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/pending_delivery.dart';

/// Persists deliveries that failed to reach the server (no network) so they
/// survive an app restart and can be retried in the order they were scored.
/// Keyed per match, since a scorer only ever has one match open at a time
/// but the app could plausibly hold onto more than one backlog.
class PendingDeliveryQueue {
  Future<String> _key(String matchId) async => 'pending_deliveries_$matchId';

  Future<List<PendingDelivery>> all(String matchId) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(await _key(matchId));
    if (raw == null) return [];
    final list = jsonDecode(raw) as List;
    return list.cast<Map<String, dynamic>>().map(PendingDelivery.fromJson).toList();
  }

  Future<void> enqueue(PendingDelivery delivery) async {
    final prefs = await SharedPreferences.getInstance();
    final key = await _key(delivery.matchId);
    final existing = await all(delivery.matchId);
    final updated = [...existing, delivery];
    await prefs.setString(key, jsonEncode(updated.map((d) => d.toJson()).toList()));
  }

  /// Removes the oldest queued delivery for [matchId] — call after it's
  /// been confirmed submitted, so retries always pop from the front and
  /// the remaining backlog stays in scoring order.
  Future<void> removeFirst(String matchId) async {
    final prefs = await SharedPreferences.getInstance();
    final key = await _key(matchId);
    final existing = await all(matchId);
    if (existing.isEmpty) return;
    final remaining = existing.skip(1).toList();
    if (remaining.isEmpty) {
      await prefs.remove(key);
    } else {
      await prefs.setString(key, jsonEncode(remaining.map((d) => d.toJson()).toList()));
    }
  }

  /// Removes the most recently queued delivery for [matchId] — the local
  /// side of "undo" when the last ball scored never reached the server
  /// (still offline), so there's nothing to void server-side.
  Future<void> removeLast(String matchId) async {
    final prefs = await SharedPreferences.getInstance();
    final key = await _key(matchId);
    final existing = await all(matchId);
    if (existing.isEmpty) return;
    final remaining = existing.sublist(0, existing.length - 1);
    if (remaining.isEmpty) {
      await prefs.remove(key);
    } else {
      await prefs.setString(key, jsonEncode(remaining.map((d) => d.toJson()).toList()));
    }
  }
}

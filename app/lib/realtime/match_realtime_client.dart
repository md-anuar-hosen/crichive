import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'ws_config.dart';

/// One WebSocket connection per open live match screen, subscribed to
/// `match:{id}` at /ws. This is a read-only push channel used purely to
/// know *when* to refetch the REST scorecard — the delivery payload itself
/// is shaped by the domain scoring engine (playerId-keyed, no display
/// names), and re-deriving a display scorecard from it client-side would
/// duplicate backend business logic. Reconnects resend the last-seen
/// sequence so the server can replay anything missed while disconnected.
class MatchRealtimeClient {
  MatchRealtimeClient({required this.matchId});

  final String matchId;

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _reconnectTimer;
  bool _disposed = false;
  int _reconnectAttempt = 0;

  String? _inningsId;
  int? _lastSequence;

  final _updatesController = StreamController<void>.broadcast();

  /// Fires whenever a delivery (live or replayed) arrives for this match —
  /// the signal to refetch the scorecard, not the data itself.
  Stream<void> get updates => _updatesController.stream;

  void connect() {
    if (_disposed) return;
    try {
      final channel = WebSocketChannel.connect(Uri.parse('$wsBaseUrl/ws'));
      _channel = channel;
      _subscription = channel.stream.listen(
        _handleMessage,
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );
      channel.ready.then((_) {
        if (_disposed) return;
        _reconnectAttempt = 0;
        _send();
      });
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _send() {
    _channel?.sink.add(jsonEncode({
      'type': 'subscribe',
      'matchId': matchId,
      if (_inningsId != null) 'inningsId': _inningsId,
      if (_lastSequence != null) 'sinceSequence': _lastSequence,
    }));
  }

  void _handleMessage(dynamic raw) {
    final Map<String, dynamic> msg = jsonDecode(raw as String) as Map<String, dynamic>;
    if (msg['type'] != 'delivery') return;

    final inningsId = msg['inningsId'] as String?;
    final delivery = msg['delivery'] as Map<String, dynamic>?;
    final sequence = delivery?['sequence'] as int?;
    if (inningsId != null) _inningsId = inningsId;
    if (sequence != null && (_lastSequence == null || sequence > _lastSequence!)) {
      _lastSequence = sequence;
    }

    _updatesController.add(null);
  }

  void _scheduleReconnect() {
    _subscription?.cancel();
    _channel = null;
    if (_disposed) return;
    _reconnectAttempt = (_reconnectAttempt + 1).clamp(0, 5);
    final delay = Duration(seconds: _reconnectAttempt * 2);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, connect);
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _updatesController.close();
  }
}

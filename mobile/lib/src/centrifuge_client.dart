import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

class CentrifugeEvent {
  final String type;
  final Map<String, dynamic> data;

  const CentrifugeEvent(this.type, this.data);

  @override
  String toString() => 'CentrifugeEvent(type: $type, data: $data)';
}

class CentrifugeClient {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;

  String? _url;
  String? _token;

  final Map<String, String> _subscriptionTokens = {};
  final Map<String, StreamController<CentrifugeEvent>> _channelControllers = {};
  final StreamController<CentrifugeEvent> _eventController =
      StreamController<CentrifugeEvent>.broadcast();

  int _messageId = 0;
  final Map<int, Completer<dynamic>> _pendingRequests = {};

  bool _connected = false;
  bool _intentionalDisconnect = false;
  Timer? _reconnectTimer;

  static const _maxReconnectDelay = Duration(seconds: 30);
  static const _initialReconnectDelay = Duration(milliseconds: 500);
  Duration _currentReconnectDelay = _initialReconnectDelay;

  Stream<CentrifugeEvent> get onEvent => _eventController.stream;

  bool get isConnected => _connected;

  Future<void> connect(String url, String token) async {
    _url = url;
    _token = token;
    _intentionalDisconnect = false;
    await _connect();
  }

  Future<void> disconnect() async {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _close();
  }

  Future<void> subscribe(String channel, String token) async {
    _subscriptionTokens[channel] = token;
    if (_connected) {
      await _sendSubscribe(channel, token);
    }
  }

  Future<void> unsubscribe(String channel) async {
    _subscriptionTokens.remove(channel);
    _channelControllers.remove(channel)?.close();
    if (_connected) {
      await _sendUnsubscribe(channel);
    }
  }

  Stream<CentrifugeEvent> channelStream(String channel) {
    _channelControllers.putIfAbsent(
      channel,
      () => StreamController<CentrifugeEvent>.broadcast(),
    );
    return _channelControllers[channel]!.stream;
  }

  Future<void> _connect() async {
    if (_url == null) return;

    final wsUrl = _url!.replaceFirst('http', 'ws');

    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _subscription = _channel!.stream.listen(
        _onMessage,
        onDone: _onDone,
        onError: _onError,
      );

      await _sendConnect();
      _connected = true;
      _currentReconnectDelay = _initialReconnectDelay;
    } catch (e) {
      _scheduleReconnect();
    }
  }

  Future<void> _close() async {
    _connected = false;
    await _subscription?.cancel();
    _subscription = null;
    await _channel?.sink.close();
    _channel = null;

    for (final completer in _pendingRequests.values) {
      if (!completer.isCompleted) {
        completer.completeError(Exception('Disconnected'));
      }
    }
    _pendingRequests.clear();
  }

  void _onMessage(dynamic raw) {
    if (raw is! String) return;

    final Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    if (msg.containsKey('push')) {
      _handlePush(msg['push'] as Map<String, dynamic>);
    }

    if (msg.containsKey('id') && msg.containsKey('connect')) {
      _handleConnectResponse(msg);
    }

    if (msg.containsKey('id') && msg.containsKey('sub')) {
      _handleSubscribeResponse(msg);
    }

    if (msg.containsKey('id') && msg.containsKey('unsub')) {
      _handleUnsubscribeResponse(msg);
    }

    if (msg.containsKey('id') && msg.containsKey('error')) {
      _handleError(msg);
    }

    final id = msg['id'];
    if (id != null && _pendingRequests.containsKey(id)) {
      final completer = _pendingRequests.remove(id);
      if (completer != null && !completer.isCompleted) {
        completer.complete(msg);
      }
    }
  }

  void _onDone() {
    _connected = false;
    _scheduleReconnect();
  }

  void _onError(Object error) {
    _connected = false;
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_intentionalDisconnect) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(_currentReconnectDelay, () {
      _currentReconnectDelay = Duration(
        milliseconds: min(
          _currentReconnectDelay.inMilliseconds * 2,
          _maxReconnectDelay.inMilliseconds,
        ),
      );
      _connect();
    });
  }

  int _nextId() => ++_messageId;

  Future<void> _sendConnect() async {
    final id = _nextId();
    final msg = {
      'id': id,
      'connect': {'token': _token},
    };
    _channel?.sink.add(jsonEncode(msg));

    final completer = Completer<dynamic>();
    _pendingRequests[id] = completer;

    try {
      await completer.future.timeout(const Duration(seconds: 10));
    } catch (_) {
      _pendingRequests.remove(id);
      rethrow;
    }

    for (final entry in _subscriptionTokens.entries) {
      await _sendSubscribe(entry.key, entry.value);
    }
  }

  Future<void> _sendSubscribe(String channel, String token) async {
    final id = _nextId();
    final msg = {
      'id': id,
      'subscribe': {'channel': channel, 'token': token},
    };
    _channel?.sink.add(jsonEncode(msg));
  }

  Future<void> _sendUnsubscribe(String channel) async {
    final id = _nextId();
    final msg = {
      'id': id,
      'unsubscribe': {'channel': channel},
    };
    _channel?.sink.add(jsonEncode(msg));
  }

  void _handleConnectResponse(Map<String, dynamic> msg) {
    final connect = msg['connect'] as Map<String, dynamic>?;
    if (connect != null && connect.containsKey('error')) {
      _eventController.addError(
        Exception('Connect error: ${connect['error']}'),
      );
    }
  }

  void _handleSubscribeResponse(Map<String, dynamic> msg) {
    final sub = msg['sub'] as Map<String, dynamic>?;
    if (sub != null && sub.containsKey('error')) {
      _eventController.addError(
        Exception('Subscribe error: ${sub['error']}'),
      );
    }
  }

  void _handleUnsubscribeResponse(Map<String, dynamic> msg) {
    // Unsubscribe acknowledged
  }

  void _handleError(Map<String, dynamic> msg) {
    final error = msg['error'];
    _eventController.addError(Exception('Server error: $error'));
  }

  void _handlePush(Map<String, dynamic> push) {
    final channel = push['channel'] as String?;
    final pub = push['pub'] as Map<String, dynamic>?;
    if (channel == null || pub == null) return;

    final data = pub['data'];
    if (data is! Map<String, dynamic>) return;

    final type = data['type'] as String?;
    final payload = data['data'];
    if (type == null) return;

    final event = CentrifugeEvent(
      type,
      payload is Map<String, dynamic> ? payload : <String, dynamic>{},
    );

    _eventController.add(event);

    final controller = _channelControllers[channel];
    if (controller != null && !controller.isClosed) {
      controller.add(event);
    }
  }

  Future<void> dispose() async {
    await disconnect();
    await _eventController.close();
    for (final controller in _channelControllers.values) {
      await controller.close();
    }
    _channelControllers.clear();
  }
}

// Сессия приложения: устройство, WebSocket, каналы, синхронизация ключей.
// Логика повторяет веб-клиент (web/src/stores/channels.ts) по docs/protocol.md.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'api_client.dart';
import 'crypto.dart';
import 'key_store.dart';
import 'settings.dart';

class WsEvent {
  final String type;
  final Map<String, dynamic> data;
  const WsEvent(this.type, this.data);
}

class Session extends ChangeNotifier {
  final AppSettings settings;
  final ApiClient api;
  final KeyStore keyStore = KeyStore();

  late final DeviceKeys device;

  List<Map<String, dynamic>> channels = [];
  int? currentChannelId;
  bool wsConnected = false;
  String? error;

  final _events = StreamController<WsEvent>.broadcast();
  Stream<WsEvent> get events => _events.stream;
  final List<int> _joined = [];

  WebSocketChannel? _ws;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnectTimer;
  Timer? _keyPollTimer;
  int _backoffSeconds = 2;
  bool _stopped = false;

  Session(this.settings, this.api);

  Future<void> start() async {
    device = await generateDeviceKeys();
    await api.uploadKey(device.deviceId, bytesToB64(device.publicKey));
    await refreshChannels();
    await syncAllKeys();
    connectWs();
    startKeyPoll();
  }

  Future<void> refreshChannels() async {
    try {
      channels = (await api.channels()).cast<Map<String, dynamic>>();
      notifyListeners();
    } catch (e) {
      error = e.toString();
      notifyListeners();
    }
  }

  void stop() {
    _stopped = true;
    _reconnectTimer?.cancel();
    _keyPollTimer?.cancel();
    _sub?.cancel();
    _ws?.sink.close();
    _events.close();
  }

  // ---------- WebSocket ----------

  void connectWs() {
    try {
      _ws = api.connectWs();
      _sub = _ws!.stream.listen(_onWsMessage, onDone: _onWsClosed, onError: (_) => _onWsClosed());
      wsConnected = true;
      _backoffSeconds = 2;
      notifyListeners();
      for (final id in _joined) {
        _send('channel.join', {'channel_id': id});
      }
    } catch (_) {
      _onWsClosed();
    }
  }

  void _onWsClosed() {
    if (_stopped) return;
    wsConnected = false;
    notifyListeners();
    _sub?.cancel();
    _ws?.sink.close();
    // Переподключение с ростом паузы: 2, 4, 8... до 30 с.
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: _backoffSeconds), () {
      if (_stopped) return;
      _backoffSeconds = _backoffSeconds.clamp(2, 30) * 2;
      connectWs();
    });
  }

  void _onWsMessage(dynamic raw) {
    try {
      final msg = jsonDecode(raw as String) as Map<String, dynamic>;
      final type = msg['type'] as String? ?? '';
      final data = (msg['data'] as Map<String, dynamic>?) ?? {};
      _events.add(WsEvent(type, data));
      _handleEvent(type, data);
    } catch (_) {
      /* битый кадр — игнорируем */
    }
  }

  void _handleEvent(String type, Map<String, dynamic> d) {
    switch (type) {
      case 'key.needed':
        _handleKeyNeeded(d);
      case 'key.granted':
        final ch = d['channel_id'];
        if (ch is int && ch == currentChannelId) syncKeys(ch);
      case 'device.registered':
        syncAllKeys();
      case 'channel.deleted':
      case 'role.changed':
        refreshChannels();
    }
  }

  void _send(String type, Map<String, dynamic> data) {
    _ws?.sink.add(jsonEncode({'type': type, 'data': data}));
  }

  void joinChannel(int channelId) {
    if (!_joined.contains(channelId)) {
      _joined.add(channelId);
      _send('channel.join', {'channel_id': channelId});
    }
  }

  void leaveChannel(int channelId) {
    _joined.remove(channelId);
    _send('channel.leave', {'channel_id': channelId});
  }

  // ---------- Ключи каналов ----------

  /// Синхронизация: получаем свой обёрнутый ключ, раздаём ключ новым устройствам.
  Future<void> syncKeys(int channelId) async {
    try {
      final wrapped = await api.myWrappedKey(channelId, device.deviceId);
      if (wrapped != null) {
        final key = await unwrapChannelKey(b64ToBytes(wrapped), device.privateKey);
        final had = await keyStore.loadChannelKey(channelId);
        await keyStore.saveChannelKey(channelId, key);
        if (had == null) notifyListeners(); // чат перечитает историю
      }
      final myKey = await keyStore.loadChannelKey(channelId);
      if (myKey == null) return;
      final targets = (await api.pendingKeyTargets(channelId)).cast<Map<String, dynamic>>();
      for (final t in targets) {
        final userId = (t['user_id'] as num?)?.toInt() ?? 0;
        final deviceId = (t['device_id'] as String?) ?? '';
        if (userId == settings.user?.id && deviceId == device.deviceId) continue;
        final pub = b64ToBytes((t['public_key'] as String?) ?? '');
        if (pub.isEmpty) continue;
        final wrappedKey = await wrapChannelKey(myKey, pub);
        await api.uploadWrappedKey(channelId, userId, deviceId, bytesToB64(wrappedKey));
      }
    } catch (_) {
      /* синхронизация повторится таймером */
    }
  }

  Future<void> syncAllKeys() async {
    for (final ch in channels) {
      final id = (ch['id'] as num?)?.toInt();
      if (id != null) await syncKeys(id);
    }
  }

  /// Создатель канала: генерирует ключ, если его ещё нет.
  Future<void> initChannelKey(int channelId) async {
    if (await keyStore.loadChannelKey(channelId) != null) return;
    final key = generateChannelKey();
    final wrapped = await wrapChannelKey(key, device.publicKey);
    await api.uploadWrappedKey(
        channelId, settings.user?.id ?? 0, device.deviceId, bytesToB64(wrapped));
    await keyStore.saveChannelKey(channelId, key);
    notifyListeners();
  }

  /// Событие key.needed: обернуть ключ канала для конкретного устройства.
  Future<void> _handleKeyNeeded(Map<String, dynamic> d) async {
    final channelId = (d['channel_id'] as num?)?.toInt();
    final deviceId = (d['device_id'] as String?) ?? '';
    final publicKey = (d['public_key'] as String?) ?? '';
    final userId = (d['user_id'] as num?)?.toInt();
    if (channelId == null || deviceId.isEmpty || publicKey.isEmpty) return;
    final myKey = await keyStore.loadChannelKey(channelId);
    if (myKey == null) return;
    final wrapped = await wrapChannelKey(myKey, b64ToBytes(publicKey));
    await api.uploadWrappedKey(channelId, userId ?? 0, deviceId, bytesToB64(wrapped));
  }

  /// Поллинг ключей открытого канала (страховка, как в вебе — 7 секунд).
  void startKeyPoll() {
    _keyPollTimer?.cancel();
    _keyPollTimer = Timer.periodic(const Duration(seconds: 7), (_) {
      final ch = currentChannelId;
      if (ch != null && wsConnected) syncKeys(ch);
    });
  }
}

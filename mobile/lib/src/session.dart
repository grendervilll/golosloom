// ignore_for_file: unnecessary_underscores
// Сессия приложения: Centrifugo, Signal Protocol, каналы.
// Заменяет WebSocket на Centrifugo, старые ключи каналов на Signal Protocol.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'centrifuge_client.dart';
import 'crypto.dart';
import 'key_store.dart';
import 'settings.dart';
import 'sounds.dart';

class WsEvent {
  final String type;
  final Map<String, dynamic> data;
  const WsEvent(this.type, this.data);
}

class Session extends ChangeNotifier {
  static Session? instance;

  final AppSettings settings;
  final ApiClient api;
  final KeyStore keyStore = KeyStore();

  final Map<int, Map<String, String>> users = {};

  late final String deviceId;
  IdentityKeyPair? identityKey;
  SignedPreKey? signedPreKey;

  List<Map<String, dynamic>> channels = [];
  int? currentChannelId;
  bool wsConnected = false;
  String? error;

  final _events = StreamController<WsEvent>.broadcast();
  Stream<WsEvent> get events => _events.stream;

  CentrifugeClient? _centrifuge;
  Timer? _reconnectTimer;
  int _backoffSeconds = 2;
  bool _stopped = false;
  ServerConfig? _serverConfig;

  Session(this.settings, this.api) {
    instance = this;
  }

  Future<void> start() async {
    deviceId = await keyStore.loadDeviceId() ?? generateDeviceId();
    await keyStore.saveDeviceId(deviceId);

    identityKey = await keyStore.loadIdentityKeyPair();
    if (identityKey == null) {
      identityKey = await generateIdentityKeyPair();
      await keyStore.saveIdentityKeyPair(identityKey!);
    }

    signedPreKey = await keyStore.loadSignedPreKey();
    if (signedPreKey == null) {
      signedPreKey = await generateSignedPreKey();
      await keyStore.saveSignedPreKey(signedPreKey!);
    }

    if ((await keyStore.listOneTimePreKeyIndices()).isEmpty) {
      final opks = await generateOneTimePreKeys(100);
      for (var i = 0; i < opks.length; i++) {
        await keyStore.saveOneTimePreKey(i, opks[i]);
      }
    }

    final opkPubKeys = <List<int>>[];
    for (final idx in await keyStore.listOneTimePreKeyIndices()) {
      final opk = await keyStore.loadOneTimePreKey(idx);
      if (opk != null) opkPubKeys.add(opk.publicKey);
    }

    await api.registerDevice(
      deviceId,
      identityKey!.publicKey,
      signedPreKey!.publicKey,
      opkPubKeys,
    );

    await refreshChannels();
    await refreshUsers();
    connectCentrifuge();
    // Загружаем кастомный рингтон сервера (если админ установил)
    AppSounds().loadCustomRingtone(api);
  }

  Future<void> refreshUsers() async {
    try {
      final list = (await api.users()).cast<Map<String, dynamic>>();
      for (final u in list) {
        final id = (u['id'] as num?)?.toInt();
        if (id == null) continue;
        users[id] = {
          'nick': (u['nick'] as String?) ?? '',
          'avatarAt': (u['avatar'] as String?) ?? '',
        };
      }
      notifyListeners();
    } catch (_) {}
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
    _centrifuge?.disconnect();
    _events.close();
  }

  // ---------- Centrifugo ----------

  void connectCentrifuge() {
    try {
      void doConnect(ServerConfig cfg) {
        if (_stopped) return;
        final centrifugoUrl = cfg.centrifugoUrl;
        if (centrifugoUrl == null || centrifugoUrl.isEmpty) return;

        api.centrifugoToken().then((res) {
          if (_stopped) return;
          final token = res['token'] as String?;
          if (token == null) return;

          _centrifuge?.disconnect();
          _centrifuge = CentrifugeClient();
          _centrifuge!.onEvent.listen(_handleCentrifugeEvent);
          _centrifuge!.connect(centrifugoUrl, token);
          wsConnected = true;
          _backoffSeconds = 2;
          notifyListeners();

          _subscribeToUserChannel();
          _subscribeToRingtone();
        }).catchError((Object e, StackTrace s) {
          _onCentrifugeClosed();
        });
      }

      if (_serverConfig != null) {
        doConnect(_serverConfig!);
      } else {
        api.config().then((cfg) {
          _serverConfig = cfg;
          doConnect(cfg);
        }).catchError((Object e, StackTrace s) {
          _onCentrifugeClosed();
        });
      }
    } catch (_) {
      _onCentrifugeClosed();
    }
  }

  void _onCentrifugeClosed() {
    if (_stopped) return;
    wsConnected = false;
    notifyListeners();
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: _backoffSeconds), () {
      if (_stopped) return;
      _backoffSeconds = (_backoffSeconds.clamp(2, 30) * 2);
      connectCentrifuge();
    });
  }

  void _handleCentrifugeEvent(CentrifugeEvent e) {
    _events.add(WsEvent(e.type, e.data));
    _handleEvent(e.type, e.data);
  }

  void _handleEvent(String type, Map<String, dynamic> d) {
    switch (type) {
      case 'session.needed':
        _handleSessionNeeded(d);
      case 'device.registered':
        _handleDeviceRegistered(d);
      case 'channel.deleted':
      case 'role.changed':
        refreshChannels();
    }
  }

  void _subscribeToUserChannel() async {
    final userId = settings.user?.id;
    if (userId == null) return;
    try {
      final res = await api.centrifugoSubscribe('user:$userId');
      final token = res['token'] as String?;
      if (token != null && !_stopped) {
        _centrifuge?.subscribe('user:$userId', token);
      }
    } catch (_) {}
  }

  Future<void> _subscribeToRingtone() async {
    try {
      final res = await api.centrifugoSubscribe('ringtone');
      final token = res['token'] as String?;
      if (token != null && !_stopped) {
        _centrifuge?.subscribe('ringtone', token);
      }
    } catch (_) {
      // Fallback: пробуем без токена (если allow_subscribe)
      try {
        _centrifuge?.subscribe('ringtone', '');
      } catch (_) {}
    }
  }

  void joinChannel(int channelId) async {
    try {
      final res = await api.centrifugoSubscribe('channel:$channelId');
      final token = res['token'] as String?;
      if (token != null && !_stopped) {
        _centrifuge?.subscribe('channel:$channelId', token);
      }
    } catch (_) {}
  }

  @visibleForTesting
  void debugEmitEvent(String type, Map<String, dynamic> data) {
    _events.add(WsEvent(type, data));
    _handleEvent(type, data);
  }

  void leaveChannel(int channelId) {
    _centrifuge?.unsubscribe('channel:$channelId');
  }

  // ---------- Signal Protocol ----------

  Future<void> _handleSessionNeeded(Map<String, dynamic> d) async {
    try {
      final opks = await generateOneTimePreKeys(20);
      final existing = await keyStore.listOneTimePreKeyIndices();
      final startIndex = existing.isEmpty ? 0 : existing.reduce((a, b) => a > b ? a : b) + 1;
      final pubKeys = <List<int>>[];
      for (var i = 0; i < opks.length; i++) {
        await keyStore.saveOneTimePreKey(startIndex + i, opks[i]);
        pubKeys.add(opks[i].publicKey);
      }
      await api.uploadPreKeys(deviceId, pubKeys);
    } catch (_) {}
  }

  void _handleDeviceRegistered(Map<String, dynamic> d) async {
    // When a new device registers, existing members deliver sender keys.
    // For now, refresh channels to pick up any changes.
    refreshChannels();
  }
}

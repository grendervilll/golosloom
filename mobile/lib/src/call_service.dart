// Звонки: состояние звонка, подключение к LiveKit, обработка WS-событий.
// Комната LiveKit — call-<id>, identity — <userId>:<deviceId> (из токена).
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
// Session из livekit_client конфликтует с нашей Session — скрываем.
import 'package:livekit_client/livekit_client.dart' hide Session;

import 'api_client.dart';
import 'session.dart';

class CallInfo {
  final int id;
  final int channelId;
  final String status; // ringing | active | ended
  final bool incoming;
  final String? initiatorNick;
  final List<int> participants;

  const CallInfo({
    required this.id,
    required this.channelId,
    this.status = 'ringing',
    this.incoming = false,
    this.initiatorNick,
    this.participants = const [],
  });

  factory CallInfo.fromJson(Map<String, dynamic> d) => CallInfo(
        id: (d['id'] as num?)?.toInt() ?? 0,
        channelId: (d['channel_id'] as num?)?.toInt() ?? 0,
        status: (d['status'] as String?) ?? 'ringing',
        initiatorNick: d['initiator_nick'] as String?,
      );

  CallInfo copyWith({
    String? status,
    List<int>? participants,
    bool? incoming,
    String? initiatorNick,
  }) =>
      CallInfo(
        id: id,
        channelId: channelId,
        status: status ?? this.status,
        incoming: incoming ?? this.incoming,
        initiatorNick: initiatorNick ?? this.initiatorNick,
        participants: participants ?? this.participants,
      );
}

class CallService extends ChangeNotifier {
  /// Глобальная точка доступа для плашки звонка на любом экране.
  static CallService? instance;

  final Session session;
  ServerConfig? _config;

  StreamSubscription<WsEvent>? _sub;
  Room? _room;
  CallInfo? currentCall; // активный звонок (мы в комнате)
  CallInfo? ringing; // входящий/исходящий звонок в ожидании
  bool micEnabled = true;
  String? callError;
  int _lastPunch = 0;

  CallService(this.session) {
    _sub = session.events.listen(_onEvent);
    instance = this;
  }

  bool get inCall => _room != null;
  Room? get room => _room;
  List<RemoteParticipant> get remoteParticipants =>
      _room?.remoteParticipants.values.toList() ?? [];

  DateTime? _startedAt;
  Duration get callDuration =>
      _startedAt == null ? Duration.zero : DateTime.now().difference(_startedAt!);

  @override
  void dispose() {
    _sub?.cancel();
    _room?.disconnect();
    super.dispose();
  }

  // ---------- WS-события ----------

  void _onEvent(WsEvent e) {
    switch (e.type) {
      case 'call.invite':
        ringing = CallInfo(
          id: (e.data['call_id'] as num?)?.toInt() ?? 0,
          channelId: (e.data['channel_id'] as num?)?.toInt() ?? 0,
          incoming: true,
          initiatorNick: e.data['initiator_nick'] as String?,
        );
        HapticFeedback.heavyImpact();
        notifyListeners();
      case 'call.created':
        // Инициатор: звонок создан, ждём ответа.
        final call = e.data['call'] as Map<String, dynamic>?;
        if (call != null) {
          ringing = CallInfo.fromJson(call)
              .copyWith(initiatorNick: e.data['caller_nick'] as String?);
          notifyListeners();
        }
      case 'call.started':
        if (ringing != null) ringing = ringing!.copyWith(status: 'active');
        notifyListeners();
      case 'call.ended':
        final id = (e.data['call_id'] as num?)?.toInt();
        if (ringing?.id == id) ringing = null;
        if (currentCall?.id == id) {
          _disconnectRoom();
        }
        notifyListeners();
      case 'call.participants':
        final id = (e.data['call_id'] as num?)?.toInt();
        final list = (e.data['participants'] as List?)?.cast<num>().map((x) => x.toInt()).toList() ?? const <int>[];
        if (currentCall?.id == id) currentCall = currentCall!.copyWith(participants: list);
        notifyListeners();
      case 'call.invite.timeout':
        final id = (e.data['call_id'] as num?)?.toInt();
        if (ringing?.id == id) {
          ringing = null;
          notifyListeners();
        }
      case 'punch':
        final now = DateTime.now().millisecondsSinceEpoch;
        if (now - _lastPunch > 3000) {
          _lastPunch = now;
          HapticFeedback.mediumImpact();
          notifyListeners();
        }
    }
  }

  // ---------- Действия ----------

  Future<bool> initiate(int channelId, List<int> targetIds) async {
    callError = null;
    try {
      final res = await session.api
          .createCall(channelId, targetIds, session.device.deviceId);
      final call = CallInfo.fromJson(res['call'] as Map<String, dynamic>);
      currentCall = call.copyWith(status: 'active');
      ringing = null;
      notifyListeners();
      await _connectRoom(res['token'] as String);
      return true;
    } catch (e) {
      callError = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> accept(CallInfo call) async {
    callError = null;
    try {
      final res =
          await session.api.acceptCall(call.id, session.device.deviceId);
      final accepted = CallInfo.fromJson(res['call'] as Map<String, dynamic>);
      currentCall = accepted.copyWith(status: 'active', incoming: true);
      ringing = null;
      notifyListeners();
      await _connectRoom(res['token'] as String);
      return true;
    } catch (e) {
      callError = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<void> decline(CallInfo call) async {
    ringing = null;
    notifyListeners();
    try {
      await session.api.declineCall(call.id);
    } catch (_) {}
  }

  Future<bool> join(int callId) async {
    callError = null;
    try {
      final res = await session.api.joinCall(callId, session.device.deviceId);
      currentCall = CallInfo.fromJson(res['call'] as Map<String, dynamic>)
          .copyWith(status: 'active');
      ringing = null;
      notifyListeners();
      await _connectRoom(res['token'] as String);
      return true;
    } catch (e) {
      callError = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<void> leave() async {
    final id = currentCall?.id;
    _disconnectRoom();
    if (id != null) {
      try {
        await session.api.leaveCall(id);
      } catch (_) {}
    }
  }

  Future<void> toggleMic() async {
    micEnabled = !micEnabled;
    notifyListeners();
    try {
      await _room?.localParticipant?.setMicrophoneEnabled(micEnabled);
    } catch (_) {}
  }

  // ---------- LiveKit ----------

  Future<ServerConfig> _getConfig() async => _config ??= await session.api.config();

  Future<void> _connectRoom(String token) async {
    final config = await _getConfig();
    await _disconnectRoom();
    final room = Room();
    _room = room;
    try {
      _startedAt = DateTime.now();
      await room.connect(
        config.livekitUrl,
        token,
        connectOptions: ConnectOptions(
          rtcConfiguration: RTCConfiguration(
            iceServers: [
              for (final url in config.turnUrls)
                RTCIceServer(
                  urls: [url],
                  username: config.turnUsername,
                  credential: config.turnCredential,
                ),
            ],
          ),
        ),
      );
      await room.localParticipant?.setMicrophoneEnabled(micEnabled);
    } catch (e) {
      _room = null;
      callError = 'Не удалось подключиться к звонку: $e';
      notifyListeners();
      rethrow;
    }
  }

  Future<void> _disconnectRoom() async {
    final r = _room;
    _room = null;
    currentCall = null;
    _startedAt = null;
    notifyListeners();
    if (r != null) {
      try {
        await r.disconnect();
      } catch (_) {}
    }
  }
}

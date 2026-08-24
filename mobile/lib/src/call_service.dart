// Звонки: состояние звонка, подключение к LiveKit, обработка WS-событий.
// Комната LiveKit — call-<id>, identity — <userId>:<deviceId> (из токена).
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
// Session из livekit_client конфликтует с нашей Session — скрываем.
import 'package:livekit_client/livekit_client.dart' hide Session;

import 'api_client.dart';
import 'session.dart';
import 'chat_store.dart';

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
  ChatStore? chat; // для системных сообщений (как web App.vue)
  ServerConfig? _config;

  StreamSubscription<WsEvent>? _sub;
  Room? _room;
  CallInfo? currentCall; // активный звонок (мы в комнате)
  CallInfo? ringing; // входящий/исходящий звонок в ожидании
  bool micEnabled = true;
  bool camEnabled = false;
  bool speakersMuted = false;
  String? callError;
  int _lastPunch = 0;
  bool _disposed = false;
  // Для системного сообщения call.ended (как web calls.connectedAt)
  DateTime? _connectedAt;
  final List<CallInfo> calls = []; // кэш для поиска channel_id как в web

  CallService(this.session, {this.chat}) {
    _sub = session.events.listen(_onEvent);
    session.addListener(_onSessionChanged);
    instance = this;
  }

  void setChatStore(ChatStore c) => chat = c;

  String callDurationText() {
    if (_connectedAt == null) return '';
    final d = DateTime.now().difference(_connectedAt!);
    final h = d.inHours;
    final m = d.inMinutes % 60;
    final s = d.inSeconds % 60;
    if (h > 0) return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  bool _wasConnected = false;

  /// После переподключения WS (например, приложение было в фоне) сверяем,
  /// что наш звонок ещё существует — сервер мог его завершить.
  void _onSessionChanged() {
    final connected = session.wsConnected;
    if (connected && !_wasConnected && inCall) {
      _syncCallState();
    }
    _wasConnected = connected;
  }

  Future<void> _syncCallState() async {
    final call = currentCall;
    if (call == null || _disposed) return;
    try {
      final list = await session.api.calls(call.channelId);
      final alive = list.any((c) => (c as Map<String, dynamic>)['id'] == call.id);
      if (!alive) {
        await _disconnectRoom();
      }
    } catch (_) {
      /* повторим при следующем подключении */
    }
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
    _disposed = true;
    _sub?.cancel();
    session.removeListener(_onSessionChanged);
    _room?.disconnect();
    super.dispose();
  }

  // ---------- WS-события ----------

  void _onEvent(WsEvent e) {
    if (_disposed) return;
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
          final ci = CallInfo.fromJson(call)
              .copyWith(initiatorNick: e.data['caller_nick'] as String?);
          ringing = ci;
          // кэш как в web
          final idx = calls.indexWhere((x) => x.id == ci.id);
          if (idx >= 0) {
            calls[idx] = ci;
          } else {
            calls.add(ci);
          }
          notifyListeners();
        }
      case 'call.started':
        if (ringing != null) ringing = ringing!.copyWith(status: 'active');
        final startedId = (e.data['call_id'] as num?)?.toInt();
        if (startedId != null) {
          final idxS = calls.indexWhere((x) => x.id == startedId);
          if (idxS >= 0) calls[idxS] = calls[idxS].copyWith(status: 'active');
        }
        _connectedAt ??= DateTime.now();
        _startedAt = DateTime.now();
        notifyListeners();
      case 'call.ended':
        final id = (e.data['call_id'] as num?)?.toInt();
        // Системное сообщение как в web/src/App.vue:56-77
        final startAt = _connectedAt;
        final startStr = startAt != null
            ? '${startAt.hour.toString().padLeft(2, '0')}:${startAt.minute.toString().padLeft(2, '0')}'
            : null;
        final endStr = '${DateTime.now().hour.toString().padLeft(2, '0')}:${DateTime.now().minute.toString().padLeft(2, '0')}';
        final dur = callDurationText();
        CallInfo? call;
        try {
          call = calls.firstWhere((x) => x.id == id);
        } catch (_) {}
        call ??= ringing?.id == id ? ringing : currentCall?.id == id ? currentCall : null;
        final channelId = call?.channelId ?? (e.data['channel_id'] as num?)?.toInt() ?? 0;
        if (ringing?.id == id) ringing = null;
        if (currentCall?.id == id) {
          _disconnectRoom();
        } else {
          // убрать из кэша
          calls.removeWhere((x) => x.id == id);
        }
        _connectedAt = null;
        notifyListeners();
        if (channelId != 0 && chat != null) {
          String text;
          if (startStr != null && dur.isNotEmpty) {
            text = 'Звонок: $startStr — $endStr ($dur)';
          } else if (dur.isNotEmpty) {
            text = 'Звонок завершён, длительность $dur';
          } else if (startStr != null) {
            text = 'Звонок завершён в $endStr, начался в $startStr';
          } else {
            text = 'Звонок завершён в $endStr';
          }
          // Защита от гонки: если звонок был active или имел участников — не считаем пропущенным,
          // даже если _connectedAt ещё не успел выставиться (быстрый decline).
          bool isMissed = startAt == null && dur.isEmpty;
          if (isMissed && call != null && (call.status == 'active' || call.participants.isNotEmpty)) {
            isMissed = false;
          }
          if (isMissed) {
            String chName = '';
            try {
              final ch = session.channels.firstWhere((c) => (c['id'] as num?)?.toInt() == channelId);
              chName = (ch['name'] as String?) ?? '';
            } catch (_) {}
            text = chName.isNotEmpty ? 'Пропущенный звонок в «$chName» в $endStr' : 'Пропущенный звонок в $endStr';
          }
          chat!.pushSystem(channelId, text);
        }
      case 'call.participants':
        final id = (e.data['call_id'] as num?)?.toInt();
        final list = (e.data['participants'] as List?)?.cast<num>().map((x) => x.toInt()).toList() ?? const <int>[];
        if (currentCall?.id == id) currentCall = currentCall!.copyWith(participants: list);
        final idx = calls.indexWhere((x) => x.id == id);
        if (idx >= 0) calls[idx] = calls[idx].copyWith(participants: list);
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
          .createCall(channelId, targetIds, session.deviceId);
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
          await session.api.acceptCall(call.id, session.deviceId);
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
      final res = await session.api.joinCall(callId, session.deviceId);
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

  Future<void> toggleCam() async {
    camEnabled = !camEnabled;
    notifyListeners();
    try {
      await _room?.localParticipant?.setCameraEnabled(camEnabled);
    } catch (_) {}
  }

  /// Глушит/возвращает звук всех собеседников (без микрофона).
  Future<void> toggleSpeakers() async {
    speakersMuted = !speakersMuted;
    notifyListeners();
    for (final p in remoteParticipants) {
      for (final pub in p.audioTrackPublications) {
        final track = pub.track;
        if (track == null) continue;
        try {
          if (speakersMuted) {
            await track.disable();
          } else {
            await track.enable();
          }
        } catch (_) {}
      }
    }
  }

  Future<void> inviteToCall(List<int> targetIds) async {
    final c = currentCall ?? ringing;
    if (c == null || targetIds.isEmpty) return;
    try {
      await session.api.inviteToCall(c.id, targetIds);
    } catch (e) {
      callError = e.toString();
      notifyListeners();
    }
  }

  Future<void> punch() async {
    final c = currentCall;
    if (c == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastPunch < 10000) return;
    _lastPunch = now;
    try {
      await session.api.punchCall(c.id);
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
      _connectedAt ??= _startedAt;
      // Фоновый сервис: звук звонка не прерывается при свёрнутом приложении.
      try {
        await FlutterForegroundTask.startService(
          serviceId: 1,
          notificationTitle: 'Golosloom',
          notificationText: 'Идёт звонок — микрофон и звук работают в фоне',
          callback: () {},
        );
      } catch (_) {}
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
    if (_disposed) return;
    final r = _room;
    _room = null;
    currentCall = null;
    _startedAt = null;
    try {
      await FlutterForegroundTask.stopService();
    } catch (_) {}
    if (_disposed) return;
    notifyListeners();
    if (r != null) {
      try {
        await r.disconnect();
      } catch (_) {}
    }
  }
}

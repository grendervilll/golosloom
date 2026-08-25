// Звуки приложения: уведомление о новом сообщении + кастомный рингтон звонка.
library;

import 'package:audioplayers/audioplayers.dart';

import 'api_client.dart';

class AppSounds {
  static final AppSounds _i = AppSounds._();
  factory AppSounds() => _i;
  AppSounds._();

  final AudioPlayer _message = AudioPlayer();
  final AudioPlayer _ringtone = AudioPlayer();
  bool _loaded = false;
  String? _customRingtoneHash;
  String? _customRingtoneUrl;

  Future<void> _ensure() async {
    if (_loaded) return;
    await _message.setSource(AssetSource('sounds/message.wav'));
    _loaded = true;
  }

  /// Мягкий «блип» на чужое сообщение в открытом канале.
  Future<void> message() async {
    try {
      await _ensure();
      await _message.resume();
    } catch (_) {}
  }

  /// Загрузка кастомного рингтона сервера (если админ установил).
  Future<void> loadCustomRingtone(ApiClient api) async {
    try {
      final info = await api.ringtoneInfo();
      final exists = info['exists'] as bool? ?? false;
      final hash = info['hash'] as String? ?? '';
      if (!exists || hash.isEmpty) {
        _customRingtoneHash = null;
        _customRingtoneUrl = null;
        try { await _ringtone.stop(); } catch (_) {}
        return;
      }
      if (hash == _customRingtoneHash && _customRingtoneUrl != null) return;
      final bytes = await api.fetchRingtone();
      await _ringtone.setSourceBytes(bytes);
      _customRingtoneHash = hash;
      _customRingtoneUrl = 'custom:$hash';
    } catch (_) {}
  }

  void handleRingtoneUpdated(Map<String, dynamic> data, ApiClient api) {
    final hash = data['hash'] as String? ?? '';
    if (hash.isEmpty) {
      _customRingtoneHash = null;
      _customRingtoneUrl = null;
      try { _ringtone.stop(); } catch (_) {}
      return;
    }
    if (hash == _customRingtoneHash) return;
    loadCustomRingtone(api);
  }

  Future<void> playRingtone() async {
    try {
      if (_customRingtoneHash != null) {
        await _ringtone.setReleaseMode(ReleaseMode.loop);
        await _ringtone.resume();
      }
    } catch (_) {}
  }

  Future<void> stopRingtone() async {
    try {
      await _ringtone.stop();
    } catch (_) {}
  }
}

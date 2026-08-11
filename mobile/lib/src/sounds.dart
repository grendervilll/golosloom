// Звуки приложения: уведомление о новом сообщении.
library;

import 'package:audioplayers/audioplayers.dart';

class AppSounds {
  static final AppSounds _i = AppSounds._();
  factory AppSounds() => _i;
  AppSounds._();

  final AudioPlayer _message = AudioPlayer();
  bool _loaded = false;

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
}

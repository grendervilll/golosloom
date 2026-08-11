// Чат: сообщения канала (расшифрованные), история, отправка, правка, удаление.
// Подписки на события сессии (message.new/edited/deleted, key.granted).
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'crypto.dart';
import 'session.dart';

class ChatMessage {
  final int id;
  final int channelId;
  final int senderId;
  final String senderNick;
  final String? text;
  final bool encrypted;
  final bool deleted;
  final bool edited;
  final DateTime createdAt;
  final bool pending;

  const ChatMessage({
    required this.id,
    required this.channelId,
    required this.senderId,
    required this.senderNick,
    this.text,
    this.encrypted = false,
    this.deleted = false,
    this.edited = false,
    required this.createdAt,
    this.pending = false,
  });

  ChatMessage copyWith({String? text, bool? encrypted, bool? deleted, bool? edited, bool? pending}) {
    return ChatMessage(
      id: id,
      channelId: channelId,
      senderId: senderId,
      senderNick: senderNick,
      text: text ?? this.text,
      encrypted: encrypted ?? this.encrypted,
      deleted: deleted ?? this.deleted,
      edited: edited ?? this.edited,
      createdAt: createdAt,
      pending: pending ?? this.pending,
    );
  }
}

class ChatStore extends ChangeNotifier {
  final Session session;
  final Map<int, List<ChatMessage>> _byChannel = {};
  final Set<int> _loadingOlder = {};
  StreamSubscription<WsEvent>? _sub;
  int _lastTempId = 0;

  ChatStore(this.session) {
    _sub = session.events.listen(_onEvent);
  }

  List<ChatMessage> messages(int channelId) => _byChannel[channelId] ?? const [];

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  // ---------- История ----------

  Future<void> loadHistory(int channelId, {bool force = false}) async {
    if (!force && (_byChannel[channelId]?.isNotEmpty ?? false)) return;
    try {
      final raw = (await session.api.messages(channelId)).cast<Map<String, dynamic>>();
      final list = <ChatMessage>[];
      for (final m in raw) {
        list.add(await _toMessage(m));
      }
      _byChannel[channelId] = list;
      notifyListeners();
    } catch (_) {
      /* история загрузится при повторной попытке */
    }
  }

  Future<void> loadOlder(int channelId) async {
    final list = _byChannel[channelId];
    if (list == null || list.isEmpty || _loadingOlder.contains(channelId)) return;
    _loadingOlder.add(channelId);
    try {
      final raw = (await session.api.messages(channelId, beforeId: list.first.id))
          .cast<Map<String, dynamic>>();
      final older = <ChatMessage>[];
      for (final m in raw) {
        older.add(await _toMessage(m));
      }
      _byChannel[channelId] = [...older, ...list];
      notifyListeners();
    } catch (_) {
      /* повторим при следующем скролле */
    } finally {
      _loadingOlder.remove(channelId);
    }
  }

  // ---------- Отправка / правка / удаление ----------

  /// Оптимистичная отправка: своё сообщение появляется сразу (pending).
  Future<bool> send(int channelId, String text) async {
    final key = await session.keyStore.loadChannelKey(channelId);
    if (key == null) return false;
    final (ciphertext: ct, iv: iv) = await encryptMessage(key, text);
    final user = session.settings.user;
    final pending = ChatMessage(
      id: --_lastTempId,
      channelId: channelId,
      senderId: user?.id ?? 0,
      senderNick: user?.nick ?? '',
      text: text,
      createdAt: DateTime.now(),
      pending: true,
    );
    final list = [...(_byChannel[channelId] ?? const <ChatMessage>[]), pending];
    _byChannel[channelId] = list;
    notifyListeners();
    try {
      final res = await session.api.sendMessage(
          channelId, bytesToB64(ct), bytesToB64(iv));
      final real = await _toMessage(res);
      final cur = _byChannel[channelId] ?? [];
      final idx = cur.indexWhere((m) => m.id == pending.id);
      if (idx >= 0) {
        cur[idx] = real;
        notifyListeners();
      }
      return true;
    } catch (_) {
      // Оставляем pending — повторится вручную; метку снимет следующий апдейт.
      return false;
    }
  }

  Future<void> edit(int channelId, int messageId, String text) async {
    final key = await session.keyStore.loadChannelKey(channelId);
    if (key == null) return;
    final (ciphertext: ct, iv: iv) = await encryptMessage(key, text);
    try {
      final res = await session.api.editMessage(
          channelId, messageId, bytesToB64(ct), bytesToB64(iv));
      _applyMessage(_byChannel[channelId], res);
    } catch (_) {
      /* событие message.edited придёт по WS */
    }
  }

  Future<void> remove(int channelId, int messageId) async {
    try {
      await session.api.deleteMessage(channelId, messageId);
    } catch (_) {
      /* событие message.deleted придёт по WS */
    }
  }

  // ---------- События WS ----------

  void _onEvent(WsEvent e) {
    switch (e.type) {
      case 'message.new':
        _handleNew(e.data);
      case 'message.edited':
        _applyMessage(_byChannel[channelIdOf(e.data)], e.data);
      case 'message.deleted':
        _applyMessage(_byChannel[channelIdOf(e.data)], e.data);
      case 'key.granted':
        final ch = e.data['channel_id'];
        if (ch is int) loadHistory(ch, force: true);
    }
  }

  int? channelIdOf(Map<String, dynamic> d) => (d['channel_id'] as num?)?.toInt();

  Future<void> _handleNew(Map<String, dynamic> d) async {
    final ch = channelIdOf(d);
    if (ch == null) return;
    final m = await _toMessage(d);
    final list = _byChannel[ch] ?? [];
    if (list.any((x) => x.id == m.id)) return;
    _byChannel[ch] = [...list, m];
    notifyListeners();
  }

  void _applyMessage(List<ChatMessage>? list, Map<String, dynamic> d) {
    final id = (d['id'] as num?)?.toInt();
    if (list == null || id == null) return;
    final idx = list.indexWhere((m) => m.id == id);
    if (idx < 0) return;
    _toMessage(d).then((m) {
      list[idx] = m;
      notifyListeners();
    });
  }

  Future<ChatMessage> _toMessage(Map<String, dynamic> d) async {
    final channelId = (d['channel_id'] as num?)?.toInt() ?? 0;
    final key = await session.keyStore.loadChannelKey(channelId);
    final deleted = (d['deleted'] as bool?) ?? false;
    String? text;
    var encrypted = false;
    if (!deleted && key != null) {
      try {
        text = await decryptMessage(
          key,
          b64ToBytes((d['ciphertext'] as String?) ?? ''),
          b64ToBytes((d['iv'] as String?) ?? ''),
        );
      } catch (_) {
        encrypted = true;
      }
    } else if (!deleted) {
      encrypted = true;
    }
    return ChatMessage(
      id: (d['id'] as num?)?.toInt() ?? 0,
      channelId: channelId,
      senderId: (d['sender_id'] as num?)?.toInt() ?? 0,
      senderNick: (d['sender_nick'] as String?) ?? '?',
      text: text,
      encrypted: encrypted,
      deleted: deleted,
      edited: d['edited_at'] != null,
      createdAt: DateTime.tryParse((d['created_at'] as String?) ?? '') ?? DateTime.now(),
    );
  }
}

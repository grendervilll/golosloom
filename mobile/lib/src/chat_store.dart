// Чат: сообщения канала (расшифрованные), история, отправка, правка, удаление.
// Подписки на события сессии (message.new/edited/deleted, key.granted).
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import 'crypto.dart';
import 'session.dart';
import 'sounds.dart';

// Вложение сообщения (файл на сервере).
class Attachment {
  final int id;
  final String filename;
  final String mime;
  final int size;

  const Attachment({
    required this.id,
    required this.filename,
    required this.mime,
    required this.size,
  });

  factory Attachment.fromJson(Map<String, dynamic> d) => Attachment(
        id: (d['id'] as num?)?.toInt() ?? 0,
        filename: (d['filename'] as String?) ?? 'файл',
        mime: (d['mime'] as String?) ?? 'application/octet-stream',
        size: (d['size'] as num?)?.toInt() ?? 0,
      );
}

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
  final List<Attachment> attachments;
  final bool attachmentDeleted;

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
    this.attachments = const [],
    this.attachmentDeleted = false,
  });

  ChatMessage copyWith({
    String? text,
    bool? encrypted,
    bool? deleted,
    bool? edited,
    bool? pending,
    List<Attachment>? attachments,
    bool? attachmentDeleted,
  }) {
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
      attachments: attachments ?? this.attachments,
      attachmentDeleted: attachmentDeleted ?? this.attachmentDeleted,
    );
  }
}

class ChatStore extends ChangeNotifier {
  final Session session;
  final Map<int, List<ChatMessage>> _byChannel = {};
  final Map<int, int> _unread = {};
  final Set<int> _loadingOlder = {};
  StreamSubscription<WsEvent>? _sub;
  int _lastTempId = 0;

  ChatStore(this.session) {
    _sub = session.events.listen(_onEvent);
  }

  List<ChatMessage> messages(int channelId) => _byChannel[channelId] ?? const [];

  /// Непрочитанные сообщения канала (сбрасываются при открытии/загрузке).
  int unread(int channelId) => _unread[channelId] ?? 0;

  /// Последнее сообщение канала (для превью в списке чатов).
  Future<ChatMessage?> fetchLast(int channelId) async {
    try {
      final raw = (await session.api.messages(channelId, limit: 1))
          .cast<Map<String, dynamic>>();
      if (raw.isEmpty) return null;
      return await _toMessage(raw.first);
    } catch (_) {
      return null;
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  // ---------- История ----------

  Future<void> loadHistory(int channelId, {bool force = false}) async {
    if (!force && (_byChannel[channelId]?.isNotEmpty ?? false)) return;
    _unread[channelId] = 0; // канал открыт — прочитан
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
  /// attachments — уже загруженные на сервер вложения.
  Future<bool> send(int channelId, String text, {List<Attachment> attachments = const []}) async {
    String ciphertext;
    String iv;
    int protocolVersion = 2;

    final senderKeyData = await session.keyStore.loadSenderKey(channelId.toString());
    if (senderKeyData != null) {
      final sk = SenderKeyState.fromMap(senderKeyData);
      final (ciphertext: ct, iv: ivBytes) = await encryptSenderKeyMessage(sk, text);
      ciphertext = bytesToB64(ct);
      iv = bytesToB64(ivBytes);
    } else {
      final key = await session.keyStore.loadChannelKey(channelId);
      if (key == null) return false;
      final (ciphertext: ct, iv: ivBytes) = await encryptMessage(key, text);
      ciphertext = bytesToB64(ct);
      iv = bytesToB64(ivBytes);
      protocolVersion = 1;
    }

    final user = session.settings.user;
    final pending = ChatMessage(
      id: --_lastTempId,
      channelId: channelId,
      senderId: user?.id ?? 0,
      senderNick: user?.nick ?? '',
      text: text,
      createdAt: DateTime.now(),
      pending: true,
      attachments: attachments,
    );
    final list = [...(_byChannel[channelId] ?? const <ChatMessage>[]), pending];
    _byChannel[channelId] = list;
    notifyListeners();
    try {
      final res = await session.api.sendMessage(
          channelId, ciphertext, iv,
          attachmentIds: attachments.map((a) => a.id).toList(),
          protocolVersion: protocolVersion);
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
    String ciphertext;
    String iv;
    int protocolVersion = 2;

    final senderKeyData = await session.keyStore.loadSenderKey(channelId.toString());
    if (senderKeyData != null) {
      final sk = SenderKeyState.fromMap(senderKeyData);
      final (ciphertext: ct, iv: ivBytes) = await encryptSenderKeyMessage(sk, text);
      ciphertext = bytesToB64(ct);
      iv = bytesToB64(ivBytes);
    } else {
      final key = await session.keyStore.loadChannelKey(channelId);
      if (key == null) return;
      final (ciphertext: ct, iv: ivBytes) = await encryptMessage(key, text);
      ciphertext = bytesToB64(ct);
      iv = bytesToB64(ivBytes);
      protocolVersion = 1;
    }

    try {
      final res = await session.api.editMessage(
          channelId, messageId, ciphertext, iv, protocolVersion: protocolVersion);
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
      case 'attachment.deleted':
        _handleAttachmentDeleted(e.data);
      case 'key.granted':
        final ch = e.data['channel_id'];
        if (ch is int) loadHistory(ch, force: true);
    }
  }

  // Вложения сообщения удалены администратором: стёртые исчезают,
  // оставшиеся приходят в событии.
  void _handleAttachmentDeleted(Map<String, dynamic> d) {
    final ch = channelIdOf(d);
    final id = (d['message_id'] as num?)?.toInt();
    if (ch == null || id == null) return;
    final list = _byChannel[ch];
    if (list == null) return;
    final idx = list.indexWhere((m) => m.id == id);
    if (idx < 0) return;
    final remaining = ((d['attachments'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(Attachment.fromJson)
        .toList();
    list[idx] = list[idx].copyWith(
      attachments: remaining,
      attachmentDeleted: (d['attachment_deleted'] as bool?) ?? remaining.isEmpty,
    );
    notifyListeners();
  }

  int? channelIdOf(Map<String, dynamic> d) => (d['channel_id'] as num?)?.toInt();

  Future<void> _handleNew(Map<String, dynamic> d) async {
    final ch = channelIdOf(d);
    if (ch == null) return;
    final m = await _toMessage(d);
    final list = _byChannel[ch] ?? [];
    if (list.any((x) => x.id == m.id)) return;
    _byChannel[ch] = [...list, m];
    // Непрочитанное: чужое сообщение в канал, который сейчас не открыт.
    if (ch != session.currentChannelId && m.senderId != session.settings.user?.id) {
      _unread[ch] = (_unread[ch] ?? 0) + 1;
    }
    // Звук на чужое сообщение в открытом канале.
    if (ch == session.currentChannelId && m.senderId != session.settings.user?.id) {
      AppSounds().message();
    }
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
    final protocolVersion = (d['protocol_version'] as num?)?.toInt() ?? 1;
    final deleted = (d['deleted'] as bool?) ?? false;
    String? text;
    var encrypted = false;

    if (!deleted) {
      try {
        if (protocolVersion == 2) {
          final senderKeyData = await session.keyStore.loadSenderKey(channelId.toString());
          if (senderKeyData != null) {
            final ciphertext = Uint8List.fromList(b64ToBytes((d['ciphertext'] as String?) ?? ''));
            final ivBytes = Uint8List.fromList(b64ToBytes((d['iv'] as String?) ?? ''));
            final msgNumber = (d['message_number'] as num?)?.toInt() ?? 0;
            text = await decryptSenderKeyMessage(
              senderKeyData['chainKey'] as List<int>,
              ciphertext,
              ivBytes,
              msgNumber,
            );
          }
        } else {
          final key = await session.keyStore.loadChannelKey(channelId);
          if (key != null) {
            text = await decryptMessage(
              key,
              b64ToBytes((d['ciphertext'] as String?) ?? ''),
              b64ToBytes((d['iv'] as String?) ?? ''),
            );
          } else {
            encrypted = true;
          }
        }
      } catch (_) {
        encrypted = true;
      }
    } else if (!deleted) {
      encrypted = true;
    }
    final attachmentsRaw = (d['attachments'] as List?) ??
        (d['attachment'] != null ? [d['attachment']] : null);
    final attachments = (attachmentsRaw ?? const [])
        .cast<Map<String, dynamic>>()
        .map(Attachment.fromJson)
        .toList();
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
      attachments: attachments,
      attachmentDeleted: (d['attachment_deleted'] as bool?) ?? false,
    );
  }
}

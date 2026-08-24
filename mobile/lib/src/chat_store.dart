// Чат: сообщения канала (расшифрованные), история, отправка, правка, удаление.
// Подписки на события сессии (message.new/edited/deleted, key.granted).
library;

import 'dart:async';

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
  final bool system;
  final int? replyToId;
  final String? original;

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
    this.system = false,
    this.replyToId,
    this.original,
  });

  ChatMessage copyWith({
    String? text,
    bool? encrypted,
    bool? deleted,
    bool? edited,
    bool? pending,
    List<Attachment>? attachments,
    bool? attachmentDeleted,
    bool? system,
    int? replyToId,
    String? original,
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
      system: system ?? this.system,
      replyToId: replyToId ?? this.replyToId,
      original: original ?? this.original,
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

  // Typing: channel -> userId -> until
  final Map<int, Map<int, TypingEntry>> _typers = {};
  int _typingLastSent = 0;
  final Map<int, Timer> _typingTimers = {};

  ChatStore(this.session) {
    _sub = session.events.listen(_onEvent);
  }

  List<ChatMessage> messages(int channelId) => _byChannel[channelId] ?? const [];

  /// Непрочитанные сообщения канала (сбрасываются при открытии/загрузке).
  int unread(int channelId) => _unread[channelId] ?? 0;

  /// Пользователи, которые печатают в канале (отсортированы по нику).
  List<TypingEntry> typingUsers(int channelId) {
    final m = _typers[channelId];
    if (m == null) return const [];
    final now = DateTime.now().millisecondsSinceEpoch;
    final list = m.values.where((e) => e.until > now).toList()
      ..sort((a, b) => a.nick.compareTo(b.nick));
    return list;
  }

  /// Отправить событие typing (троттлинг 2.5с как в web).
  void typing(int channelId) {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _typingLastSent < 2500) return;
    _typingLastSent = now;
    session.api.sendTyping(channelId).catchError((_) {});
  }

  void handleTyping(Map<String, dynamic> d) {
    final channelId = (d['channel_id'] as num?)?.toInt();
    final userId = (d['user_id'] as num?)?.toInt();
    final nick = d['nick'] as String? ?? d['user_nick'] as String? ?? '?';
    if (channelId == null || userId == null) return;
    // Не показываем себя
    if (userId == session.settings.user?.id) return;
    final until = DateTime.now().millisecondsSinceEpoch + 5000;
    final map = _typers.putIfAbsent(channelId, () => {});
    map[userId] = TypingEntry(userId: userId, nick: nick, until: until);
    notifyListeners();
    _typingTimers[channelId]?.cancel();
    _typingTimers[channelId] = Timer(const Duration(milliseconds: 5100), () {
      final mm = _typers[channelId];
      if (mm != null) {
        mm.removeWhere((_, v) => v.until <= DateTime.now().millisecondsSinceEpoch);
        if (mm.isEmpty) _typers.remove(channelId);
      }
      notifyListeners();
    });
  }

  void pushSystem(int channelId, String text) {
    final list = _byChannel[channelId] ?? [];
    // Дедуп по тексту и времени (как в web)
    if (list.isNotEmpty && list.last.system && list.last.text == text) return;
    final msg = ChatMessage(
      id: --_lastTempId,
      channelId: channelId,
      senderId: 0,
      senderNick: '',
      text: text,
      createdAt: DateTime.now(),
      system: true,
    );
    _byChannel[channelId] = [...list, msg];
    notifyListeners();
  }

  bool searchBusy = false;
  int _searchGen = 0;

  /// Поиск как в web chat.ts — скан расшифрованного текста+имени файла, до 12 страниц, макс 100 результатов.
  /// С yield каждые 10 сообщений, чтобы не блокировать UI, и отмена предыдущего поиска.
  Future<List<ChatMessage>> searchMessages(int channelId, String query) async {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return [];
    final gen = ++_searchGen;
    searchBusy = true;
    notifyListeners();
    try {
      final res = <ChatMessage>[];
      // Собираем всё: уже загруженное + догружаем страницы
      final seen = <int>{};
      List<ChatMessage> all = [...(_byChannel[channelId] ?? const <ChatMessage>[])];
      // Текущий список уже есть, проверим его
      for (final m in all) {
        if (res.length >= 100) break;
        if (m.encrypted || m.deleted || m.system) continue;
        final txt = (m.text ?? '').toLowerCase();
        final filenames = m.attachments.map((a) => a.filename.toLowerCase()).join(' ');
        if (txt.contains(q) || filenames.contains(q)) {
          if (seen.add(m.id)) res.add(m);
        }
      }
      // Догружаем страницы по beforeId (как web)
      int? beforeId = all.isNotEmpty ? all.first.id : null;
      for (var page = 0; page < 12 && res.length < 100; page++) {
        if (gen != _searchGen) return [];
        try {
          final raw = (await session.api.messages(channelId, beforeId: beforeId, limit: 50)).cast<Map<String, dynamic>>();
          if (raw.isEmpty) break;
          final msgs = <ChatMessage>[];
          for (var i = 0; i < raw.length; i++) {
            if (i % 10 == 0) await Future<void>.delayed(Duration.zero);
            msgs.add(await _toMessage(raw[i]));
          }
          if (msgs.isEmpty) break;
          for (final m in msgs) {
            if (res.length >= 100) break;
            if (m.encrypted || m.deleted || m.system) continue;
            final txt = (m.text ?? '').toLowerCase();
            final filenames = m.attachments.map((a) => a.filename.toLowerCase()).join(' ');
            if (txt.contains(q) || filenames.contains(q)) {
              if (seen.add(m.id)) res.add(m);
            }
          }
          // добавляем в all для дальнейшей пагинации
          all = [...msgs, ...all];
          beforeId = msgs.first.id;
          if (raw.length < 50) break;
        } catch (_) {
          break;
        }
      }
      if (gen != _searchGen) return [];
      // Сортируем по времени (старые первые как в web)
      res.sort((a, b) => a.createdAt.compareTo(b.createdAt));
      return res;
    } finally {
      if (gen == _searchGen) {
        searchBusy = false;
        notifyListeners();
      }
    }
  }

  /// Медиа канала (фото+видео) для вкладки как в web ChannelSidebar media
  List<ChatMessage> mediaMessages(int channelId) {
    final list = _byChannel[channelId] ?? const [];
    return list.where((m) => m.attachments.any((a) => a.mime.startsWith('image/') || a.mime.startsWith('video/'))).toList();
  }

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
    for (final t in _typingTimers.values) {
      t.cancel();
    }
    _typingTimers.clear();
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
  Future<bool> send(int channelId, String text, {List<Attachment> attachments = const [], int? replyToId}) async {
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
      replyToId: replyToId,
    );
    final list = [...(_byChannel[channelId] ?? const <ChatMessage>[]), pending];
    _byChannel[channelId] = list;
    notifyListeners();
    try {
      final res = await session.api.sendMessage(
          channelId, ciphertext, iv,
          attachmentIds: attachments.map((a) => a.id).toList(),
          protocolVersion: protocolVersion,
          replyToId: replyToId ?? 0);
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
      case 'typing':
        handleTyping(e.data);
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
              Uint8List.fromList(senderKeyData['chainKey'] as List<int>),
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
      system: (d['system'] as bool?) ?? false,
      replyToId: (d['reply_to_id'] as num?)?.toInt(),
      original: d['original'] as String?,
    );
  }
}

class TypingEntry {
  final int userId;
  final String nick;
  final int until;
  const TypingEntry({required this.userId, required this.nick, required this.until});
}

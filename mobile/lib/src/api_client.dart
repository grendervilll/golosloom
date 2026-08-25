// REST-клиент Golosloom. Форматы — по docs/protocol.md.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

class ServerConfig {
  final String livekitUrl;
  final String? centrifugoUrl;
  final int maxMessageLen;
  final String? vapidPublicKey;
  final List<String> turnUrls;
  final String turnUsername;
  final String turnCredential;

  const ServerConfig({
    required this.livekitUrl,
    required this.maxMessageLen,
    this.centrifugoUrl,
    this.vapidPublicKey,
    this.turnUrls = const [],
    this.turnUsername = '',
    this.turnCredential = '',
  });

  factory ServerConfig.fromJson(Map<String, dynamic> j) {
    final turn = (j['turn'] as Map<String, dynamic>?) ?? const {};
    return ServerConfig(
      livekitUrl: (j['livekit_url'] as String?) ?? '',
      centrifugoUrl: j['centrifugo_url'] as String?,
      maxMessageLen: (j['max_message_len'] as num?)?.toInt() ?? 2000,
      vapidPublicKey: j['vapid_public_key'] as String?,
      turnUrls: ((turn['urls'] as List?) ?? []).cast<String>(),
      turnUsername: (turn['username'] as String?) ?? '',
      turnCredential: (turn['credential'] as String?) ?? '',
    );
  }
}

class ApiClient {
  final String baseUrl;
  String? token;
  // Вызывается при 401: токен истёк (TTL сутки) или пароль сменили —
  // приложение разлогинивается.
  void Function()? onUnauthorized;
  final http.Client _http = http.Client();
  // Короткоживущий файловый токен (5 минут): в URL файлов попадает он,
  // а не основной JWT (утёкшая ссылка не даёт доступ к аккаунту).
  String? _fileToken;
  DateTime? _fileTokenExpires;
  Timer? _fileTokenTimer;

  ApiClient(this.baseUrl);

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> _request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final req = http.Request(method, _uri(path));
    req.headers.addAll(_headers);
    if (body != null) req.body = jsonEncode(body);
    final streamed = await _http.send(req).timeout(const Duration(seconds: 15));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode == 401) {
      onUnauthorized?.call();
      throw ApiException(401, 'Сессия истекла — войдите заново');
    }
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _errorText(res.body));
    }
    if (res.body.isEmpty) return null;
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  String _errorText(String body) {
    try {
      final j = jsonDecode(body);
      if (j is Map && j['error'] is String) return j['error'] as String;
      if (j is Map && j['message'] is String) return j['message'] as String;
    } catch (_) {}
    return 'Ошибка сервера ($body)';
  }

  // --- Без авторизации ---
  Future<ServerConfig> config() async {
    final j = await _request('GET', '/api/config') as Map<String, dynamic>;
    return ServerConfig.fromJson(j);
  }

  Future<String> login(String nick, String password) async {
    final j = await _request('POST', '/api/login', {'nick': nick, 'password': password})
        as Map<String, dynamic>;
    token = j['token'] as String?;
    if (token == null) throw ApiException(0, 'Сервер не вернул токен');
    return token!;
  }

  Future<Map<String, dynamic>> register(String nick, String password, {String? invite}) async {
    final j = await _request('POST', '/api/register', {
      'nick': nick,
      'password': password,
      if (invite != null && invite.isNotEmpty) 'invite': invite,
    }) as Map<String, dynamic>;
    return j;
  }

  // --- Авторизованные ---
  Future<Map<String, dynamic>> me() async {
    return await _request('GET', '/api/me') as Map<String, dynamic>;
  }

  Future<List<dynamic>> channels() async {
    return await _request('GET', '/api/channels') as List<dynamic>;
  }

  Future<Map<String, dynamic>> createChannel(String name, bool isPrivate) async {
    return await _request('POST', '/api/channels', {'name': name, 'private': isPrivate})
        as Map<String, dynamic>;
  }

  Future<void> joinChannel(int channelId) async {
    await _request('POST', '/api/channels/$channelId/join');
  }

  Future<List<dynamic>> members(int channelId) async {
    return await _request('GET', '/api/channels/$channelId/members') as List<dynamic>;
  }

  Future<List<dynamic>> messages(int channelId, {int? beforeId, int limit = 50}) async {
    final q = beforeId == null ? '?limit=$limit' : '?before_id=$beforeId&limit=$limit';
    return await _request('GET', '/api/channels/$channelId/messages$q') as List<dynamic>;
  }

  Future<Map<String, dynamic>> sendMessage(
    int channelId,
    String ciphertext,
    String iv, {
    List<int> attachmentIds = const [],
    int replyToId = 0,
    int protocolVersion = 1,
  }) async {
    return await _request('POST', '/api/channels/$channelId/messages', {
      'ciphertext': ciphertext,
      'iv': iv,
      if (attachmentIds.isNotEmpty) 'attachment_ids': attachmentIds,
      if (replyToId != 0) 'reply_to_id': replyToId,
      'protocol_version': protocolVersion,
    }) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> editMessage(
    int channelId,
    int messageId,
    String ciphertext,
    String iv, {
    int protocolVersion = 1,
  }) async {
    return await _request('PATCH', '/api/channels/$channelId/messages/$messageId', {
      'ciphertext': ciphertext,
      'iv': iv,
      'protocol_version': protocolVersion,
    }) as Map<String, dynamic>;
  }

  Future<void> deleteMessage(int channelId, int messageId) async {
    await _request('DELETE', '/api/channels/$channelId/messages/$messageId');
  }

  Future<void> sendTyping(int channelId) async {
    await _request('POST', '/api/channels/$channelId/typing');
  }

  Future<Map<String, dynamic>> gifSearch(String q, {int limit = 24}) async {
    return await _request('GET', '/api/gifs/search?q=${Uri.encodeComponent(q)}&limit=$limit') as Map<String, dynamic>;
  }

  Future<void> inviteToCall(int callId, List<int> targetIds) async {
    await _request('POST', '/api/calls/$callId/invite', {'target_ids': targetIds});
  }

  Future<void> punchCall(int callId) async {
    await _request('POST', '/api/calls/$callId/punch');
  }

  // --- Ключи ---
  Future<void> uploadKey(String deviceId, String publicKey) async {
    await _request('POST', '/api/users/key', {
      'device_id': deviceId,
      'public_key': publicKey,
    });
  }

  Future<String?> myWrappedKey(int channelId, String deviceId) async {
    final j = await _request('GET', '/api/channels/$channelId/keys/me?device_id=$deviceId')
        as Map<String, dynamic>;
    return j['wrapped_key'] as String?;
  }

  Future<List<dynamic>> pendingKeyTargets(int channelId) async {
    return await _request('GET', '/api/channels/$channelId/keys/pending') as List<dynamic>;
  }

  Future<void> uploadWrappedKey(int channelId, int userId, String deviceId, String wrappedKey) async {
    await _request('POST', '/api/channels/$channelId/keys/wrap', {
      'user_id': userId,
      'device_id': deviceId,
      'wrapped_key': wrappedKey,
    });
  }

  // --- Signal Protocol devices ---
  Future<void> registerDevice(String deviceId, List<int> identityKey, List<int> signedPreKey, List<List<int>> preKeys) async {
    await _request('POST', '/api/devices', {
      'device_id': deviceId,
      'identity_key': identityKey,
      'signed_pre_key': signedPreKey,
      'pre_keys': preKeys,
    });
  }

  Future<void> deleteDevice(String deviceId) async {
    await _request('DELETE', '/api/devices/${Uri.encodeComponent(deviceId)}');
  }

  Future<List<dynamic>> listUserDevices(int userId) async {
    return await _request('GET', '/api/users/$userId/devices') as List<dynamic>;
  }

  Future<Map<String, dynamic>> consumePreKey(int userId, String deviceId) async {
    return await _request('GET', '/api/devices/${Uri.encodeComponent(deviceId)}/prekey?user_id=$userId') as Map<String, dynamic>;
  }

  Future<void> uploadPreKeys(String deviceId, List<List<int>> preKeys) async {
    await _request('POST', '/api/devices/${Uri.encodeComponent(deviceId)}/prekeys', {
      'pre_keys': preKeys,
    });
  }

  // --- Centrifugo tokens ---
  Future<Map<String, dynamic>> centrifugoToken() async {
    return await _request('POST', '/api/centrifugo/token') as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> centrifugoSubscribe(String channel) async {
    return await _request('POST', '/api/centrifugo/subscribe', {'channel': channel}) as Map<String, dynamic>;
  }

  // --- Звонки (device_id обязателен: из него собирается identity LiveKit) ---
  Future<Map<String, dynamic>> createCall(
      int channelId, List<int> targetUserIds, String deviceId) async {
    return await _request('POST', '/api/calls', {
      'channel_id': channelId,
      'target_ids': targetUserIds,
      'device_id': deviceId,
    }) as Map<String, dynamic>;
  }

  Future<List<dynamic>> calls(int channelId) async {
    return await _request('GET', '/api/channels/$channelId/calls') as List<dynamic>;
  }

  Future<Map<String, dynamic>> acceptCall(int callId, String deviceId) async {
    return await _request('POST', '/api/calls/$callId/accept', {'device_id': deviceId})
        as Map<String, dynamic>;
  }

  Future<void> declineCall(int callId) async {
    await _request('POST', '/api/calls/$callId/decline');
  }

  Future<Map<String, dynamic>> joinCall(int callId, String deviceId) async {
    return await _request('POST', '/api/calls/$callId/join', {'device_id': deviceId})
        as Map<String, dynamic>;
  }

  Future<void> leaveCall(int callId) async {
    await _request('POST', '/api/calls/$callId/leave');
  }

  // --- Приглашения ---
  Future<List<dynamic>> invites() async {
    return await _request('GET', '/api/invites') as List<dynamic>;
  }

  Future<void> acceptInvite(int inviteId) async {
    await _request('POST', '/api/invites/$inviteId/accept');
  }

  Future<void> declineInvite(int inviteId) async {
    await _request('POST', '/api/invites/$inviteId/decline');
  }

  // --- Аватары ---
  Future<List<dynamic>> users() async {
    return await _request('GET', '/api/users') as List<dynamic>;
  }

  /// Загрузка аватара (multipart, ограничение сервера — 5 МБ).
  Future<void> uploadAvatar(Uint8List bytes, String filename) async {
    final req = http.MultipartRequest('POST', _uri('/api/me/avatar'));
    if (token != null) req.headers['Authorization'] = 'Bearer $token';
    req.files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
    final streamed = await _http.send(req).timeout(const Duration(seconds: 30));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _errorText(res.body));
    }
  }

  Future<void> deleteAvatar() async {
    await _request('DELETE', '/api/me/avatar');
  }

  // --- Файлы (вложения сообщений) ---

  /// Загрузка файла в канал; вернёт { id, filename, mime, size }.
  Future<Map<String, dynamic>> uploadFile(
    int channelId,
    Uint8List bytes,
    String filename,
    String mime,
  ) async {
    final req = http.MultipartRequest('POST', _uri('/api/channels/$channelId/files'));
    if (token != null) req.headers['Authorization'] = 'Bearer $token';
    req.files.add(http.MultipartFile.fromBytes('file', bytes,
        filename: filename, contentType: MediaType('application', 'octet-stream')));
    final streamed = await _http.send(req).timeout(const Duration(minutes: 5));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _errorText(res.body));
    }
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// URL файла с короткоживущим файловым токеном (для Image.network и т.п.).
  String fileUrl(int fileId) {
    final t = _fileToken ?? '';
    if (t.isEmpty) ensureFileToken();
    return '$baseUrl/api/files/$fileId?token=${Uri.encodeQueryComponent(t)}';
  }

  /// Запрос короткоживущего файлового токена (5 минут, scope=file).
  /// Обновляется заранее, за минуту до истечения.
  Future<void> ensureFileToken() async {
    final exp = _fileTokenExpires;
    if (_fileToken != null &&
        exp != null &&
        DateTime.now().isBefore(exp.subtract(const Duration(seconds: 60)))) {
      return;
    }
    try {
      final j = await _request('GET', '/api/files/token') as Map<String, dynamic>;
      final t = j['token'] as String?;
      if (t == null || t.isEmpty) return;
      _fileToken = t;
      final secs = (j['expires_in'] as num?)?.toInt() ?? 300;
      _fileTokenExpires = DateTime.now().add(Duration(seconds: secs));
    } catch (_) {
      /* токен запросится повторно */
    }
  }

  /// Периодическое обновление файлового токена (раз в 4 минуты).
  void startFileTokenRefresh() {
    ensureFileToken();
    _fileTokenTimer?.cancel();
    _fileTokenTimer = Timer.periodic(const Duration(minutes: 4), (_) => ensureFileToken());
  }

  // --- Нативные пуши (FCM) ---
  Future<void> registerFcmToken(String token) async {
    await _request('POST', '/api/push/fcm', {'token': token});
  }

  // --- Админ-панель ---
  Future<Map<String, dynamic>> adminStats() async {
    return await _request('GET', '/api/admin/stats') as Map<String, dynamic>;
  }

  Future<List<dynamic>> adminUsers() async {
    return await _request('GET', '/api/admin/users') as List<dynamic>;
  }

  Future<List<dynamic>> adminChannels() async {
    return await _request('GET', '/api/admin/channels') as List<dynamic>;
  }

  Future<void> adminSetRegistration(bool enabled) async {
    await _request('POST', '/api/admin/settings/registration', {'enabled': enabled});
  }

  Future<bool> adminGetRegistration() async {
    final j = await _request('GET', '/api/admin/settings/registration') as Map<String, dynamic>;
    return (j['enabled'] as bool?) ?? true;
  }

  Future<void> adminServerBan(int userId, String reason) async {
    await _request('POST', '/api/admin/users/$userId/server-ban', {'reason': reason});
  }

  Future<void> adminServerUnban(int userId) async {
    await _request('DELETE', '/api/admin/users/$userId/server-ban');
  }

  Future<void> adminCreateUser(String nick, String password) async {
    await _request('POST', '/api/admin/users', {'nick': nick, 'password': password});
  }

  Future<void> adminResetPassword(int userId, String password) async {
    await _request('POST', '/api/admin/users/$userId/password', {'password': password});
  }

  Future<void> adminDeleteChannel(int channelId) async {
    await _request('DELETE', '/api/channels/$channelId');
  }

  Future<List<dynamic>> adminListFiles() async {
    return await _request('GET', '/api/admin/files') as List<dynamic>;
  }

  Future<void> adminDeleteFile(int fileId) async {
    await _request('DELETE', '/api/admin/files/$fileId');
  }

  Future<void> inviteToChannel(int channelId, int userId) async {
    await _request('POST', '/api/channels/$channelId/invites', {'user_id': userId});
  }

  Future<void> setMemberRole(int channelId, int userId, String role) async {
    await _request('POST', '/api/channels/$channelId/members/$userId/role', {'role': role});
  }

  Future<void> kickMember(int channelId, int userId, String reason) async {
    await _request('POST', '/api/channels/$channelId/members/$userId/kick', {'reason': reason});
  }

  Future<void> banMember(int channelId, int userId, String reason) async {
    await _request('POST', '/api/channels/$channelId/members/$userId/ban', {'reason': reason});
  }

  Future<void> unbanMember(int channelId, int userId) async {
    await _request('DELETE', '/api/channels/$channelId/members/$userId/ban');
  }

  Future<List<dynamic>> bannedMembers(int channelId) async {
    return await _request('GET', '/api/channels/$channelId/banned') as List<dynamic>;
  }

  // --- Рингтон сервера (админ устанавливает, все клиенты играют) ---
  Future<Map<String, dynamic>> ringtoneInfo() async {
    return await _request('GET', '/api/ringtone/info') as Map<String, dynamic>;
  }

  Future<void> uploadRingtone(Uint8List bytes, String filename, String mime) async {
    final req = http.MultipartRequest('POST', _uri('/api/admin/ringtone'));
    if (token != null) req.headers['Authorization'] = 'Bearer $token';
    req.files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename, contentType: MediaType.parse(mime)));
    final streamed = await _http.send(req).timeout(const Duration(seconds: 30));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _errorText(res.body));
    }
  }

  Future<void> deleteRingtone() async {
    await _request('DELETE', '/api/admin/ringtone');
  }

  String ringtoneUrl() => '$baseUrl/api/ringtone';

  Future<Uint8List> fetchRingtone() async {
    final req = http.Request('GET', _uri('/api/ringtone'));
    if (token != null) req.headers['Authorization'] = 'Bearer $token';
    final streamed = await _http.send(req);
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode != 200) throw ApiException(res.statusCode, _errorText(res.body));
    return res.bodyBytes;
  }
}

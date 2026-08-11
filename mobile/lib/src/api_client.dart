// REST-клиент Golosloom. Форматы — по docs/protocol.md.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

class ServerConfig {
  final String livekitUrl;
  final int maxMessageLen;
  final String? vapidPublicKey;
  final List<String> turnUrls;
  final String turnUsername;
  final String turnCredential;

  const ServerConfig({
    required this.livekitUrl,
    required this.maxMessageLen,
    this.vapidPublicKey,
    this.turnUrls = const [],
    this.turnUsername = '',
    this.turnCredential = '',
  });

  factory ServerConfig.fromJson(Map<String, dynamic> j) {
    final turn = (j['turn'] as Map<String, dynamic>?) ?? const {};
    return ServerConfig(
      livekitUrl: (j['livekit_url'] as String?) ?? '',
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
  final http.Client _http = http.Client();

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

  Future<Map<String, dynamic>> sendMessage(int channelId, String ciphertext, String iv) async {
    return await _request('POST', '/api/channels/$channelId/messages', {
      'ciphertext': ciphertext,
      'iv': iv,
    }) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> editMessage(
      int channelId, int messageId, String ciphertext, String iv) async {
    return await _request('PATCH', '/api/channels/$channelId/messages/$messageId', {
      'ciphertext': ciphertext,
      'iv': iv,
    }) as Map<String, dynamic>;
  }

  Future<void> deleteMessage(int channelId, int messageId) async {
    await _request('DELETE', '/api/channels/$channelId/messages/$messageId');
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

  // --- WebSocket ---
  WebSocketChannel connectWs() {
    final wsUrl = baseUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
    return WebSocketChannel.connect(Uri.parse('$wsUrl/ws?token=${token ?? ''}'));
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

  // --- Нативные пуши (FCM) ---
  Future<void> registerFcmToken(String token) async {
    await _request('POST', '/api/push/fcm', {'token': token});
  }
}

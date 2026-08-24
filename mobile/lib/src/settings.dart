// Локальные настройки: адрес сервера, токен, данные пользователя.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class StoredUser {
  final int id;
  final String nick;
  final bool isServerAdmin;

  const StoredUser({required this.id, required this.nick, required this.isServerAdmin});

  Map<String, dynamic> toJson() => {'id': id, 'nick': nick, 'is_server_admin': isServerAdmin};

  static StoredUser? fromJson(Object? j) {
    if (j is! Map<String, dynamic>) return null;
    return StoredUser(
      id: (j['id'] as num?)?.toInt() ?? 0,
      nick: (j['nick'] as String?) ?? '',
      isServerAdmin: (j['is_server_admin'] as bool?) ?? false,
    );
  }
}

class AppSettings extends ChangeNotifier {
  static const _serverKey = 'server_url';
  static const _tokenKey = 'auth_token';
  static const _userKey = 'auth_user';
  static const _darkKey = 'dark_theme';

  final SharedPreferences _prefs;
  AppSettings(this._prefs);

  String? get serverUrl => _prefs.getString(_serverKey);
  String? get token => _prefs.getString(_tokenKey);
  StoredUser? get user => StoredUser.fromJson(jsonDecode(_prefs.getString(_userKey) ?? 'null'));

  /// Тёмная тема (по умолчанию — светлая); выбор запоминается.
  bool get darkTheme => _prefs.getBool(_darkKey) ?? false;
  Future<void> setDarkTheme(bool v) async {
    await _prefs.setBool(_darkKey, v);
    notifyListeners();
  }

  Future<void> setServerUrl(String url) => _prefs.setString(_serverKey, url);

  Future<void> saveAuth(String token, Map<String, dynamic> userJson) async {
    await _prefs.setString(_tokenKey, token);
    await _prefs.setString(_userKey, jsonEncode(userJson));
  }

  Future<void> clearAuth() async {
    await _prefs.remove(_tokenKey);
    await _prefs.remove(_userKey);
  }
}

// Проверка новой версии через GitHub Releases.
// Показываем окно один раз на версию: отказ запоминается до выхода
// следующей новой версии.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const _repo = 'grendervilll/golosloom';
const _dismissedKey = 'dismissed_update_version';

class UpdateInfo {
  final String version; // без префикса v
  final String releaseUrl;
  final String? apkUrl;

  const UpdateInfo({
    required this.version,
    required this.releaseUrl,
    this.apkUrl,
  });
}

class Updater {
  /// Последний релиз из GitHub. null — не удалось проверить.
  Future<UpdateInfo?> checkLatest() async {
    try {
      final res = await http.get(
        Uri.parse('https://api.github.com/repos/$_repo/releases/latest'),
        headers: {'User-Agent': 'golosloom-android', 'Accept': 'application/vnd.github+json'},
      );
      if (res.statusCode != 200) return null;
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      final tag = (json['tag_name'] as String?) ?? '';
      if (tag.isEmpty) return null;
      final version = tag.startsWith('v') ? tag.substring(1) : tag;
      String? apkUrl;
      final assets = (json['assets'] as List? ?? []).cast<Map<String, dynamic>>();
      for (final a in assets) {
        final name = (a['name'] as String? ?? '');
        if (name.endsWith('.apk')) {
          apkUrl = a['browser_download_url'] as String?;
          break;
        }
      }
      return UpdateInfo(
        version: version,
        releaseUrl: (json['html_url'] as String?) ?? '',
        apkUrl: apkUrl,
      );
    } catch (_) {
      return null;
    }
  }

  /// Сравнение версий major.minor.patch: latest > current.
  static bool isNewer(String latest, String current) {
    final l = _parts(latest);
    final c = _parts(current);
    for (var i = 0; i < l.length && i < c.length; i++) {
      if (l[i] != c[i]) return l[i] > c[i];
    }
    return l.length > c.length;
  }

  static List<int> _parts(String v) {
    final m = RegExp(r'^(\d+)(?:\.(\d+))?(?:\.(\d+))?').firstMatch(v.trim());
    if (m == null) return [0];
    return [for (var i = 1; i <= 3; i++) int.tryParse(m.group(i) ?? '0') ?? 0];
  }

  /// Отмечаем, что пользователь отказался от этой версии.
  Future<void> dismiss(String version) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_dismissedKey, version);
  }

  /// Версия, от которой пользователь уже отказался (или null).
  Future<String?> dismissedVersion() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_dismissedKey);
  }
}

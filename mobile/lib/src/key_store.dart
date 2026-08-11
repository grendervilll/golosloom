// Хранилище ключей каналов: flutter_secure_storage (Android Keystore).
// Ключ канала — 32 байта, хранится в base64 по ключу ch_<channelId>.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'crypto.dart';

class KeyStore {
  static const _storage = FlutterSecureStorage();

  Future<List<int>?> loadChannelKey(int channelId) async {
    final b64 = await _storage.read(key: 'ch_$channelId');
    if (b64 == null || b64.isEmpty) return null;
    try {
      return b64ToBytes(b64);
    } catch (_) {
      return null;
    }
  }

  Future<void> saveChannelKey(int channelId, List<int> key) async {
    await _storage.write(key: 'ch_$channelId', value: bytesToB64(key));
  }
}

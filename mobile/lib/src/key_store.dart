// Signal Protocol key storage backed by flutter_secure_storage
// (Android Keystore / iOS Keychain).
//
// Key layout in secure storage:
//   Identity key pair:       ik_pub, ik_priv
//   Signed pre-key:          spk_pub, spk_priv, spk_sig
//   One-time pre-keys:       opk_<i>_pub, opk_<i>_priv
//   Ratchet sessions:        session_<peerUserId>  (JSON map)
//   Sender keys (groups):    sk_<groupId>           (JSON map)
//   Legacy channel keys:     ch_<channelId>         (base64 bytes)
library;

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'crypto.dart';

/// Immutable snapshot of a single key pair.
class KeyPair {
  final List<int> publicKey;
  final List<int> privateKey;

  const KeyPair({required this.publicKey, required this.privateKey});
}

/// Serialised ratchet session state (opaque to the store – interpreted by the
/// protocol layer).
typedef SessionState = Map<String, dynamic>;

/// Serialised sender key state for group encryption.
typedef SenderKeyData = Map<String, dynamic>;

class KeyStore {
  static const _storage = FlutterSecureStorage();

  // ── Device ID ────────────────────────────────────────────────────

  Future<void> saveDeviceId(String id) async {
    await _storage.write(key: 'device_id', value: id);
  }

  Future<String?> loadDeviceId() async {
    return await _storage.read(key: 'device_id');
  }

  // ── Identity key pair ──────────────────────────────────────────────

  Future<void> saveIdentityKeyPair(IdentityKeyPair pair) async {
    await _storage.write(key: 'ik_pub', value: bytesToB64(pair.publicKey));
    await _storage.write(key: 'ik_priv', value: bytesToB64(pair.privateKey));
  }

  Future<IdentityKeyPair?> loadIdentityKeyPair() async {
    final pub = await _storage.read(key: 'ik_pub');
    final priv = await _storage.read(key: 'ik_priv');
    if (pub == null || priv == null) return null;
    return IdentityKeyPair(publicKey: b64ToBytes(pub), privateKey: b64ToBytes(priv));
  }

  Future<void> deleteIdentityKeyPair() async {
    await _storage.delete(key: 'ik_pub');
    await _storage.delete(key: 'ik_priv');
  }

  // ── Signed pre-key ─────────────────────────────────────────────────

  Future<void> saveSignedPreKey(SignedPreKey spk) async {
    await _storage.write(key: 'spk_pub', value: bytesToB64(spk.publicKey));
    await _storage.write(key: 'spk_priv', value: bytesToB64(spk.privateKey));
  }

  Future<SignedPreKey?> loadSignedPreKey() async {
    final pub = await _storage.read(key: 'spk_pub');
    final priv = await _storage.read(key: 'spk_priv');
    if (pub == null || priv == null) return null;
    return SignedPreKey(publicKey: b64ToBytes(pub), privateKey: b64ToBytes(priv));
  }

  Future<void> deleteSignedPreKey() async {
    await _storage.delete(key: 'spk_pub');
    await _storage.delete(key: 'spk_priv');
  }

  // ── One-time pre-keys ──────────────────────────────────────────────

  Future<void> saveOneTimePreKey(int index, OneTimePreKey opk) async {
    await _storage.write(key: 'opk_${index}_pub', value: bytesToB64(opk.publicKey));
    await _storage.write(key: 'opk_${index}_priv', value: bytesToB64(opk.privateKey));
  }

  Future<OneTimePreKey?> loadOneTimePreKey(int index) async {
    final pub = await _storage.read(key: 'opk_${index}_pub');
    final priv = await _storage.read(key: 'opk_${index}_priv');
    if (pub == null || priv == null) return null;
    return OneTimePreKey(publicKey: b64ToBytes(pub), privateKey: b64ToBytes(priv));
  }

  Future<void> deleteOneTimePreKey(int index) async {
    await _storage.delete(key: 'opk_${index}_pub');
    await _storage.delete(key: 'opk_${index}_priv');
  }

  /// Return every one-time pre-key index currently stored.
  Future<List<int>> listOneTimePreKeyIndices() async {
    final all = await _storage.readAll();
    final indices = <int>[];
    final prefix = 'opk_';
    final suffix = '_pub';
    for (final key in all.keys) {
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      final middle = key.substring(prefix.length, key.length - suffix.length);
      final idx = int.tryParse(middle);
      if (idx != null) indices.add(idx);
    }
    indices.sort();
    return indices;
  }

  /// Consume (delete) a one-time pre-key after it has been used in a
  /// key-agreement handshake.
  Future<void> consumeOneTimePreKey(int index) => deleteOneTimePreKey(index);

  // ── Ratchet sessions (per peer) ────────────────────────────────────

  Future<void> saveSession(String peerUserId, SessionState state) async {
    await _storage.write(key: 'session_$peerUserId', value: jsonEncode(state));
  }

  Future<SessionState?> loadSession(String peerUserId) async {
    final raw = await _storage.read(key: 'session_$peerUserId');
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<void> deleteSession(String peerUserId) async {
    await _storage.delete(key: 'session_$peerUserId');
  }

  /// Delete every stored session (used on logout / reset).
  Future<void> deleteAllSessions() async {
    final all = await _storage.readAll();
    for (final key in all.keys) {
      if (key.startsWith('session_')) {
        await _storage.delete(key: key);
      }
    }
  }

  // ── Sender keys (per group) ────────────────────────────────────────

  Future<void> saveSenderKey(String groupId, SenderKeyData state) async {
    await _storage.write(key: 'sk_$groupId', value: jsonEncode(state));
  }

  Future<SenderKeyData?> loadSenderKey(String groupId) async {
    final raw = await _storage.read(key: 'sk_$groupId');
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<void> deleteSenderKey(String groupId) async {
    await _storage.delete(key: 'sk_$groupId');
  }

  // ── Legacy channel keys (protocol_version == 1) ────────────────────

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

  Future<void> deleteChannelKey(int channelId) async {
    await _storage.delete(key: 'ch_$channelId');
  }

  // ── Bulk operations ────────────────────────────────────────────────

  /// Wipe every key the store holds.  Use with caution.
  Future<void> deleteAll() async {
    await _storage.deleteAll();
  }
}

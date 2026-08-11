// Криптография клиента: X25519 + AES-256-GCM, совместимая с эталонной
// реализацией (web/src/crypto/crypto.ts).
//
// Форматы (должны совпадать байт-в-байт):
// - обёртка ключа канала: ephemeralPub(32) || iv(12) || AES-GCM(ключ + тег 16)
// - сообщение: iv(12) отдельно, ciphertext = AES-GCM(ключ + тег 16)
// - base64 — стандартный алфавит (+/), с паддингом =
library;

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:cryptography/cryptography.dart';

const _channelKeyLen = 32;
const _ivLen = 12;
const _tagLen = 16;

class DeviceKeys {
  final String deviceId;
  final List<int> privateKey;
  final List<int> publicKey;

  const DeviceKeys({
    required this.deviceId,
    required this.privateKey,
    required this.publicKey,
  });
}

final _x25519 = X25519();
final _aes = AesGcm.with256bits();
final _random = Random.secure();

String generateDeviceId() {
  // UUID v4-совместимая строка (серверу важно только уникальность).
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = b.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

Future<DeviceKeys> generateDeviceKeys() async {
  final pair = await _x25519.newKeyPair();
  final priv = await pair.extractPrivateKeyBytes();
  final pub = await pair.extractPublicKey();
  return DeviceKeys(
    deviceId: generateDeviceId(),
    privateKey: priv,
    publicKey: pub.bytes,
  );
}

/// Публичный ключ из приватного (для проверок и восстановления).
Future<List<int>> publicKeyFromPrivate(List<int> privateKey) async {
  final pair = await _x25519.newKeyPairFromSeed(privateKey);
  final pub = await pair.extractPublicKey();
  return pub.bytes;
}

/// Обёртка ключа канала для устройства с публичным ключом peerPublicKey.
/// Формат: ephemeralPub(32) || iv(12) || ciphertext+tag.
Future<List<int>> wrapChannelKey(
  List<int> channelKey,
  List<int> peerPublicKey,
) async {
  final ephemeral = await _x25519.newKeyPair();
  final shared = await _x25519.sharedSecretKey(
    keyPair: ephemeral,
    remotePublicKey: SimplePublicKey(peerPublicKey, type: KeyPairType.x25519),
  );
  final aesKey = await _deriveAesKey(await shared.extractBytes());
  final iv = List<int>.generate(_ivLen, (_) => _random.nextInt(256));
  final box = await _aes.encrypt(
    channelKey,
    secretKey: aesKey,
    nonce: iv,
  );
  return [
    ...(await ephemeral.extractPublicKey()).bytes,
    ...iv,
    ...box.cipherText,
    ...box.mac.bytes,
  ];
}

/// Распаковка ключа канала своим приватным ключом.
Future<List<int>> unwrapChannelKey(
  List<int> wrapped,
  List<int> privateKey,
) async {
  if (wrapped.length < 32 + _ivLen + _tagLen) {
    throw ArgumentError('Некорректный обёрнутый ключ');
  }
  final ephemeralPub = wrapped.sublist(0, 32);
  final iv = wrapped.sublist(32, 32 + _ivLen);
  final ciphertext = wrapped.sublist(32 + _ivLen);
  final shared = await _x25519.sharedSecretKey(
    keyPair: await _x25519.newKeyPairFromSeed(privateKey),
    remotePublicKey: SimplePublicKey(ephemeralPub, type: KeyPairType.x25519),
  );
  final aesKey = await _deriveAesKey(await shared.extractBytes());
  return _aesGcmDecrypt(ciphertext, iv, aesKey);
}

/// Шифрование сообщения общим ключом канала.
Future<({List<int> ciphertext, List<int> iv})> encryptMessage(
  List<int> channelKey,
  String plaintext,
) async {
  final iv = List<int>.generate(_ivLen, (_) => _random.nextInt(256));
  final box = await _aes.encrypt(
    utf8.encode(plaintext),
    secretKey: SecretKey(channelKey),
    nonce: iv,
  );
  return (
    ciphertext: [...box.cipherText, ...box.mac.bytes],
    iv: iv,
  );
}

/// Расшифровка сообщения. ciphertext включает тег (формат сервера).
Future<String> decryptMessage(
  List<int> channelKey,
  List<int> ciphertext,
  List<int> iv,
) async {
  final plain = await _aesGcmDecrypt(ciphertext, iv, SecretKey(channelKey));
  return utf8.decode(plain);
}

Future<SecretKey> _deriveAesKey(List<int> sharedSecret) async {
  final digest = crypto_pkg.sha256.convert(sharedSecret);
  return SecretKey(digest.bytes);
}

/// AES-GCM decrypt с тегом в конце ciphertext (формат WebCrypto/сервера).
Future<List<int>> _aesGcmDecrypt(
  List<int> ciphertextWithTag,
  List<int> nonce,
  SecretKey key,
) async {
  if (ciphertextWithTag.length < _tagLen) {
    throw ArgumentError('Некорректный шифротекст');
  }
  final body = ciphertextWithTag.sublist(0, ciphertextWithTag.length - _tagLen);
  final mac = Mac(ciphertextWithTag.sublist(ciphertextWithTag.length - _tagLen));
  return _aes.decrypt(SecretBox(body, nonce: nonce, mac: mac), secretKey: key);
}

String bytesToB64(List<int> bytes) => base64.encode(bytes);

List<int> b64ToBytes(String b64) => base64.decode(b64);

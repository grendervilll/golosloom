// Криптография клиента: X3DH + Double Ratchet + Sender Keys,
// совместимая с эталонной реализацией (web/src/crypto/signal.ts).
//
// Форматы (должны совпадать байт-в-байт):
// - обёртка ключа канала: ephemeralPub(32) || iv(12) || AES-GCM(ключ + тег 16)
// - сообщение: iv(12) отдельно, ciphertext = AES-GCM(ключ + тег 16)
// - base64 — стандартный алфавит (+/), с паддингом =
library;

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:cryptography/cryptography.dart';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _ivLen = 12;
const _tagLen = 16;

// ---------------------------------------------------------------------------
// Internal singletons
// ---------------------------------------------------------------------------

final _x25519 = X25519();
final _aes = AesGcm.with256bits();
final _random = Random.secure();

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

Uint8List _randomBytes(int length) =>
    Uint8List.fromList(List<int>.generate(length, (_) => _random.nextInt(256)));

Uint8List _concat(List<Uint8List> arrays) {
  var total = 0;
  for (final a in arrays) {
    total += a.length;
  }
  final out = Uint8List(total);
  var offset = 0;
  for (final a in arrays) {
    out.setRange(offset, offset + a.length, a);
    offset += a.length;
  }
  return out;
}

Uint8List _sha256(Uint8List data) =>
    Uint8List.fromList(crypto_pkg.sha256.convert(data).bytes);

Uint8List _hmacSha256(Uint8List key, Uint8List data) =>
    Uint8List.fromList(crypto_pkg.Hmac(crypto_pkg.sha256, key).convert(data).bytes);

Uint8List _hkdfExtract(Uint8List ikm, Uint8List salt) =>
    _hmacSha256(salt, ikm);

Uint8List _hkdfExpand(Uint8List prk, int length) {
  const hashLen = 32;
  final n = (length + hashLen - 1) ~/ hashLen;
  final okm = Uint8List(length);
  var previous = Uint8List(0);
  for (var i = 1; i <= n; i++) {
    final input = Uint8List(previous.length + prk.length + 1)
      ..setRange(0, previous.length, previous)
      ..[previous.length] = i
      ..setRange(previous.length + 1, previous.length + 1 + prk.length, prk);
    final t = _hmacSha256(prk, input);
    final take = min(hashLen, length - (i - 1) * hashLen);
    okm.setRange((i - 1) * hashLen, (i - 1) * hashLen + take, t.sublist(0, take));
    previous = t;
  }
  return okm;
}

Uint8List _hkdf(Uint8List ikm, Uint8List salt, int length) {
  final prk = _hkdfExtract(ikm, salt);
  return _hkdfExpand(prk, length);
}

/// Signal-compatible HKDF: salt = SHA256(salt1 || salt2), info = empty, 32 bytes.
Uint8List _hkdfDerive(Uint8List ikm, Uint8List salt1, Uint8List salt2) {
  final salt = _sha256(_concat([salt1, salt2]));
  return _hkdf(ikm, salt, 32);
}

(Uint8List, Uint8List) _chainKeyDerive(Uint8List rootKey, Uint8List dhOutput) {
  final d = _hkdf(dhOutput, rootKey, 64);
  return (d.sublist(0, 32), d.sublist(32, 64));
}

Uint8List _advanceChainKey(Uint8List ck) => _sha256(ck);

Uint8List _messageKeyDerive(Uint8List ck) {
  final input = Uint8List(ck.length + 1);
  input.setAll(0, ck);
  input[ck.length] = 0x01;
  return _sha256(input);
}

Uint8List _msgKeyToAesKey(Uint8List mk) => _hkdf(mk, Uint8List(32), 32);

Future<Uint8List> _x25519SharedSecret(
    Uint8List privateKey, Uint8List publicKey) async {
  final pair = await _x25519.newKeyPairFromSeed(privateKey);
  final shared = await _x25519.sharedSecretKey(
    keyPair: pair,
    remotePublicKey: SimplePublicKey(publicKey, type: KeyPairType.x25519),
  );
  return Uint8List.fromList(await shared.extractBytes());
}

Future<Uint8List> _x25519PublicKey(Uint8List privateKey) async {
  final pair = await _x25519.newKeyPairFromSeed(privateKey);
  final pub = await pair.extractPublicKey();
  return Uint8List.fromList(pub.bytes);
}

Future<(Uint8List, Uint8List)> _x25519RandomKeyPair() async {
  final pair = await _x25519.newKeyPair();
  final priv = await pair.extractPrivateKeyBytes();
  final pub = await pair.extractPublicKey();
  return (Uint8List.fromList(priv), Uint8List.fromList(pub.bytes));
}

bool _listEquals(Uint8List a, Uint8List b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

String bytesToB64(List<int> bytes) => base64.encode(bytes);

List<int> b64ToBytes(String b64) => base64.decode(b64);

// ---------------------------------------------------------------------------
// Legacy device keys (deprecated -- use IdentityKeyPair for new code)
// ---------------------------------------------------------------------------

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

String generateDeviceId() {
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = b.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

Future<DeviceKeys> generateDeviceKeys() async {
  final (priv, pub) = await _x25519RandomKeyPair();
  return DeviceKeys(
    deviceId: generateDeviceId(),
    privateKey: priv,
    publicKey: pub,
  );
}

Future<List<int>> publicKeyFromPrivate(List<int> privateKey) async {
  return (await _x25519PublicKey(Uint8List.fromList(privateKey))).toList();
}

// ---------------------------------------------------------------------------
// Legacy channel key (protocol_version=1 backward compatibility)
// ---------------------------------------------------------------------------

List<int> generateChannelKey() => _randomBytes(32).toList();

Future<List<int>> wrapChannelKey(
  List<int> channelKey,
  List<int> peerPublicKey,
) async {
  final ephemeralPair = await _x25519.newKeyPair();
  final ephemeralPub = (await ephemeralPair.extractPublicKey()).bytes;
  final shared = await _x25519.sharedSecretKey(
    keyPair: ephemeralPair,
    remotePublicKey: SimplePublicKey(peerPublicKey, type: KeyPairType.x25519),
  );
  final aesKey = await _deriveAesKey(await shared.extractBytes());
  final iv = _randomBytes(_ivLen);
  final box = await _aes.encrypt(
    channelKey,
    secretKey: aesKey,
    nonce: iv,
  );
  return [
    ...ephemeralPub,
    ...iv,
    ...box.cipherText,
    ...box.mac.bytes,
  ];
}

Future<List<int>> unwrapChannelKey(
  List<int> wrapped,
  List<int> privateKey,
) async {
  if (wrapped.length < 32 + _ivLen + _tagLen) {
    throw ArgumentError('Invalid wrapped key');
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

Future<({List<int> ciphertext, List<int> iv})> encryptMessage(
  List<int> channelKey,
  String plaintext,
) async {
  final iv = _randomBytes(_ivLen);
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

Future<List<int>> _aesGcmDecrypt(
  List<int> ciphertextWithTag,
  List<int> nonce,
  SecretKey key,
) async {
  if (ciphertextWithTag.length < _tagLen) {
    throw ArgumentError('Invalid ciphertext');
  }
  final body =
      ciphertextWithTag.sublist(0, ciphertextWithTag.length - _tagLen);
  final mac = Mac(ciphertextWithTag.sublist(ciphertextWithTag.length - _tagLen));
  return _aes.decrypt(
    SecretBox(body, nonce: nonce, mac: mac),
    secretKey: key,
  );
}

/// AES-GCM encrypt for Signal protocol internals.
Future<(Uint8List ciphertext, Uint8List iv)> _aesEncryptRaw(
  Uint8List key,
  Uint8List plaintext,
) async {
  final iv = _randomBytes(_ivLen);
  final box = await _aes.encrypt(
    plaintext,
    secretKey: SecretKey(key),
    nonce: iv,
  );
  return (_concat([Uint8List.fromList(box.cipherText), Uint8List.fromList(box.mac.bytes)]), iv);
}

/// AES-GCM decrypt for Signal protocol internals.
Future<Uint8List> _aesDecryptRaw(
  Uint8List key,
  Uint8List ciphertextWithTag,
  Uint8List iv,
) async {
  if (ciphertextWithTag.length < _tagLen) {
    throw ArgumentError('Ciphertext too short');
  }
  final body =
      ciphertextWithTag.sublist(0, ciphertextWithTag.length - _tagLen);
  final mac =
      Mac(ciphertextWithTag.sublist(ciphertextWithTag.length - _tagLen));
  final plain = await _aes.decrypt(
    SecretBox(body, nonce: iv, mac: mac),
    secretKey: SecretKey(key),
  );
  return Uint8List.fromList(plain);
}

Future<(Uint8List ciphertext, Uint8List iv)> _aesEncryptString(
  Uint8List key,
  String plaintext,
) async {
  return _aesEncryptRaw(key, Uint8List.fromList(utf8.encode(plaintext)));
}

Future<String> _aesDecryptString(
  Uint8List key,
  Uint8List ciphertextWithTag,
  Uint8List iv,
) async {
  final plain = await _aesDecryptRaw(key, ciphertextWithTag, iv);
  return utf8.decode(plain);
}

// ===========================================================================
// Signal Protocol -- X3DH + Double Ratchet + Sender Keys
// ===========================================================================

// ---------------------------------------------------------------------------
// Identity Key Pair
// ---------------------------------------------------------------------------

class IdentityKeyPair {
  final Uint8List publicKey;
  final Uint8List privateKey;

  const IdentityKeyPair({required this.publicKey, required this.privateKey});

  factory IdentityKeyPair.fromMap(Map<String, dynamic> m) => IdentityKeyPair(
        publicKey: Uint8List.fromList(m['publicKey'] as List<int>),
        privateKey: Uint8List.fromList(m['privateKey'] as List<int>),
      );

  Map<String, dynamic> toMap() => {
        'publicKey': publicKey,
        'privateKey': privateKey,
      };
}

Future<IdentityKeyPair> generateIdentityKeyPair() async {
  final (priv, pub) = await _x25519RandomKeyPair();
  return IdentityKeyPair(publicKey: pub, privateKey: priv);
}

// ---------------------------------------------------------------------------
// Signed Pre-Key
// ---------------------------------------------------------------------------

class SignedPreKey {
  final Uint8List publicKey;
  final Uint8List privateKey;

  const SignedPreKey({required this.publicKey, required this.privateKey});

  factory SignedPreKey.fromMap(Map<String, dynamic> m) => SignedPreKey(
        publicKey: Uint8List.fromList(m['publicKey'] as List<int>),
        privateKey: Uint8List.fromList(m['privateKey'] as List<int>),
      );

  Map<String, dynamic> toMap() => {
        'publicKey': publicKey,
        'privateKey': privateKey,
      };
}

Future<SignedPreKey> generateSignedPreKey() async {
  final (priv, pub) = await _x25519RandomKeyPair();
  return SignedPreKey(publicKey: pub, privateKey: priv);
}

// ---------------------------------------------------------------------------
// One-Time Pre-Keys
// ---------------------------------------------------------------------------

class OneTimePreKey {
  final Uint8List publicKey;
  final Uint8List privateKey;

  const OneTimePreKey({required this.publicKey, required this.privateKey});

  factory OneTimePreKey.fromMap(Map<String, dynamic> m) => OneTimePreKey(
        publicKey: Uint8List.fromList(m['publicKey'] as List<int>),
        privateKey: Uint8List.fromList(m['privateKey'] as List<int>),
      );

  Map<String, dynamic> toMap() => {
        'publicKey': publicKey,
        'privateKey': privateKey,
      };
}

Future<List<OneTimePreKey>> generateOneTimePreKeys(int count) async {
  final keys = <OneTimePreKey>[];
  for (var i = 0; i < count; i++) {
    final (priv, pub) = await _x25519RandomKeyPair();
    keys.add(OneTimePreKey(publicKey: pub, privateKey: priv));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// X3DH -- Extended Triple Diffie-Hellman
// ---------------------------------------------------------------------------

class X3DHInitMessage {
  final Uint8List identityKey;
  final Uint8List ephemeralPublicKey;
  final Uint8List? oneTimePreKey;

  const X3DHInitMessage({
    required this.identityKey,
    required this.ephemeralPublicKey,
    this.oneTimePreKey,
  });

  factory X3DHInitMessage.fromMap(Map<String, dynamic> m) => X3DHInitMessage(
        identityKey: Uint8List.fromList(m['identityKey'] as List<int>),
        ephemeralPublicKey:
            Uint8List.fromList(m['ephemeralPublicKey'] as List<int>),
        oneTimePreKey: m['oneTimePreKey'] != null
            ? Uint8List.fromList(m['oneTimePreKey'] as List<int>)
            : null,
      );

  Map<String, dynamic> toMap() => {
        'identityKey': identityKey,
        'ephemeralPublicKey': ephemeralPublicKey,
        'oneTimePreKey': oneTimePreKey,
      };
}

/// Alice initiates X3DH handshake.
/// Returns (sharedSecret, X3DHInitMessage).
Future<(Uint8List sharedSecret, X3DHInitMessage message)> x3dhInit(
  IdentityKeyPair aliceIdentity,
  Uint8List bobIdentityKey,
  Uint8List bobSignedPreKey, {
  Uint8List? bobOneTimePreKey,
}) async {
  final (ekPriv, ekPub) = await _x25519RandomKeyPair();

  final dh1 = await _x25519SharedSecret(aliceIdentity.privateKey, bobSignedPreKey);
  final dh2 = await _x25519SharedSecret(ekPriv, bobIdentityKey);
  final dh3 = await _x25519SharedSecret(ekPriv, bobSignedPreKey);

  var ikm = _concat([dh1, dh2, dh3]);
  if (bobOneTimePreKey != null) {
    final dh4 = await _x25519SharedSecret(ekPriv, bobOneTimePreKey);
    ikm = _concat([ikm, dh4]);
  }

  final sharedSecret = _hkdfDerive(ikm, aliceIdentity.publicKey, bobIdentityKey);

  return (
    sharedSecret,
    X3DHInitMessage(
      identityKey: aliceIdentity.publicKey,
      ephemeralPublicKey: ekPub,
      oneTimePreKey: bobOneTimePreKey,
    ),
  );
}

/// Bob responds to X3DH handshake, returning the shared secret.
Future<Uint8List> x3dhRespond(
  IdentityKeyPair bobIdentity,
  Uint8List bobSPKPriv,
  Uint8List? bobOPKPriv,
  X3DHInitMessage msg,
) async {
  final dh1 = await _x25519SharedSecret(bobSPKPriv, msg.identityKey);
  final dh2 = await _x25519SharedSecret(bobIdentity.privateKey, msg.ephemeralPublicKey);
  final dh3 = await _x25519SharedSecret(bobSPKPriv, msg.ephemeralPublicKey);

  var ikm = _concat([dh1, dh2, dh3]);
  if (bobOPKPriv != null) {
    final dh4 = await _x25519SharedSecret(bobOPKPriv, msg.ephemeralPublicKey);
    ikm = _concat([ikm, dh4]);
  }

  return _hkdfDerive(ikm, msg.identityKey, bobIdentity.publicKey);
}

// ---------------------------------------------------------------------------
// Double Ratchet (1:1 messaging)
// ---------------------------------------------------------------------------

class RatchetState {
  Uint8List rootKey;
  Uint8List sendingChainKey;
  Uint8List receivingChainKey;
  Uint8List sendingRatchetPrivateKey;
  Uint8List sendingRatchetPublicKey;
  Uint8List receivingRatchetPublic;
  int sendingMessageNumber;
  int receivingMessageNumber;

  RatchetState({
    required this.rootKey,
    required this.sendingChainKey,
    required this.receivingChainKey,
    required this.sendingRatchetPrivateKey,
    required this.sendingRatchetPublicKey,
    required this.receivingRatchetPublic,
    required this.sendingMessageNumber,
    required this.receivingMessageNumber,
  });

  factory RatchetState.fromMap(Map<String, dynamic> m) => RatchetState(
        rootKey: Uint8List.fromList(m['rootKey'] as List<int>),
        sendingChainKey: Uint8List.fromList(m['sendingChainKey'] as List<int>),
        receivingChainKey:
            Uint8List.fromList(m['receivingChainKey'] as List<int>),
        sendingRatchetPrivateKey:
            Uint8List.fromList(m['sendingRatchetPrivateKey'] as List<int>),
        sendingRatchetPublicKey:
            Uint8List.fromList(m['sendingRatchetPublicKey'] as List<int>),
        receivingRatchetPublic:
            Uint8List.fromList(m['receivingRatchetPublic'] as List<int>),
        sendingMessageNumber: m['sendingMessageNumber'] as int,
        receivingMessageNumber: m['receivingMessageNumber'] as int,
      );

  Map<String, dynamic> toMap() => {
        'rootKey': rootKey,
        'sendingChainKey': sendingChainKey,
        'receivingChainKey': receivingChainKey,
        'sendingRatchetPrivateKey': sendingRatchetPrivateKey,
        'sendingRatchetPublicKey': sendingRatchetPublicKey,
        'receivingRatchetPublic': receivingRatchetPublic,
        'sendingMessageNumber': sendingMessageNumber,
        'receivingMessageNumber': receivingMessageNumber,
      };
}

/// Alice side: she already has the shared secret from X3DH and Bob's ratchet
/// public key (sent in the first message or derived from X3DH).
Future<RatchetState> initRatchetAsAlice(
  Uint8List sharedSecret,
  Uint8List bobRatchetPublic,
) async {
  final (kpPriv, kpPub) = await _x25519RandomKeyPair();
  final dh = await _x25519SharedSecret(kpPriv, bobRatchetPublic);
  final (rootKey, sendingChainKey) = _chainKeyDerive(sharedSecret, dh);
  return RatchetState(
    rootKey: rootKey,
    sendingChainKey: sendingChainKey,
    receivingChainKey: Uint8List(32),
    sendingRatchetPrivateKey: kpPriv,
    sendingRatchetPublicKey: kpPub,
    receivingRatchetPublic: bobRatchetPublic,
    sendingMessageNumber: 0,
    receivingMessageNumber: 0,
  );
}

/// Bob side: he received Alice's ratchet public key in the first message
/// combined with the shared secret from X3DH.
Future<RatchetState> initRatchetAsBob(
  Uint8List sharedSecret,
  Uint8List aliceRatchetPublic,
) async {
  final (kpPriv, kpPub) = await _x25519RandomKeyPair();
  final dh = await _x25519SharedSecret(kpPriv, aliceRatchetPublic);
  final (rootKey, receivingChainKey) = _chainKeyDerive(sharedSecret, dh);
  return RatchetState(
    rootKey: rootKey,
    sendingChainKey: Uint8List(32),
    receivingChainKey: receivingChainKey,
    sendingRatchetPrivateKey: kpPriv,
    sendingRatchetPublicKey: kpPub,
    receivingRatchetPublic: aliceRatchetPublic,
    sendingMessageNumber: 0,
    receivingMessageNumber: 0,
  );
}

/// Encrypt a message using the sending chain.
Future<({Uint8List ciphertext, Uint8List iv, int msgNumber, Uint8List ratchetPublic})>
    ratchetEncrypt(RatchetState state, String plaintext) async {
  final mk = _messageKeyDerive(state.sendingChainKey);
  final (ciphertext, iv) = await _aesEncryptString(_msgKeyToAesKey(mk), plaintext);
  final result = (
    ciphertext: ciphertext,
    iv: iv,
    msgNumber: state.sendingMessageNumber,
    ratchetPublic: state.sendingRatchetPublicKey,
  );
  state.sendingChainKey = _advanceChainKey(state.sendingChainKey);
  state.sendingMessageNumber++;
  return result;
}

/// Decrypt a message using the receiving chain.
/// If the sender ratchet public key has changed, performs a DH ratchet step.
Future<String> ratchetDecrypt(
  RatchetState state,
  Uint8List ciphertext,
  Uint8List iv,
  int msgNumber,
  Uint8List senderRatchetPublic,
) async {
  final sameRatchet =
      state.receivingRatchetPublic.length == senderRatchetPublic.length &&
          _listEquals(state.receivingRatchetPublic, senderRatchetPublic);

  if (!sameRatchet) {
    // Receive ratchet step
    final dh = await _x25519SharedSecret(
        state.sendingRatchetPrivateKey, senderRatchetPublic);
    final (newRK, receivingChainKey) =
        _chainKeyDerive(state.rootKey, dh);
    state.rootKey = newRK;
    state.receivingChainKey = receivingChainKey;
    state.receivingRatchetPublic = senderRatchetPublic;
    state.receivingMessageNumber = 0;

    // Send ratchet step
    final (newPriv, newPub) = await _x25519RandomKeyPair();
    final dh2 = await _x25519SharedSecret(newPriv, senderRatchetPublic);
    final (rk2, sendingChainKey) = _chainKeyDerive(state.rootKey, dh2);
    state.rootKey = rk2;
    state.sendingChainKey = sendingChainKey;
    state.sendingRatchetPrivateKey = newPriv;
    state.sendingRatchetPublicKey = newPub;
    state.sendingMessageNumber = 0;
  }

  final mk = _messageKeyDerive(state.receivingChainKey);
  final text = await _aesDecryptString(_msgKeyToAesKey(mk), ciphertext, iv);
  state.receivingChainKey = _advanceChainKey(state.receivingChainKey);
  state.receivingMessageNumber++;
  return text;
}

// ---------------------------------------------------------------------------
// Sender Keys (group messaging)
// ---------------------------------------------------------------------------

class SenderKeyState {
  Uint8List chainKey;
  int messageNumber;

  SenderKeyState({required this.chainKey, required this.messageNumber});

  factory SenderKeyState.fromMap(Map<String, dynamic> m) => SenderKeyState(
        chainKey: Uint8List.fromList(m['chainKey'] as List<int>),
        messageNumber: m['messageNumber'] as int,
      );

  Map<String, dynamic> toMap() => {
        'chainKey': chainKey,
        'messageNumber': messageNumber,
      };
}

/// Generate a random 32-byte sender key.
Uint8List generateSenderKey() => _randomBytes(32);

/// Encrypt a message using sender key state.
/// Mutates state (advances chain key and message number).
Future<({Uint8List ciphertext, Uint8List iv})> encryptSenderKeyMessage(
  SenderKeyState sk,
  String plaintext,
) async {
  final mk = _messageKeyDerive(sk.chainKey);
  final (ciphertext, iv) = await _aesEncryptString(_msgKeyToAesKey(mk), plaintext);
  sk.chainKey = _advanceChainKey(sk.chainKey);
  sk.messageNumber++;
  return (ciphertext: ciphertext, iv: iv);
}

/// Decrypt a sender key message.
/// [chainKey] is the original sender key (32 bytes).
/// [msgNumber] is the message number from the encrypted envelope.
/// Advances the chain key by iterating [msgNumber] times.
Future<String> decryptSenderKeyMessage(
  Uint8List chainKey,
  Uint8List ciphertext,
  Uint8List iv,
  int msgNumber,
) async {
  var mk = chainKey;
  for (var i = 0; i < msgNumber; i++) {
    mk = _advanceChainKey(mk);
  }
  return _aesDecryptString(_msgKeyToAesKey(_messageKeyDerive(mk)), ciphertext, iv);
}

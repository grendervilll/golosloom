import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:golosloom_mobile/src/crypto.dart';

void main() {
  test('Public key derivation from private key', () async {
    final pair = await generateIdentityKeyPair();
    expect(pair.publicKey.length, 32);
    expect(pair.privateKey.length, 32);
    final derived = await publicKeyFromPrivate(pair.privateKey);
    expect(derived, pair.publicKey);
  });

  test('X3DH: both sides derive the same shared secret', () async {
    final alice = await generateIdentityKeyPair();
    final bob = await generateIdentityKeyPair();
    final bobSPK = await generateSignedPreKey();
    final bobOPKs = await generateOneTimePreKeys(1);

    final (sharedSecret, message) = await x3dhInit(alice, bob.publicKey, bobSPK.publicKey, bobOneTimePreKey: bobOPKs[0].publicKey);
    final bobSS = await x3dhRespond(bob, bobSPK.privateKey, bobOPKs[0].privateKey, message);

    expect(sharedSecret.length, 32);
    expect(sharedSecret, bobSS);
  });

  test('X3DH: without one-time pre-key', () async {
    final alice = await generateIdentityKeyPair();
    final bob = await generateIdentityKeyPair();
    final bobSPK = await generateSignedPreKey();

    final (sharedSecret, message) = await x3dhInit(alice, bob.publicKey, bobSPK.publicKey);
    final bobSS = await x3dhRespond(bob, bobSPK.privateKey, null, message);

    expect(sharedSecret, bobSS);
  });

  test('Double Ratchet: encrypt/decrypt round-trip', () async {
    final alice = await generateIdentityKeyPair();
    final bob = await generateIdentityKeyPair();
    final bobSPK = await generateSignedPreKey();
    final bobOPKs = await generateOneTimePreKeys(1);

    final (sharedSecret, message) = await x3dhInit(alice, bob.publicKey, bobSPK.publicKey, bobOneTimePreKey: bobOPKs[0].publicKey);
    final bobSS = await x3dhRespond(bob, bobSPK.privateKey, bobOPKs[0].privateKey, message);

    final bobRatchet = await generateIdentityKeyPair();
    final aliceState = await initRatchetAsAlice(sharedSecret, bobRatchet.publicKey);
    final enc1 = await ratchetEncrypt(aliceState, 'Hello Signal!');
    expect(enc1.msgNumber, 0);

    final bobState = await initRatchetAsBob(bobSS, enc1.ratchetPublic, bobRatchet.privateKey);
    final plain1 = await ratchetDecrypt(
      bobState, enc1.ciphertext, enc1.iv, enc1.msgNumber, enc1.ratchetPublic,
    );
    expect(plain1, 'Hello Signal!');

    // Bob replies — triggers DH ratchet on Alice's side in decrypt
    final encBob = await ratchetEncrypt(bobState, 'Reply from Bob');
    final plainBob = await ratchetDecrypt(
      aliceState, encBob.ciphertext, encBob.iv, encBob.msgNumber, encBob.ratchetPublic,
    );
    expect(plainBob, 'Reply from Bob');

    final enc2 = await ratchetEncrypt(aliceState, 'Second message');
    final plain2 = await ratchetDecrypt(
      bobState, enc2.ciphertext, enc2.iv, enc2.msgNumber, enc2.ratchetPublic,
    );
    expect(plain2, 'Second message');
  });

  test('Sender Key: encrypt/decrypt round-trip', () async {
    final skChainKey = generateSenderKey();
    final skState = SenderKeyState(chainKey: Uint8List.fromList(skChainKey), messageNumber: 0);

    final enc1 = await encryptSenderKeyMessage(skState, 'Group message');
    expect(skState.messageNumber, 1);
    final plain1 = await decryptSenderKeyMessage(skChainKey, enc1.ciphertext, enc1.iv, 0);
    expect(plain1, 'Group message');

    final enc2 = await encryptSenderKeyMessage(skState, 'Second group message');
    expect(skState.messageNumber, 2);
    final plain2 = await decryptSenderKeyMessage(skChainKey, enc2.ciphertext, enc2.iv, 1);
    expect(plain2, 'Second group message');
  });

  test('Base64 round-trip', () {
    final data = Uint8List.fromList(List<int>.generate(32, (i) => i));
    final encoded = bytesToB64(data);
    final decoded = b64ToBytes(encoded);
    expect(decoded, data);
  });

  test('Legacy AES-GCM encrypt/decrypt round-trip', () async {
    final key = generateChannelKey();
    final text = 'Привет из Dart!';
    final (ciphertext: ct, iv: iv) = await encryptMessage(key, text);
    final plain = await decryptMessage(key, ct, iv);
    expect(plain, text);
  });
}

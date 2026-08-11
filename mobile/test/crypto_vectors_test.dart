// Кросс-тест крипты: векторы сгенерированы эталонной TS-реализацией
// (web/src/crypto/vectors.spec.ts). Если этот тест зелёный — форматы
// Dart и TypeScript совместимы байт-в-байт.
import 'package:flutter_test/flutter_test.dart';

import 'package:golosloom_mobile/src/crypto.dart';

// VECTORS: сгенерировано 2026-08-11 из web/src/crypto/vectors.spec.ts.
const _vectors = {
  'device_priv': 'okcNSAEjqqEscBuw5kf0Oyylt+NBp3D4jNlQFwxF8cw=',
  'device_pub': 'Q4cCKOyP1P8VmyrHtXTq7fuJaOGC5C2WsNyFFYdBYVE=',
  'channel_key': 'Vi6IGwQJjz1JfQfcHQ62pQ044SZYbp9wV7QUJtylJpw=',
  'wrapped': 'IZATzoij454oMUNLhQjfcANrHCunqfbcpFb/X9GuZgXbtQ8YPAN+rY9L2DAwx2Kb3yQDR7LIPayPnirAW2NF13+aehi3KUR397+o/jEcytBJ0vK6rSURnd7Qcyg=',
  'msg_iv': 'eLyknx4fS2mqKUtP',
  'msg_ciphertext': '3XyJivOHbrslSZNNEjZutxLZq5F7Kuk1814iYmf23uCvfIHJ73WlYTcZ6lqy09Y31wxJ2ulJV887KR/HPNywcjQS',
  'plaintext': 'Привет, мир! Golosloom кросстест',
};

void main() {
  final devicePriv = b64ToBytes(_vectors['device_priv']!);
  final devicePub = b64ToBytes(_vectors['device_pub']!);
  final channelKey = b64ToBytes(_vectors['channel_key']!);
  final wrapped = b64ToBytes(_vectors['wrapped']!);
  final msgIv = b64ToBytes(_vectors['msg_iv']!);
  final msgCiphertext = b64ToBytes(_vectors['msg_ciphertext']!);

  test('публичный ключ из приватного совпадает с TS-эталоном', () async {
    final pub = await publicKeyFromPrivate(devicePriv);
    expect(pub, devicePub);
  });

  test('распаковка TS-обёртки даёт ключ канала', () async {
    final key = await unwrapChannelKey(wrapped, devicePriv);
    expect(key, channelKey);
  });

  test('расшифровка TS-сообщения даёт исходный текст', () async {
    final text = await decryptMessage(channelKey, msgCiphertext, msgIv);
    expect(text, _vectors['plaintext']);
  });

  test('Dart-обёртка распаковывается Dart-приватным ключом', () async {
    final myWrapped = await wrapChannelKey(channelKey, devicePub);
    final key = await unwrapChannelKey(myWrapped, devicePriv);
    expect(key, channelKey);
  });

  test('Dart-шифрование расшифровывается Dart', () async {
    final text = 'Своё сообщение из Dart';
    final (ciphertext: ct, iv: iv) = await encryptMessage(channelKey, text);
    final plain = await decryptMessage(channelKey, ct, iv);
    expect(plain, text);
  });

  test('генерация устройства даёт корректные размеры', () async {
    final keys = await generateDeviceKeys();
    expect(keys.privateKey.length, 32);
    expect(keys.publicKey.length, 32);
    expect(keys.deviceId.contains('-'), isTrue);
    // Деривация публичного ключа согласована.
    expect(await publicKeyFromPrivate(keys.privateKey), keys.publicKey);
  });
}

// End-to-end проверка мобильного клиента против реального Go-сервера:
// регистрация → вход → регистрация устройства → создание канала →
// инициализация ключа → отправка шифрованного сообщения → чтение и расшифровка.
//
// Запуск: server (go run ./cmd/server, порт 8080) → dart run tool/e2e.dart
// ignore_for_file: avoid_print
import 'dart:io';

import 'package:golosloom_mobile/src/api_client.dart';
import 'package:golosloom_mobile/src/crypto.dart';

Future<void> main() async {
  final base = Platform.environment['GL_E2E_URL'] ?? 'http://localhost:8080';
  final nick = 'mobile_e2e_${DateTime.now().millisecondsSinceEpoch % 100000}';
  final api = ApiClient(base);

  // 1. Регистрация + вход.
  await api.register(nick, 'passW0rd!2026E2e');
  await api.login(nick, 'passW0rd!2026E2e');
  assert(api.token != null, 'токен получен');
  final me = await api.me();
  final myId = (me['id'] as num).toInt();
  print('OK регистрация и вход: $nick (id $myId)');

  // 2. Устройство.
  final device = await generateDeviceKeys();
  await api.uploadKey(device.deviceId, bytesToB64(device.publicKey));
  print('OK устройство: ${device.deviceId}');

  // 3. Канал (создатель — участник).
  final channel = await api.createChannel('e2e_$nick', false);
  final channelId = (channel['id'] as num).toInt();
  print('OK канал #$channelId');

  // 4. Инициализация ключа канала (как создатель).
  final channelKey = generateChannelKey();
  final wrapped = await wrapChannelKey(channelKey, device.publicKey);
  await api.uploadWrappedKey(channelId, myId, device.deviceId, bytesToB64(wrapped));
  print('OK ключ канала обёрнут и загружен');

  // 5. Шифрованное сообщение туда и обратно.
  const text = 'Привет с мобильного клиента! Проверка E2E.';
  final (ciphertext: ct, iv: iv) = await encryptMessage(channelKey, text);
  final sent = await api.sendMessage(channelId, bytesToB64(ct), bytesToB64(iv));
  final sentId = (sent['id'] as num).toInt();
  print('OK отправлено сообщение #$sentId');

  // 6. Чтение истории и расшифровка.
  final history = await api.messages(channelId);
  final last = history.last as Map<String, dynamic>;
  assert((last['id'] as num).toInt() == sentId, 'сообщение на месте');
  final decrypted = await decryptMessage(
    channelKey,
    b64ToBytes((last['ciphertext'] as String)),
    b64ToBytes((last['iv'] as String)),
  );
  assert(decrypted == text, 'текст совпал');
  print('OK расшифровка: $decrypted');

  // 7. Обёртка возвращается сервером и распаковывается нашим ключом.
  final serverWrapped = await api.myWrappedKey(channelId, device.deviceId);
  assert(serverWrapped != null, 'сервер отдал обёрнутый ключ');
  final unwrapped = await unwrapChannelKey(b64ToBytes(serverWrapped!), device.privateKey);
  assert(unwrapped.length == channelKey.length, 'ключ распаковался');
  assert(
    List.generate(unwrapped.length, (i) => unwrapped[i] == channelKey[i]).every((x) => x),
    'распакованный ключ совпадает с исходным',
  );
  print("OK /api/me: ${me['nick']} (id ${me['id']}), ключ канала распакован");

  print('E2E: ВСЁ ПРОШЛО');
}

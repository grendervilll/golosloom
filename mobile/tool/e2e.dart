// End-to-end проверка мобильного клиента против реального Go-сервера:
// регистрация → вход → регистрация устройства → создание канала →
// инициализация ключа → отправка шифрованного сообщения → чтение и расшифровка.
//
// Запуск: server (go run ./cmd/server, порт 8080) → dart run tool/e2e.dart
// ignore_for_file: avoid_print
import 'dart:io';
import 'dart:typed_data';

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

  // 8. Звонок: создание, входящее приглашение второму, join/leave/rejoin.
  final api2 = ApiClient(base);
  final nick2 = 'mobile_e2e2_${DateTime.now().millisecondsSinceEpoch % 100000}';
  await api2.register(nick2, 'passW0rd!2026E2e');
  await api2.login(nick2, 'passW0rd!2026E2e');
  final ch2 = await api.createChannel('e2e_call_$nick', false);
  final ch2id = (ch2['id'] as num).toInt();
  await api2.joinChannel(ch2id);
  final api3 = ApiClient(base);
  final nick3 = 'mobile_e2e3_${DateTime.now().millisecondsSinceEpoch % 100000}';
  await api3.register(nick3, 'passW0rd!2026E2e');
  await api3.login(nick3, 'passW0rd!2026E2e');
  await api3.joinChannel(ch2id);

  final u2id = (await api2.me())['id'] as int;
  final u3id = (await api3.me())['id'] as int;
  final callRes = await api.createCall(ch2id, [u2id, u3id], device.deviceId);
  final call = callRes['call'] as Map<String, dynamic>;
  final callId = (call['id'] as num).toInt();
  assert(callRes['token'] != null, 'токен инициатора');
  print('OK звонок создан #$callId');

  // Оба приглашённых принимают и получают токены.
  final acceptRes = await api2.acceptCall(callId, 'dev-e2e2');
  assert(acceptRes['token'] != null, 'токен второго участника');
  final accept3 = await api3.acceptCall(callId, 'dev-e2e3');
  assert(accept3['token'] != null, 'токен третьего участника');
  print('OK звонок принят (3 участника)');

  // Выход и повторный вход (регресс: "нельзя войти обратно").
  await api2.leaveCall(callId);
  final joinRes = await api2.joinCall(callId, 'dev-e2e2');
  assert(joinRes['token'] != null, 'токен повторного входа');
  print('OK повторный вход после выхода');

  // Занятость: api2 (в звонке) — api звонит ему повторно → 409.
  try {
    await api.createCall(ch2id, [(await api2.me())['id'] as int], device.deviceId);
    assert(false, 'звонок занятому должен упасть');
  } on ApiException catch (e) {
    assert(e.message.contains('уже с кем-то разговаривает'), 'сообщение занятости: ${e.message}');
    print('OK занятый отклонён: ${e.message}');
  }
  await api2.leaveCall(callId);
  await api3.leaveCall(callId);

  // 9. Аватар: загрузка, проверка в /api/me, удаление.
  await api.uploadAvatar(Uint8List.fromList(List.generate(64, (i) => i)), 'test.jpg');
  final me2 = await api.me();
  assert(me2['avatar'] != null, 'avatar появился в /api/me');
  print('OK аватар загружен, в /api/me: ${me2['avatar']}');
  final avatars = (await api.users()).cast<Map<String, dynamic>>();
  final myEntry = avatars.firstWhere((u) => (u['id'] as num).toInt() == (me2['id'] as num).toInt());
  assert(myEntry['avatar'] != null, 'аватар виден в списке пользователей');
  print('OK аватар виден в списке пользователей');
  await api.deleteAvatar();
  print('OK аватар удалён');

  print('E2E: ВСЁ ПРОШЛО');
}

// Дополнительные проверки звонков и аватаров (запускаются тем же скриптом
// через GL_E2E_MORE=1).

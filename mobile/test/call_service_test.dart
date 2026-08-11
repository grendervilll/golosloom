// Тесты состояния звонков: обработка WS-событий без сети.
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:golosloom_mobile/src/api_client.dart';
import 'package:golosloom_mobile/src/call_service.dart';
import 'package:golosloom_mobile/src/session.dart';
import 'package:golosloom_mobile/src/settings.dart';

Future<Session> makeSession() async {
  SharedPreferences.setMockInitialValues({
    'server_url': 'https://example.com',
    'auth_token': 't',
    'auth_user': '{"id": 1, "nick": "me", "is_server_admin": false}',
  });
  final prefs = await SharedPreferences.getInstance();
  final settings = AppSettings(prefs);
  return Session(settings, ApiClient('https://example.com')..token = 't');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('call.invite показывает входящий звонок с ником инициатора', () async {
    final session = await makeSession();
    final calls = CallService(session);
    session.debugEmitEvent('call.invite', {
      'call_id': 7,
      'channel_id': 3,
      'initiator_id': 5,
      'initiator_nick': 'bob',
    });
    await Future<void>.delayed(Duration.zero);
    expect(calls.ringing, isNotNull);
    expect(calls.ringing!.id, 7);
    expect(calls.ringing!.channelId, 3);
    expect(calls.ringing!.incoming, isTrue);
    expect(calls.ringing!.initiatorNick, 'bob');
    calls.dispose();
  });

  test('call.invite.timeout убирает входящий звонок', () async {
    final session = await makeSession();
    final calls = CallService(session);
    session.debugEmitEvent('call.invite', {'call_id': 7, 'channel_id': 3});
    await Future<void>.delayed(Duration.zero);
    expect(calls.ringing, isNotNull);
    session.debugEmitEvent('call.invite.timeout', {'call_id': 7});
    await Future<void>.delayed(Duration.zero);
    expect(calls.ringing, isNull);
    calls.dispose();
  });

  test('call.ended сбрасывает звонок и комнату', () async {
    final session = await makeSession();
    final calls = CallService(session);
    session.debugEmitEvent('call.invite', {'call_id': 9, 'channel_id': 3});
    await Future<void>.delayed(Duration.zero);
    expect(calls.ringing, isNotNull);
    session.debugEmitEvent('call.ended', {'call_id': 9});
    await Future<void>.delayed(Duration.zero);
    expect(calls.ringing, isNull);
    expect(calls.inCall, isFalse);
    calls.dispose();
  });

  test('call.started переводит ожидающий звонок в активный', () async {
    final session = await makeSession();
    final calls = CallService(session);
    session.debugEmitEvent('call.invite', {'call_id': 5, 'channel_id': 3});
    await Future<void>.delayed(Duration.zero);
    expect(calls.ringing!.status, 'ringing');
    session.debugEmitEvent('call.started', {'call_id': 5});
    await Future<void>.delayed(Duration.zero);
    expect(calls.ringing!.status, 'active');
    calls.dispose();
  });

  test('call.participants обновляет список участников текущего звонка', () async {
    final session = await makeSession();
    final calls = CallService(session);
    // Симулируем участие в звонке (без сети room не подключаем).
    calls.currentCall = const CallInfo(id: 2, channelId: 3, status: 'active');
    session.debugEmitEvent('call.participants', {
      'call_id': 2,
      'participants': [1, 2, 3],
    });
    await Future<void>.delayed(Duration.zero);
    expect(calls.currentCall!.participants, [1, 2, 3]);
    calls.dispose();
  });

  test('call.ended при активном звонке очищает состояние', () async {
    final session = await makeSession();
    final calls = CallService(session);
    calls.currentCall = const CallInfo(id: 8, channelId: 3, status: 'active');
    session.debugEmitEvent('call.ended', {'call_id': 8});
    await Future<void>.delayed(Duration.zero);
    expect(calls.currentCall, isNull);
    calls.dispose();
  });

  test('punch не ломает состояние', () async {
    final session = await makeSession();
    final calls = CallService(session);
    session.debugEmitEvent('punch', {'call_id': 1, 'by_user_id': 2, 'by_nick': 'bob'});
    await Future<void>.delayed(Duration.zero);
    expect(calls.inCall, isFalse);
    calls.dispose();
  });

  test('call.participants обновляет список участников', () async {
    final session = await makeSession();
    final calls = CallService(session);
    // Эмулируем участие: без сети inCall=false, но currentCall можно задать
    // через принятие звонка — проверим только обработку события.
    calls.ringing = const CallInfo(id: 2, channelId: 3);
    calls.notifyListeners();
    session.debugEmitEvent('call.participants', {
      'call_id': 2,
      'participants': [1, 2, 3],
    });
    await Future<void>.delayed(Duration.zero);
    // Мы не в комнате (inCall=false) — событие не меняет currentCall.
    expect(calls.currentCall, isNull);
    expect(calls.ringing!.id, 2);
    calls.dispose();
  });
}


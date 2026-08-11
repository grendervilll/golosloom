// FCM-пуши: получение токена, регистрация на сервере Golosloom,
// показ уведомлений на переднем плане (в фоне их показывает сама FCM).
library;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api_client.dart';

// Локальные уведомления для переднего плана (FCM в фоне показывает сама).
final _localNotifications = FlutterLocalNotificationsPlugin();

class PushService {
  final ApiClient api;

  PushService(this.api);

  /// Инициализация: Firebase, разрешения, токен на сервер.
  Future<void> init() async {
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;

      // Android 13+: спрашиваем разрешение на уведомления.
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;

      await _initLocalNotifications();

      // Токен на сервер (и при его смене).
      final token = await messaging.getToken();
      if (token != null) await _registerToken(token);
      messaging.onTokenRefresh.listen((t) => _registerToken(t));

      // Передний план: показываем локальное уведомление.
      FirebaseMessaging.onMessage.listen((message) {
        _showLocal(
          message.notification?.title ?? 'Golosloom',
          message.notification?.body ?? '',
        );
      });
    } catch (_) {
      /* пуши недоступны — не критично */
    }
  }

  Future<void> _initLocalNotifications() async {
    final android = _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    // Канал уведомлений (Android 8+) и инициализация.
    await android?.initialize(settings: const AndroidInitializationSettings('@mipmap/ic_launcher'));
    await android?.createNotificationChannel(const AndroidNotificationChannel(
      'golosloom',
      'Golosloom',
      description: 'Звонки и сообщения',
      importance: Importance.high,
    ));
  }

  Future<void> _registerToken(String token) async {
    try {
      await api.registerFcmToken(token);
    } catch (_) {}
  }

  Future<void> _showLocal(String title, String body) async {
    await _localNotifications.show(
      id: 0,
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          'golosloom',
          'Golosloom',
          channelDescription: 'Звонки и сообщения',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }
}

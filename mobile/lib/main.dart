import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'src/call_service.dart';
import 'src/screens/home_screen.dart';
import 'src/screens/login_screen.dart';
import 'src/session.dart';
import 'src/settings.dart';
import 'src/theme.dart';
import 'src/widgets/mini_call_bar.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterForegroundTask.init(
    androidNotificationOptions: AndroidNotificationOptions(
      channelId: 'golosloom_call',
      channelName: 'Звонки Golosloom',
      channelDescription: 'Звонок продолжается, приложение работает в фоне',
      channelImportance: NotificationChannelImportance.LOW,
      priority: NotificationPriority.LOW,
    ),
    iosNotificationOptions: const IOSNotificationOptions(),
    foregroundTaskOptions: ForegroundTaskOptions(
      eventAction: ForegroundTaskEventAction.nothing(),
      allowWakeLock: true,
      allowWifiLock: true,
    ),
  );
  final prefs = await SharedPreferences.getInstance();
  runApp(GolosloomApp(settings: AppSettings(prefs)));
}

class GolosloomApp extends StatelessWidget {
  final AppSettings settings;

  const GolosloomApp({super.key, required this.settings});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: settings,
      builder: (context, _) => MaterialApp(
        title: 'Golosloom',
        debugShowCheckedModeBanner: false,
        theme: lightTheme(),
        darkTheme: darkTheme(),
        themeMode: settings.darkTheme ? ThemeMode.dark : ThemeMode.light,
        initialRoute: settings.token == null ? '/login' : '/home',
        routes: {
          '/login': (_) => LoginScreen(settings: settings),
          '/home': (_) => HomeScreen(settings: settings),
        },
        // Плашка звонка поверх любого экрана (и навигация из неё).
        builder: (context, child) {
          final calls = CallService.instance;
          final session = Session.instance;
          if (calls == null || session == null || !calls.inCall) return child ?? const SizedBox.shrink();
          return Stack(
            children: [
              child ?? const SizedBox.shrink(),
              Positioned(left: 0, right: 0, bottom: 0, child: MiniCallBar(calls: calls, session: session, chat: HomeScreen.globalChat!)),
            ],
          );
        },
      ),
    );
  }
}

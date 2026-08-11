import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'src/screens/home_screen.dart';
import 'src/screens/login_screen.dart';
import 'src/settings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(GolosloomApp(settings: AppSettings(prefs)));
}

class GolosloomApp extends StatelessWidget {
  final AppSettings settings;

  const GolosloomApp({super.key, required this.settings});

  @override
  Widget build(BuildContext context) {
    const bg = Color(0xFF1E1F22);
    const panel = Color(0xFF2B2D31);
    const accent = Color(0xFF5865F2);
    const text = Color(0xFFDBDEE1);

    return MaterialApp(
      title: 'Golosloom',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: bg,
        colorScheme: const ColorScheme.dark(
          primary: accent,
          surface: panel,
          onSurface: text,
          error: Color(0xFFDA373C),
        ),
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF26282C))),
          enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF26282C))),
          focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: accent)),
        ),
      ),
      initialRoute: settings.token == null ? '/login' : '/home',
      routes: {
        '/login': (_) => LoginScreen(settings: settings),
        '/home': (_) => HomeScreen(settings: settings),
      },
    );
  }
}

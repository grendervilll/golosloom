// Темы приложения: светлая (Telegram-стиль из макета) и тёмная.
// Выбор хранится в настройках (SharedPreferences) и применяется на старте.
library;

import 'package:flutter/material.dart';

/// Палитра текущей темы: обращение через `Theme.of(context).extension<AppColors>()!`.
/// Токены 1:1 с web/src/style.css (--bg, --bg2, --bg3, --bg4, --surface, --bubble…)
class AppColors extends ThemeExtension<AppColors> {
  final Color bg; // --bg
  final Color bg2; // --bg2
  final Color bg3; // --bg3
  final Color bg4; // --bg4
  final Color surface; // --surface
  final Color bubble; // --bubble (входящий)
  final Color bubbleIn; // alias bubble
  final Color bubbleOut; // пузырь исходящего (accent)
  final Color text; // --text
  final Color textDim; // --text-dim
  final Color accent; // --accent
  final Color accentHover; // --accent-hover
  final Color green; // --green
  final Color yellow; // --yellow
  final Color online; // alias green
  final Color border; // --border
  final Color danger; // --red
  final Color welcomeBg; // --welcome-bg

  const AppColors({
    required this.bg,
    required this.bg2,
    required this.bg3,
    required this.bg4,
    required this.surface,
    required this.bubble,
    required this.bubbleIn,
    required this.bubbleOut,
    required this.text,
    required this.textDim,
    required this.accent,
    required this.accentHover,
    required this.green,
    required this.yellow,
    required this.online,
    required this.border,
    required this.danger,
    required this.welcomeBg,
  });

  static AppColors of(BuildContext context) =>
      Theme.of(context).extension<AppColors>()!;

  @override
  AppColors copyWith({
    Color? bg,
    Color? bg2,
    Color? bg3,
    Color? bg4,
    Color? surface,
    Color? bubble,
    Color? bubbleIn,
    Color? bubbleOut,
    Color? text,
    Color? textDim,
    Color? accent,
    Color? accentHover,
    Color? green,
    Color? yellow,
    Color? online,
    Color? border,
    Color? danger,
    Color? welcomeBg,
  }) {
    return AppColors(
      bg: bg ?? this.bg,
      bg2: bg2 ?? this.bg2,
      bg3: bg3 ?? this.bg3,
      bg4: bg4 ?? this.bg4,
      surface: surface ?? this.surface,
      bubble: bubble ?? this.bubble,
      bubbleIn: bubbleIn ?? this.bubbleIn,
      bubbleOut: bubbleOut ?? this.bubbleOut,
      text: text ?? this.text,
      textDim: textDim ?? this.textDim,
      accent: accent ?? this.accent,
      accentHover: accentHover ?? this.accentHover,
      green: green ?? this.green,
      yellow: yellow ?? this.yellow,
      online: online ?? this.online,
      border: border ?? this.border,
      danger: danger ?? this.danger,
      welcomeBg: welcomeBg ?? this.welcomeBg,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      bg: Color.lerp(bg, other.bg, t)!,
      bg2: Color.lerp(bg2, other.bg2, t)!,
      bg3: Color.lerp(bg3, other.bg3, t)!,
      bg4: Color.lerp(bg4, other.bg4, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      bubble: Color.lerp(bubble, other.bubble, t)!,
      bubbleIn: Color.lerp(bubbleIn, other.bubbleIn, t)!,
      bubbleOut: Color.lerp(bubbleOut, other.bubbleOut, t)!,
      text: Color.lerp(text, other.text, t)!,
      textDim: Color.lerp(textDim, other.textDim, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentHover: Color.lerp(accentHover, other.accentHover, t)!,
      green: Color.lerp(green, other.green, t)!,
      yellow: Color.lerp(yellow, other.yellow, t)!,
      online: Color.lerp(online, other.online, t)!,
      border: Color.lerp(border, other.border, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      welcomeBg: Color.lerp(welcomeBg, other.welcomeBg, t)!,
    );
  }
}

/// Светлая тема — 1:1 с web/src/style.css :root (Telegram-стиль).
ThemeData lightTheme() {
  const colors = AppColors(
    bg: Color(0xFFFFFFFF), // --bg
    bg2: Color(0xFFF7F8FA),
    bg3: Color(0xFFF1F5F9),
    bg4: Color(0xFFE9E9E9),
    surface: Color(0xFFFFFFFF), // --surface
    bubble: Color(0xFFFFFFFF), // --bubble
    bubbleIn: Color(0xFFFFFFFF),
    bubbleOut: Color(0xFF2AABEE), // accent
    text: Color(0xFF172121),
    textDim: Color(0xFF707579),
    accent: Color(0xFF2AABEE), // --ui-primary
    accentHover: Color(0xFF1D97D4),
    green: Color(0xFF23A55A),
    yellow: Color(0xFFF0B232),
    online: Color(0xFF23A55A),
    border: Color(0xFFE9E9E9),
    danger: Color(0xFFDA373C),
    welcomeBg: Color(0xFFF4F7F9),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: colors.bg,
    fontFamily: 'Segoe UI',
    textTheme: const TextTheme(
      bodyMedium: TextStyle(fontSize: 15, height: 1.35),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
    ),
    colorScheme: ColorScheme.light(
      primary: colors.accent,
      surface: colors.surface,
      onSurface: colors.text,
      error: colors.danger,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      foregroundColor: colors.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: colors.text, fontSize: 18, fontWeight: FontWeight.w700, fontFamily: 'Segoe UI'),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.bg3,
      hintStyle: TextStyle(color: colors.textDim),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(24),
        borderSide: BorderSide.none,
      ),
    ),
    dialogTheme: DialogThemeData(backgroundColor: colors.surface),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: colors.surface),
    dividerTheme: DividerThemeData(color: colors.border, thickness: 0.5),
    extensions: const [colors],
  );
}

/// Тёмная тема — 1:1 с :root[data-theme='dark'] (Discord-стиль).
ThemeData darkTheme() {
  const colors = AppColors(
    bg: Color(0xFF1E1F22), // --bg
    bg2: Color(0xFF2B2D31),
    bg3: Color(0xFF313338),
    bg4: Color(0xFF383A40),
    surface: Color(0xFF111214), // --surface
    bubble: Color(0xFF2B2D31), // --bubble
    bubbleIn: Color(0xFF2B2D31),
    bubbleOut: Color(0xFF2AABEE),
    text: Color(0xFFDBDEE1),
    textDim: Color(0xFF949BA4),
    accent: Color(0xFF2AABEE),
    accentHover: Color(0xFF1D97D4),
    green: Color(0xFF23A55A),
    yellow: Color(0xFFF0B232),
    online: Color(0xFF23A55A),
    border: Color(0xFF26282C),
    danger: Color(0xFFDA373C),
    welcomeBg: Color(0xFF222427),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: colors.bg,
    fontFamily: 'Segoe UI',
    textTheme: const TextTheme(
      bodyMedium: TextStyle(fontSize: 15, height: 1.35),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
    ),
    colorScheme: ColorScheme.dark(
      primary: colors.accent,
      surface: colors.surface,
      onSurface: colors.text,
      error: colors.danger,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.bg, // web: header bg var(--bg) border-bottom
      foregroundColor: colors.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: colors.text, fontSize: 15, fontWeight: FontWeight.w600, fontFamily: 'Segoe UI'),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.bg3,
      hintStyle: TextStyle(color: colors.textDim),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(24),
        borderSide: BorderSide.none,
      ),
    ),
    dialogTheme: DialogThemeData(backgroundColor: colors.bg2),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: colors.bg2),
    dividerTheme: DividerThemeData(color: colors.border, thickness: 0.5),
    extensions: const [colors],
  );
}

/// Форматирование времени последнего сообщения: сегодня — ЧЧ:ММ,
/// вчера — «Вчера», иначе — «28 янв».
String chatTime(DateTime t) {
  final now = DateTime.now();
  final local = t.toLocal();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(local.year, local.month, local.day);
  if (day == today) {
    final h = local.hour.toString().padLeft(2, '0');
    final m = local.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }
  if (day == today.subtract(const Duration(days: 1))) return 'Вчера';
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  if (local.year == now.year) return '${local.day} ${months[local.month - 1]}';
  return '${local.day} ${months[local.month - 1]} ${local.year}';
}

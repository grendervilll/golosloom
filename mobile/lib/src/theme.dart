// Темы приложения: светлая (Telegram-стиль из макета) и тёмная.
// Выбор хранится в настройках (SharedPreferences) и применяется на старте.
library;

import 'package:flutter/material.dart';

/// Палитра текущей темы: обращение через `Theme.of(context).extension<AppColors>()!`.
class AppColors extends ThemeExtension<AppColors> {
  final Color bg; // фон экрана чата / списка
  final Color surface; // панели, шапки, поле ввода
  final Color bubbleIn; // пузырь входящего
  final Color bubbleOut; // пузырь исходящего
  final Color text;
  final Color textDim;
  final Color accent;
  final Color online;
  final Color border;
  final Color danger;

  const AppColors({
    required this.bg,
    required this.surface,
    required this.bubbleIn,
    required this.bubbleOut,
    required this.text,
    required this.textDim,
    required this.accent,
    required this.online,
    required this.border,
    required this.danger,
  });

  static AppColors of(BuildContext context) =>
      Theme.of(context).extension<AppColors>()!;

  @override
  AppColors copyWith({
    Color? bg,
    Color? surface,
    Color? bubbleIn,
    Color? bubbleOut,
    Color? text,
    Color? textDim,
    Color? accent,
    Color? online,
    Color? border,
    Color? danger,
  }) {
    return AppColors(
      bg: bg ?? this.bg,
      surface: surface ?? this.surface,
      bubbleIn: bubbleIn ?? this.bubbleIn,
      bubbleOut: bubbleOut ?? this.bubbleOut,
      text: text ?? this.text,
      textDim: textDim ?? this.textDim,
      accent: accent ?? this.accent,
      online: online ?? this.online,
      border: border ?? this.border,
      danger: danger ?? this.danger,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      bg: Color.lerp(bg, other.bg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      bubbleIn: Color.lerp(bubbleIn, other.bubbleIn, t)!,
      bubbleOut: Color.lerp(bubbleOut, other.bubbleOut, t)!,
      text: Color.lerp(text, other.text, t)!,
      textDim: Color.lerp(textDim, other.textDim, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      online: Color.lerp(online, other.online, t)!,
      border: Color.lerp(border, other.border, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
    );
  }
}

/// Светлая тема — по макетам (chat-list / active-chat / contact-profile).
ThemeData lightTheme() {
  const colors = AppColors(
    bg: Color(0xFFF4F6F9),
    surface: Color(0xFFFFFFFF),
    bubbleIn: Color(0xFFF1F5F9),
    bubbleOut: Color(0xFF0088CC),
    text: Color(0xFF1D1B20),
    textDim: Color(0xFF707579),
    accent: Color(0xFF0088CC),
    online: Color(0xFF0088CC),
    border: Color(0xFFE4E9EC),
    danger: Color(0xFFDA373C),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: colors.bg,
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
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFFF1F5F9),
      hintStyle: TextStyle(color: colors.textDim),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(24),
        borderSide: BorderSide.none,
      ),
    ),
    dialogTheme: DialogThemeData(backgroundColor: colors.surface),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: colors.surface),
    extensions: const [colors],
  );
}

/// Тёмная тема — продолжение прежней палитры.
ThemeData darkTheme() {
  const colors = AppColors(
    bg: Color(0xFF1E1F22),
    surface: Color(0xFF2B2D31),
    bubbleIn: Color(0xFF313338),
    bubbleOut: Color(0xFF2AABEE),
    text: Color(0xFFDBDEE1),
    textDim: Color(0xFF949BA4),
    accent: Color(0xFF2AABEE),
    online: Color(0xFF23A55A),
    border: Color(0xFF26282C),
    danger: Color(0xFFDA373C),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: colors.bg,
    colorScheme: ColorScheme.dark(
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
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.bubbleIn,
      hintStyle: TextStyle(color: colors.textDim),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(24),
        borderSide: BorderSide.none,
      ),
    ),
    dialogTheme: DialogThemeData(backgroundColor: colors.surface),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: colors.surface),
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

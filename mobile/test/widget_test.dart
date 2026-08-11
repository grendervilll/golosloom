// Смоук-тест приложения: запуск с пустыми настройками показывает экран входа.
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:golosloom_mobile/main.dart';
import 'package:golosloom_mobile/src/settings.dart';

void main() {
  testWidgets('при пустых настройках открывается экран входа', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(GolosloomApp(settings: AppSettings(prefs)));
    await tester.pumpAndSettle();

    expect(find.text('Golosloom'), findsOneWidget);
    expect(find.text('Вход на сервер'), findsOneWidget);
  });
}

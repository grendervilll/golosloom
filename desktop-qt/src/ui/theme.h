#pragma once
#include <QString>

namespace gl {

// Тема в стиле веб-клиента (Telegram-палитра):
// светлая по умолчанию, тёмная — по системной настройке (как в вебе).
// Выбор пользователя сохраняется в QSettings (ключ "theme").
bool systemPrefersDark();
QString themeQss(bool dark);
bool savedThemeDark();
void saveThemeDark(bool dark);

}  // namespace gl

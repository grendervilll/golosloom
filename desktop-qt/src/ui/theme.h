#pragma once
#include <QString>

namespace gl {

// Тема в стиле веб-клиента (Telegram-палитра):
// светлая по умолчанию, тёмная — по системной настройке (как в вебе).
bool systemPrefersDark();
QString themeQss(bool dark);

}  // namespace gl

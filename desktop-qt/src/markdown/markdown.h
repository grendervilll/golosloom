#pragma once
#include <QString>

namespace gl {

// Markdown → HTML для QTextDocument. Подмножество: заголовки, жирный,
// курсив, код, ссылки (только http/https), списки, цитаты, зачёркнутый.
QString markdownToHtml(const QString& md);

}  // namespace gl

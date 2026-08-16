#include "markdown/markdown.h"

#include <QRegularExpression>

namespace gl {

namespace {

QString escapeHtml(QString s) {
  s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
  return s;
}

QString inlineFormat(const QString& line) {
  QString out = escapeHtml(line);
  // Ссылки https/http (безопасно)
  static const QRegularExpression linkRe(
      R"((https?:\/\/[^\s<>"']+))");
  out.replace(linkRe, R"(<a href="\1" style="color:#5b9dff">\1</a>)");
  // `код`
  static const QRegularExpression codeRe("`([^`]+)`");
  out.replace(codeRe, R"(<code style="background:#1e2530;border-radius:4px;padding:0 4px;font-family:monospace">\1</code>)");
  // **жирный**
  static const QRegularExpression boldRe(R"(\*\*([^*]+)\*\*)");
  out.replace(boldRe, R"(<b>\1</b>)");
  // *курсив*
  static const QRegularExpression italRe(R"(\*([^*]+)\*)");
  out.replace(italRe, R"(<i>\1</i>)");
  // ~~зачёркнутый~~
  static const QRegularExpression strikeRe(R"(~~([^~]+)~~)");
  out.replace(strikeRe, R"(<s>\1</s>)");
  return out;
}

}  // namespace

QString markdownToHtml(const QString& md) {
  const QStringList lines = md.split('\n');
  QString html;
  bool inCode = false;
  QString codeBuf;
  bool inList = false;
  bool inQuote = false;

  auto closeBlocks = [&]() {
    if (inCode) {
      html += "</code></pre>";
      inCode = false;
    }
    if (inList) {
      html += "</ul>";
      inList = false;
    }
    if (inQuote) {
      html += "</blockquote>";
      inQuote = false;
    }
  };

  for (const QString& raw : lines) {
    QString line = raw;
    if (line.trimmed().startsWith("```")) {
      if (inCode) {
        html += escapeHtml(codeBuf) + "</code></pre>";
        codeBuf.clear();
        inCode = false;
      } else {
        closeBlocks();
        html += "<pre style=\"background:#1e2530;border-radius:8px;padding:8px;\"><code>";
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf += raw + "\n";
      continue;
    }
    if (line.trimmed().isEmpty()) {
      closeBlocks();
      html += "<br/>";
      continue;
    }
    // Заголовки
    if (line.startsWith("### ")) {
      closeBlocks();
      html += "<h3>" + inlineFormat(line.mid(4)) + "</h3>";
      continue;
    }
    if (line.startsWith("## ")) {
      closeBlocks();
      html += "<h2>" + inlineFormat(line.mid(3)) + "</h2>";
      continue;
    }
    if (line.startsWith("# ")) {
      closeBlocks();
      html += "<h1>" + inlineFormat(line.mid(2)) + "</h1>";
      continue;
    }
    // Цитата
    if (line.startsWith("> ")) {
      if (!inQuote) {
        closeBlocks();
        html += "<blockquote style=\"border-left:3px solid #3a4454;padding-left:8px;color:#9aa4b2;\">";
        inQuote = true;
      }
      html += inlineFormat(line.mid(2)) + "<br/>";
      continue;
    }
    if (inQuote) {
      closeBlocks();
    }
    // Список
    const QRegularExpression itemRe(R"(^\s*[-*]\s+(.*)$)");
    const QRegularExpressionMatch item = itemRe.match(line);
    if (item.hasMatch()) {
      if (!inList) {
        closeBlocks();
        html += "<ul style=\"margin:4px 0;padding-left:20px;\">";
        inList = true;
      }
      html += "<li>" + inlineFormat(item.captured(1)) + "</li>";
      continue;
    }
    if (inList) {
      closeBlocks();
    }
    html += "<p>" + inlineFormat(line) + "</p>";
  }
  closeBlocks();
  return html;
}

}  // namespace gl

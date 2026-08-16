#include "ui/theme.h"

#include <QApplication>
#include <QSettings>
#include <QStyleHints>

namespace gl {

bool systemPrefersDark() {
  return QApplication::styleHints()->colorScheme() == Qt::ColorScheme::Dark;
}

// Тема пользователя: явный выбор из QSettings, иначе — системная.
bool savedThemeDark() {
  QSettings settings;
  if (settings.contains("theme")) {
    return settings.value("theme").toString() == "dark";
  }
  return systemPrefersDark();
}

void saveThemeDark(bool dark) {
  QSettings settings;
  settings.setValue("theme", dark ? "dark" : "light");
}

QString themeQss(bool dark) {
  if (dark) {
    // Тёмная палитра веб-клиента (:root[data-theme='dark']).
    return R"QSS(
* { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; }
QMainWindow, QDialog { background: #1e1f22; color: #dbdee1; }
QWidget { color: #dbdee1; }

#sidebar { background: #2b2d31; border-right: 1px solid #26282c; }
#channelList { background: transparent; }
#chatPanel { background: #313338; }

QScrollArea { border: none; background: transparent; }
QScrollBar:vertical { background: transparent; width: 8px; }
QScrollBar::handle:vertical { background: #383a40; border-radius: 4px; min-height: 30px; }
QScrollBar::add-line, QScrollBar::sub-line { height: 0; }

QLabel#chatTitle { font-size: 17px; font-weight: 700; }

#inputField {
  background: #1e1f22; border: 1px solid #26282c; border-radius: 12px;
  padding: 10px 14px; font-size: 14px; color: #dbdee1;
  selection-background-color: #2aabee;
}
#inputField:focus { border-color: #2aabee; }

QPushButton {
  background: #2aabee; color: white; border: none; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; font-weight: 600;
}
QPushButton:hover { background: #1d97d4; }
QPushButton:disabled { background: #383a40; color: #6b7686; }
QPushButton#ghost { background: transparent; color: #949ba4; border: 1px solid #26282c; }
QPushButton#ghost:hover { background: #383a40; }
QPushButton#rowBtn { background: transparent; text-align: left; border-radius: 10px; padding: 8px 10px; color: #b0b7bf; }
QPushButton#rowBtn:hover { background: #383a40; }
QPushButton#rowBtn:checked { background: #404249; color: #ffffff; }

#dateSeparator {
  background: #383a40; border-radius: 10px; padding: 2px 10px;
  color: #b0b7bf; font-size: 12px; font-weight: 600;
}

QWidget#chatRow { border-radius: 10px; }
QWidget#chatRow:hover { background: #383a40; }
QWidget#chatRow[active="true"] { background: #2aabee; }
QWidget#chatRow[active="true"] QLabel { color: #ffffff; }
#chatName { font-size: 15px; font-weight: 600; color: #dbdee1; }
#chatTime { font-size: 12px; color: #949ba4; }
#chatPreview { font-size: 13px; color: #949ba4; }
QWidget#chatRow[active="true"] #chatPreview,
QWidget#chatRow[active="true"] #chatTime { color: rgba(255, 255, 255, 0.85); }
#unreadBadge {
  background: #2aabee; color: white; border-radius: 10px;
  min-width: 20px; padding: 1px 6px; font-size: 11px; font-weight: 600;
  qproperty-alignment: AlignCenter;
}
QWidget#chatRow[active="true"] #unreadBadge { background: #ffffff; color: #2aabee; }
#typingLabel { color: #2aabee; font-size: 12px; }
#invitesBadge {
  background: #f0b232; color: #172121; border-radius: 9px;
  min-width: 16px; max-width: 16px; padding: 1px 0; font-size: 11px; font-weight: 700;
  qproperty-alignment: AlignCenter;
}
#modeRow { background: #2b2d31; border-top: 1px solid #383a40; }
#modeLabel { color: #949ba4; font-size: 12px; }
#msgAtts QPushButton { border-radius: 6px; padding: 4px 8px; }

QPushButton#downBtn {
  background: #2b2d31; border: 1px solid #383a40; border-radius: 20px;
  font-size: 18px; color: #dbdee1; padding: 0;
}
QPushButton#downBtn:hover { background: #383a40; }

#msgBubble[pending="true"] { opacity: 0.55; }

QLineEdit, QTextEdit {
  background: #1e1f22; border: 1px solid #26282c; border-radius: 10px;
  padding: 8px 12px; font-size: 14px; color: #dbdee1; selection-background-color: #2aabee;
}
QLineEdit:focus, QTextEdit:focus { border-color: #2aabee; }

QLineEdit#searchField {
  background: #313338; border: none; border-radius: 18px;
  padding: 6px 14px; font-size: 14px;
}

#msgBubble { background: #2b2d31; border: 1px solid #383a40; border-radius: 14px; border-top-left-radius: 4px; }
#msgBubble:hover { background: #313338; }
#msgBubble.mine { background: #2aabee; border-color: #2aabee; border-radius: 14px; border-top-right-radius: 4px; }
#msgBubble.mine:hover { background: #1d97d4; }
#msgBubble.mine .QLabel { color: #ffffff; }
#msgNick { color: #5ab8ff; font-weight: 600; font-size: 12px; }
#msgTime { color: #949ba4; font-size: 11px; }
#msgBubble.mine #msgTime { color: rgba(255, 255, 255, 0.8); }
#encLabel { color: #949ba4; font-style: italic; }
#msgAtts QPushButton { color: #5ab8ff; }
#msgBubble.mine #msgAtts QPushButton { color: #ffffff; }
#replyQuote {
  background: #383a40; border-radius: 8px; padding: 4px 10px;
  font-size: 12px; color: #949ba4;
}
#msgBubble.mine #replyQuote { background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.9); }

QDialog#authDialog {
  background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
      stop:0 #2b2d31, stop:1 #1e1f22);
}
#loginCard { background: #2b2d31; border: 1px solid #383a40; border-radius: 12px; }
#loginTitle { font-size: 24px; font-weight: 800; }
#hintLabel { color: #949ba4; font-size: 12px; }
#errorLabel { color: #da373c; font-size: 12px; }

#toast { background: #2b2d31; border: 1px solid #383a40; border-radius: 12px; }
#toastTitle { font-size: 14px; font-weight: 700; color: #dbdee1; }
#toastBody { font-size: 13px; color: #949ba4; }

#callCard {
  background: #2b2d31; border: 1px solid #404249; border-radius: 14px;
  padding: 8px;
}
#callTitle { font-size: 15px; font-weight: 800; color: #dbdee1; padding: 4px 0; }
#callNick { font-size: 14px; color: #949ba4; padding-bottom: 4px; }
QPushButton#callAccept {
  background: #23a55a; color: white; border: none; border-radius: 8px;
  padding: 8px 16px; font-weight: 600;
}
QPushButton#callAccept:hover { background: #1a7f44; }
QPushButton#callDecline {
  background: #da373c; color: white; border: none; border-radius: 8px;
  padding: 8px 16px; font-weight: 600;
}
QPushButton#callDecline:hover { background: #b02e33; }
)QSS";
  }
  // Светлая палитра веб-клиента (:root, Telegram-стиль).
  return R"QSS(
* { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; }
QMainWindow, QDialog { background: #ffffff; color: #172121; }
QWidget { color: #172121; }

#sidebar { background: #f7f8fa; border-right: 1px solid #e9e9e9; }
#channelList { background: transparent; }
#chatPanel { background: #ffffff; }

QScrollArea { border: none; background: transparent; }
QScrollBar:vertical { background: transparent; width: 8px; }
QScrollBar::handle:vertical { background: #e9e9e9; border-radius: 4px; min-height: 30px; }
QScrollBar::add-line, QScrollBar::sub-line { height: 0; }

QLabel#chatTitle { font-size: 17px; font-weight: 700; }

#inputField {
  background: #f7f8fa; border: 1px solid #e9e9e9; border-radius: 12px;
  padding: 10px 14px; font-size: 14px; color: #172121;
  selection-background-color: #2aabee;
}
#inputField:focus { border-color: #2aabee; }

QPushButton {
  background: #2aabee; color: white; border: none; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; font-weight: 600;
}
QPushButton:hover { background: #1d97d4; }
QPushButton:disabled { background: #e9e9e9; color: #707579; }
QPushButton#ghost { background: transparent; color: #707579; border: 1px solid #e9e9e9; }
QPushButton#ghost:hover { background: #f7f8fa; }
QPushButton#rowBtn { background: transparent; text-align: left; border-radius: 10px; padding: 8px 10px; color: #707579; }
QPushButton#rowBtn:hover { background: #f1f5f9; }
QPushButton#rowBtn:checked { background: #e6f3fb; color: #172121; }

#dateSeparator {
  background: #f1f5f9; border-radius: 10px; padding: 2px 10px;
  color: #707579; font-size: 12px; font-weight: 600;
}

QWidget#chatRow { border-radius: 10px; }
QWidget#chatRow:hover { background: #f1f5f9; }
QWidget#chatRow[active="true"] { background: #2aabee; }
QWidget#chatRow[active="true"] QLabel { color: #ffffff; }
#chatName { font-size: 15px; font-weight: 600; color: #172121; }
#chatTime { font-size: 12px; color: #999999; }
#chatPreview { font-size: 13px; color: #707579; }
QWidget#chatRow[active="true"] #chatPreview,
QWidget#chatRow[active="true"] #chatTime { color: rgba(255, 255, 255, 0.85); }
#unreadBadge {
  background: #2aabee; color: white; border-radius: 10px;
  min-width: 20px; padding: 1px 6px; font-size: 11px; font-weight: 600;
  qproperty-alignment: AlignCenter;
}
QWidget#chatRow[active="true"] #unreadBadge { background: #ffffff; color: #2aabee; }
#typingLabel { color: #2aabee; font-size: 12px; }
#invitesBadge {
  background: #f0b232; color: #172121; border-radius: 9px;
  min-width: 16px; max-width: 16px; padding: 1px 0; font-size: 11px; font-weight: 700;
  qproperty-alignment: AlignCenter;
}
#modeRow { background: #f7f8fa; border-top: 1px solid #e9e9e9; }
#modeLabel { color: #707579; font-size: 12px; }
#msgAtts QPushButton { border-radius: 6px; padding: 4px 8px; }

QPushButton#downBtn {
  background: #ffffff; border: 1px solid #e9e9e9; border-radius: 20px;
  font-size: 18px; color: #172121; padding: 0;
}
QPushButton#downBtn:hover { background: #f1f5f9; }

#msgBubble[pending="true"] { opacity: 0.55; }

QLineEdit, QTextEdit {
  background: #f7f8fa; border: 1px solid #e9e9e9; border-radius: 10px;
  padding: 8px 12px; font-size: 14px; color: #172121; selection-background-color: #2aabee;
}
QLineEdit:focus, QTextEdit:focus { border-color: #2aabee; }

QLineEdit#searchField {
  background: #f1f5f9; border: none; border-radius: 18px;
  padding: 6px 14px; font-size: 14px;
}

#msgBubble { background: #ffffff; border: 1px solid #e9e9e9; border-radius: 14px; border-top-left-radius: 4px; }
#msgBubble:hover { background: #f7f8fa; }
#msgBubble.mine { background: #2aabee; border-color: #2aabee; border-radius: 14px; border-top-right-radius: 4px; }
#msgBubble.mine:hover { background: #1d97d4; }
#msgBubble.mine .QLabel { color: #ffffff; }
#msgNick { color: #1d97d4; font-weight: 600; font-size: 12px; }
#msgTime { color: #707579; font-size: 11px; }
#msgBubble.mine #msgTime { color: rgba(255, 255, 255, 0.8); }
#encLabel { color: #707579; font-style: italic; }
#msgAtts QPushButton { color: #1d97d4; }
#msgBubble.mine #msgAtts QPushButton { color: #ffffff; }
#replyQuote {
  background: #f1f5f9; border-radius: 8px; padding: 4px 10px;
  font-size: 12px; color: #707579;
}
#msgBubble.mine #replyQuote { background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.9); }

QDialog#authDialog {
  background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
      stop:0 #e9e9e9, stop:1 #d7dde3);
}
#loginCard { background: #ffffff; border: 1px solid #e9e9e9; border-radius: 12px; }
#loginTitle { font-size: 24px; font-weight: 800; }
#hintLabel { color: #707579; font-size: 12px; }
#errorLabel { color: #da373c; font-size: 12px; }

#toast { background: #ffffff; border: 1px solid #e9e9e9; border-radius: 12px; }
#toastTitle { font-size: 14px; font-weight: 700; color: #172121; }
#toastBody { font-size: 13px; color: #707579; }

#callCard {
  background: #ffffff; border: 1px solid #d6effd; border-radius: 14px;
  padding: 8px;
}
#callTitle { font-size: 15px; font-weight: 800; color: #172121; padding: 4px 0; }
#callNick { font-size: 14px; color: #707579; padding-bottom: 4px; }
QPushButton#callAccept {
  background: #23a55a; color: white; border: none; border-radius: 8px;
  padding: 8px 16px; font-weight: 600;
}
QPushButton#callAccept:hover { background: #1a7f44; }
QPushButton#callDecline {
  background: #da373c; color: white; border: none; border-radius: 8px;
  padding: 8px 16px; font-weight: 600;
}
QPushButton#callDecline:hover { background: #b02e33; }
)QSS";
}

}  // namespace gl

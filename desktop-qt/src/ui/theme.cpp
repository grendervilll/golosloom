#include "ui/theme.h"

#include <QApplication>
#include <QStyleHints>

namespace gl {

bool systemPrefersDark() {
  return QApplication::styleHints()->colorScheme() == Qt::ColorScheme::Dark;
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

#msgBubble { background: #2b2d31; border-radius: 14px; }
#msgBubble.mine { background: #1d6da8; }
#msgBubble .QLabel { color: #dbdee1; }
#msgNick { color: #2aabee; font-weight: 600; font-size: 12px; }
#msgTime { color: #949ba4; font-size: 11px; }
#encLabel { color: #949ba4; font-style: italic; }

#loginCard { background: #2b2d31; border: 1px solid #26282c; border-radius: 16px; }
#loginTitle { font-size: 20px; font-weight: 800; }
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

#msgBubble { background: #ffffff; border: 1px solid #e9e9e9; border-radius: 14px; }
#msgBubble.mine { background: #eef8ff; border-color: #d6effd; }
#msgBubble .QLabel { color: #172121; }
#msgNick { color: #2aabee; font-weight: 600; font-size: 12px; }
#msgTime { color: #707579; font-size: 11px; }
#encLabel { color: #707579; font-style: italic; }

#loginCard { background: #ffffff; border: 1px solid #e9e9e9; border-radius: 16px; }
#loginTitle { font-size: 20px; font-weight: 800; }
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

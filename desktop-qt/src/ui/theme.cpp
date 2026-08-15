#include "ui/theme.h"

namespace gl {

QString themeQss() {
  return R"QSS(
* { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; }
QMainWindow, QDialog { background: #11151c; color: #e6e9ee; }
QWidget { color: #e6e9ee; }

#sidebar { background: #151a23; border-right: 1px solid #1f2631; }
#channelList { background: transparent; }
#chatPanel { background: #11151c; }

QScrollArea { border: none; background: transparent; }
QScrollBar:vertical { background: transparent; width: 8px; }
QScrollBar::handle:vertical { background: #2a3342; border-radius: 4px; min-height: 30px; }
QScrollBar::add-line, QScrollBar::sub-line { height: 0; }

QLabel#chatTitle { font-size: 17px; font-weight: 700; }

#inputField {
  background: #1a2029; border: 1px solid #232b38; border-radius: 12px;
  padding: 10px 14px; font-size: 14px; color: #e6e9ee;
  selection-background-color: #2d6cdf;
}
#inputField:focus { border-color: #2d6cdf; }

QPushButton {
  background: #2d6cdf; color: white; border: none; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; font-weight: 600;
}
QPushButton:hover { background: #3b7ae8; }
QPushButton:disabled { background: #26303f; color: #6b7686; }
QPushButton#ghost { background: transparent; color: #9aa4b2; border: 1px solid #232b38; }
QPushButton#ghost:hover { background: #1a2029; }
QPushButton#rowBtn { background: transparent; text-align: left; border-radius: 10px; padding: 8px 10px; color: #c6cdd7; }
QPushButton#rowBtn:hover { background: #1b2230; }
QPushButton#rowBtn:checked { background: #232e44; color: #ffffff; }

QLineEdit, QTextEdit {
  background: #1a2029; border: 1px solid #232b38; border-radius: 10px;
  padding: 8px 12px; font-size: 14px; color: #e6e9ee; selection-background-color: #2d6cdf;
}
QLineEdit:focus, QTextEdit:focus { border-color: #2d6cdf; }

#msgBubble { background: #1a2029; border-radius: 12px; }
#msgBubble.mine { background: #1d3a6e; }
#msgBubble .QLabel { color: #e6e9ee; }
#msgNick { color: #5b9dff; font-weight: 600; font-size: 12px; }
#msgTime { color: #7c8694; font-size: 11px; }
#encLabel { color: #8a93a2; font-style: italic; }

#loginCard { background: #171c26; border: 1px solid #232b38; border-radius: 16px; }
#loginTitle { font-size: 20px; font-weight: 800; }
#hintLabel { color: #7c8694; font-size: 12px; }
#errorLabel { color: #ff6b6b; font-size: 12px; }
)QSS";
}

}  // namespace gl

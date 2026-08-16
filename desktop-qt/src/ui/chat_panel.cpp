#include "ui/chat_panel.h"

#include <QFileDialog>
#include <QHBoxLayout>
#include <QLabel>
#include <QMessageBox>
#include <QPushButton>
#include <QScrollBar>
#include <QVBoxLayout>

#include "core/app_state.h"
#include "ui/message_widget.h"

namespace gl {

namespace {

// «Сегодня» / «Вчера» / дата (как разделители дат в вебе).
QString dateLabel(const QString& iso) {
  const QDateTime dt = QDateTime::fromString(iso, Qt::ISODate);
  if (!dt.isValid()) return QString();
  const QDate d = dt.toLocalTime().date();
  const QDate today = QDate::currentDate();
  if (d == today) return "Сегодня";
  if (d == today.addDays(-1)) return "Вчера";
  return QLocale().toString(d, QLocale::LongFormat);
}

}  // namespace

ChatPanel::ChatPanel(AppState* state, QWidget* parent) : QWidget(parent), state_(state) {
  setObjectName("chatPanel");
  auto* lay = new QVBoxLayout(this);
  lay->setContentsMargins(0, 0, 0, 0);
  lay->setSpacing(0);

  // Шапка: название, индикатор «печатает…», кнопка звонка.
  auto* header = new QWidget(this);
  header->setObjectName("sidebar");
  auto* hlay = new QHBoxLayout(header);
  hlay->setContentsMargins(16, 12, 16, 12);
  title_ = new QLabel("", header);
  title_->setObjectName("chatTitle");
  hlay->addWidget(title_);
  typingLabel_ = new QLabel("", header);
  typingLabel_->setObjectName("typingLabel");
  typingLabel_->setVisible(false);
  hlay->addWidget(typingLabel_);
  hlay->addStretch();
  membersBtn_ = new QPushButton("👥", header);
  membersBtn_->setObjectName("rowBtn");
  membersBtn_->setToolTip("Участники канала");
  membersBtn_->setVisible(false);
  hlay->addWidget(membersBtn_);
  callBtn_ = new QPushButton("📞", header);
  callBtn_->setObjectName("rowBtn");
  callBtn_->setToolTip("Начать звонок в канале");
  callBtn_->setVisible(false);
  hlay->addWidget(callBtn_);
  lay->addWidget(header);

  scroll_ = new QScrollArea(this);
  scroll_->setWidgetResizable(true);
  container_ = new QWidget(scroll_);
  container_->setObjectName("chatPanel");
  msgsLayout_ = new QVBoxLayout(container_);
  msgsLayout_->setContentsMargins(16, 12, 16, 12);
  msgsLayout_->setSpacing(6);
  msgsLayout_->addStretch();
  scroll_->setWidget(container_);
  lay->addWidget(scroll_, 1);
  // Подгрузка старых сообщений при прокрутке вверх.
  connect(scroll_->verticalScrollBar(), &QScrollBar::valueChanged, this, [this](int value) {
    Q_UNUSED(value);
    maybeLoadOlder();
  });

  // Панель режима (ответ/редактирование).
  modeRow_ = new QWidget(this);
  modeRow_->setObjectName("modeRow");
  auto* mrow = new QHBoxLayout(modeRow_);
  mrow->setContentsMargins(16, 4, 16, 0);
  mrow->setSpacing(8);
  modeLabel_ = new QLabel("", modeRow_);
  modeLabel_->setObjectName("modeLabel");
  cancelBtn_ = new QPushButton("✕", modeRow_);
  cancelBtn_->setObjectName("ghost");
  cancelBtn_->setFixedSize(28, 28);
  mrow->addWidget(modeLabel_, 1);
  mrow->addWidget(cancelBtn_);
  modeRow_->setVisible(false);
  lay->addWidget(modeRow_);

  auto* inputRow = new QWidget(this);
  auto* ilay = new QHBoxLayout(inputRow);
  ilay->setContentsMargins(16, 10, 16, 12);
  attachBtn_ = new QPushButton("📎", inputRow);
  attachBtn_->setObjectName("ghost");
  attachBtn_->setFixedSize(36, 46);
  ilay->addWidget(attachBtn_);
  input_ = new QTextEdit(inputRow);
  input_->setObjectName("inputField");
  input_->setPlaceholderText("Сообщение в чат...");
  input_->setFixedHeight(46);
  ilay->addWidget(input_, 1);
  auto* sendBtn = new QPushButton("➤", inputRow);
  ilay->addWidget(sendBtn);
  lay->addWidget(inputRow);

  typingHideTimer_.setSingleShot(true);
  typingHideTimer_.setInterval(3000);
  connect(&typingHideTimer_, &QTimer::timeout, this, [this]() {
    typingLabel_->setVisible(false);
  });

  connect(sendBtn, &QPushButton::clicked, this, &ChatPanel::sendCurrent);
  connect(cancelBtn_, &QPushButton::clicked, this, &ChatPanel::cancelMode);
  connect(attachBtn_, &QPushButton::clicked, this, &ChatPanel::attachFile);
  connect(callBtn_, &QPushButton::clicked, this, [this]() { emit callRequested(currentId_); });
  connect(membersBtn_, &QPushButton::clicked, this, [this]() { emit membersRequested(currentId_); });
  connect(state_, &AppState::messagesChanged, this, &ChatPanel::onMessagesChanged);
  connect(state_, &AppState::messageAdded, this, &ChatPanel::onMessageAdded);
  connect(state_, &AppState::typingChanged, this, [this](qint64 channelId, const QString& nick) {
    if (channelId != currentId_ || nick == state_->user().nick) return;
    typingLabel_->setText(nick + " печатает…");
    typingLabel_->setVisible(true);
    typingHideTimer_.start();
  });
  // Тайпинг при вводе (не чаще, чем каждые 3 сек — сервер сам режет).
  connect(input_, &QTextEdit::textChanged, this, [this]() {
    if (currentId_) state_->sendTyping(currentId_);
  });
}

void ChatPanel::openChannel(qint64 channelId) {
  currentId_ = channelId;
  const Channel* ch = state_->findChannel(channelId);
  title_->setText(ch ? ch->name : QString());
  callBtn_->setVisible(ch != nullptr && ch->isMember);
  membersBtn_->setVisible(ch != nullptr && ch->isMember);
  cancelMode();
  lastDateLabel_.clear();
  rebuildMessages();
}

void ChatPanel::onMessagesChanged(qint64 channelId) {
  if (channelId == currentId_) rebuildMessages();
}

void ChatPanel::onMessageAdded(qint64 channelId, const Message&) {
  if (channelId == currentId_) rebuildMessages();
}

void ChatPanel::rebuildMessages() {
  // Если подгружаем старые — запоминаем смещение от низа, чтобы после
  // вставки старых сообщений сверху экран не прыгал.
  const QScrollBar* bar0 = scroll_->verticalScrollBar();
  const int max0 = bar0->maximum();
  savedValue_ = max0 > 0 ? max0 - bar0->value() : 0;
  const bool wasPreserve = preserveScroll_;
  preserveScroll_ = false;

  while (msgsLayout_->count() > 1) {
    QLayoutItem* item = msgsLayout_->takeAt(0);
    if (item->widget()) item->widget()->deleteLater();
    delete item;
  }
  lastDateLabel_.clear();
  for (const Message& m : state_->messages(currentId_)) {
    if (m.deleted) continue;
    // Разделитель дат.
    const QString dl = dateLabel(m.createdAt);
    if (!dl.isEmpty() && dl != lastDateLabel_) {
      auto* dateLbl = new QLabel(dl, container_);
      dateLbl->setObjectName("dateSeparator");
      dateLbl->setAlignment(Qt::AlignCenter);
      msgsLayout_->insertWidget(msgsLayout_->count() - 1, dateLbl);
      lastDateLabel_ = dl;
    }
    auto* w = new MessageWidget(m, m.senderId == state_->user().id, container_);
    connect(w, &MessageWidget::replyRequested, this, &ChatPanel::startReply);
    connect(w, &MessageWidget::editRequested, this, &ChatPanel::startEdit);
    connect(w, &MessageWidget::deleteRequested, this, [this](qint64 mid) {
      if (QMessageBox::question(this, "Удалить", "Удалить сообщение?") == QMessageBox::Yes) {
        state_->deleteMessage(currentId_, mid, [](const QString& err) {
          if (!err.isEmpty()) qWarning() << "delete error:" << err;
        });
      }
    });
    connect(w, &MessageWidget::downloadRequested, this, &ChatPanel::downloadAttachment);
    msgsLayout_->insertWidget(msgsLayout_->count() - 1, w);
  }
  if (wasPreserve) {
    // Восстанавливаем «тот же экран»: теперь значение от низа максимума.
    QTimer::singleShot(0, this, [this]() {
      QScrollBar* bar = scroll_->verticalScrollBar();
      bar->setValue(bar->maximum() > 0 ? bar->maximum() - savedValue_ : 0);
    });
  } else {
    scrollToBottom();
  }
}

void ChatPanel::maybeLoadOlder() {
  if (!currentId_ || loadingOlder_ || !state_->hasOlderMessages(currentId_)) return;
  QScrollBar* bar = scroll_->verticalScrollBar();
  if (bar->value() > 40) return;  // подгружаем, когда мы почти наверху
  loadingOlder_ = true;
  preserveScroll_ = true;
  state_->loadOlderMessages(currentId_, [this]() { loadingOlder_ = false; });
}

void ChatPanel::scrollToBottom() {
  QTimer::singleShot(0, this, [this]() {
    QScrollBar* bar = scroll_->verticalScrollBar();
    if (bar) bar->setValue(bar->maximum());
  });
}

void ChatPanel::sendCurrent() {
  const QString text = input_->toPlainText().trimmed();
  if (text.isEmpty() || !currentId_) return;
  if (editId_) {
    const qint64 mid = editId_;
    cancelMode();
    input_->clear();
    state_->editMessage(currentId_, mid, text, [this](const QString& err) {
      if (!err.isEmpty()) {
        qWarning() << "edit error:" << err;
        input_->setPlainText(text);
        QMessageBox::warning(this, "Не удалось отредактировать", err);
      }
    });
    return;
  }
  const qint64 replyTo = replyTo_;
  cancelMode();
  input_->clear();
  state_->sendMessage(currentId_, text, {}, replyTo, [this, text](const QString& err) {
    if (!err.isEmpty()) {
      qWarning() << "send error:" << err;
      // Возвращаем текст в поле ввода, чтобы не потерять его.
      input_->setPlainText(text);
      QMessageBox::warning(this, "Не удалось отправить", err);
    }
  });
}

void ChatPanel::startReply(qint64 messageId) {
  editId_ = 0;
  replyTo_ = messageId;
  modeLabel_->setText("Ответ на сообщение #" + QString::number(messageId));
  modeRow_->setVisible(true);
  input_->setFocus();
}

void ChatPanel::startEdit(qint64 messageId) {
  const QVector<Message>& msgs = state_->messages(currentId_);
  for (const Message& m : msgs) {
    if (m.id == messageId) {
      editText_ = m.text;
      break;
    }
  }
  editId_ = messageId;
  replyTo_ = 0;
  modeLabel_->setText("Редактирование");
  modeRow_->setVisible(true);
  input_->setPlainText(editText_);
  input_->setFocus();
}

void ChatPanel::cancelMode() {
  editId_ = 0;
  replyTo_ = 0;
  modeRow_->setVisible(false);
}

void ChatPanel::attachFile() {
  if (!currentId_) return;
  const QString path = QFileDialog::getOpenFileName(this, "Прикрепить файл");
  if (path.isEmpty()) return;
  state_->uploadFile(currentId_, path, [](const QString& err) {
    if (!err.isEmpty()) qWarning() << "upload error:" << err;
  });
}

void ChatPanel::downloadAttachment(qint64 fileId, const QString& filename) {
  const QString dir = QDir::homePath() + "/Downloads";
  const QString dest = dir + "/" + filename;
  state_->api()->downloadFile(fileId, true, dest, [](const QJsonObject&, const QString& err) {
    if (!err.isEmpty()) qWarning() << "download error:" << err;
  });
}

}  // namespace gl

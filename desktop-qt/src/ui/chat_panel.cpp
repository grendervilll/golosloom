#include "ui/chat_panel.h"

#include <QHBoxLayout>
#include <QLabel>
#include <QScrollBar>
#include <QPushButton>
#include <QVBoxLayout>

#include "core/app_state.h"
#include "ui/message_widget.h"

namespace gl {

ChatPanel::ChatPanel(AppState* state, QWidget* parent) : QWidget(parent), state_(state) {
  setObjectName("chatPanel");
  auto* lay = new QVBoxLayout(this);
  lay->setContentsMargins(0, 0, 0, 0);
  lay->setSpacing(0);

  auto* header = new QWidget(this);
  header->setObjectName("sidebar");
  auto* hlay = new QHBoxLayout(header);
  hlay->setContentsMargins(16, 12, 16, 12);
  title_ = new QLabel("", header);
  title_->setObjectName("chatTitle");
  hlay->addWidget(title_);
  hlay->addStretch();
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

  auto* inputRow = new QWidget(this);
  auto* ilay = new QHBoxLayout(inputRow);
  ilay->setContentsMargins(16, 10, 16, 12);
  input_ = new QTextEdit(inputRow);
  input_->setObjectName("inputField");
  input_->setPlaceholderText("Сообщение в чат...");
  input_->setFixedHeight(46);
  ilay->addWidget(input_, 1);
  auto* sendBtn = new QPushButton("➤", inputRow);
  ilay->addWidget(sendBtn);
  lay->addWidget(inputRow);

  connect(sendBtn, &QPushButton::clicked, this, &ChatPanel::sendCurrent);
  connect(state_, &AppState::messagesChanged, this, &ChatPanel::onMessagesChanged);
  connect(state_, &AppState::messageAdded, this, &ChatPanel::onMessageAdded);
}

void ChatPanel::openChannel(qint64 channelId) {
  currentId_ = channelId;
  const Channel* ch = state_->findChannel(channelId);
  title_->setText(ch ? ch->name : QString());
  rebuildMessages();
}

void ChatPanel::onMessagesChanged(qint64 channelId) {
  if (channelId == currentId_) rebuildMessages();
}

void ChatPanel::onMessageAdded(qint64 channelId, const Message&) {
  if (channelId == currentId_) rebuildMessages();
}

void ChatPanel::rebuildMessages() {
  while (msgsLayout_->count() > 1) {
    QLayoutItem* item = msgsLayout_->takeAt(0);
    if (item->widget()) item->widget()->deleteLater();
    delete item;
  }
  for (const Message& m : state_->messages(currentId_)) {
    if (m.deleted) continue;
    auto* w = new MessageWidget(m, m.senderId == state_->user().id, container_);
    msgsLayout_->insertWidget(msgsLayout_->count() - 1, w);
  }
  scrollToBottom();
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
  input_->clear();
  state_->sendMessage(currentId_, text, [](const QString& err) {
    if (!err.isEmpty()) qWarning() << "send error:" << err;
  });
}

}  // namespace gl

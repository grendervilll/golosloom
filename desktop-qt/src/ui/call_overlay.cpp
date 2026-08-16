#include "ui/call_overlay.h"

#include <QEvent>
#include <QHBoxLayout>
#include <QVBoxLayout>

#include "call/call_manager.h"

namespace gl {

namespace {
constexpr int kCardMargin = 16;
constexpr int kCardWidth = 300;
}  // namespace

CallOverlay::CallOverlay(CallManager* calls, QWidget* parent)
    : QWidget(parent), calls_(calls) {
  parent->installEventFilter(this);
  setAttribute(Qt::WA_TransparentForMouseEvents);
  setAttribute(Qt::WA_NoSystemBackground);
  setAttribute(Qt::WA_TranslucentBackground);

  container_ = new QWidget(this);
  // Контейнер бросает клики на лежащие под ним виджеты.
  container_->setAttribute(Qt::WA_TransparentForMouseEvents);
  auto* cl = new QVBoxLayout(container_);
  cl->setContentsMargins(0, 0, 0, 0);
  cl->setSpacing(8);
  cl->addStretch();
  resize(parent->size());
  reposition();

  // Входящий звонок.
  incomingCard_ = new QWidget(container_);
  incomingCard_->setObjectName("callCard");
  auto* ic = new QVBoxLayout(incomingCard_);
  ic->setContentsMargins(16, 14, 16, 14);
  ic->setSpacing(10);
  auto* title = new QLabel("Входящий звонок", incomingCard_);
  title->setObjectName("callTitle");
  title->setAlignment(Qt::AlignCenter);
  incomingNick_ = new QLabel("", incomingCard_);
  incomingNick_->setObjectName("callNick");
  incomingNick_->setAlignment(Qt::AlignCenter);
  ic->addWidget(title);
  ic->addWidget(incomingNick_);
  auto* row = new QHBoxLayout();
  acceptBtn_ = new QPushButton("Принять", incomingCard_);
  acceptBtn_->setObjectName("callAccept");
  declineBtn_ = new QPushButton("Отклонить", incomingCard_);
  declineBtn_->setObjectName("callDecline");
  row->addWidget(declineBtn_);
  row->addWidget(acceptBtn_);
  ic->addLayout(row);
  ic->addStretch();
  incomingCard_->setVisible(false);
  cl->insertWidget(0, incomingCard_);

  connect(acceptBtn_, &QPushButton::clicked, this, [this]() {
    if (incomingId_) {
      calls_->acceptCall(incomingId_);
      hideIncoming();
    }
  });
  connect(declineBtn_, &QPushButton::clicked, this, [this]() {
    if (incomingId_) calls_->declineCall(incomingId_);
    hideIncoming();
  });
}

bool CallOverlay::eventFilter(QObject* watched, QEvent* event) {
  if (watched == parent() && event->type() == QEvent::Resize) {
    resize(parentWidget()->size());
    reposition();
  }
  return QWidget::eventFilter(watched, event);
}

void CallOverlay::reposition() {
  container_->setGeometry(width() - (kCardWidth + kCardMargin * 2), kCardMargin,
                          kCardWidth + kCardMargin * 2, height() - kCardMargin * 2);
}

void CallOverlay::showIncoming(qint64 callId, const QString& nick) {
  incomingId_ = callId;
  incomingNick_->setText(nick + " звонит…");
  incomingCard_->setVisible(true);
  incomingCard_->raise();
}

void CallOverlay::hideIncoming() {
  incomingId_ = 0;
  incomingCard_->setVisible(false);
}

}  // namespace gl
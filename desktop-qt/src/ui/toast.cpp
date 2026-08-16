#include "ui/toast.h"

#include <QEvent>
#include <QGraphicsOpacityEffect>
#include <QHBoxLayout>
#include <QLabel>
#include <QPropertyAnimation>
#include <QTimer>
#include <QVBoxLayout>

namespace gl {

namespace {
constexpr int kToastWidth = 320;
constexpr int kToastMargin = 12;
constexpr int kToastSpacing = 8;
constexpr int kToastVisibleMs = 3000;
}  // namespace

ToastOverlay::ToastOverlay(QWidget* parent) : QWidget(parent) {
  setAttribute(Qt::WA_TransparentForMouseEvents);
  setAttribute(Qt::WA_NoSystemBackground);
  setAttribute(Qt::WA_TranslucentBackground);
  setObjectName("toastOverlay");
  // Прозрачный для кликов, но ловим resize родителя для переразметки.
  parent->installEventFilter(this);

  container_ = new QWidget(this);
  container_->setAttribute(Qt::WA_TransparentForMouseEvents);
  auto* lay = new QVBoxLayout(container_);
  lay->setContentsMargins(0, 0, 0, 0);
  lay->setSpacing(kToastSpacing);
  lay->addStretch();
  resize(parent->size());
  container_->resize(kToastWidth + kToastMargin * 2, parent->height());
  reposition();
  container_->show();
}

bool ToastOverlay::eventFilter(QObject* watched, QEvent* event) {
  if (watched == parent() && event->type() == QEvent::Resize) {
    resize(parentWidget()->size());
    reposition();
  }
  return QWidget::eventFilter(watched, event);
}

void ToastOverlay::reposition() {
  container_->setGeometry(width() - (kToastWidth + kToastMargin * 2), 0,
                          kToastWidth + kToastMargin * 2, height());
}

void ToastOverlay::showToast(const QString& title, const QString& body) {
  auto* card = new QWidget(container_);
  card->setObjectName("toast");
  card->setFixedWidth(kToastWidth);
  auto* lay = new QVBoxLayout(card);
  lay->setContentsMargins(12, 10, 12, 10);
  lay->setSpacing(2);

  auto* titleLbl = new QLabel(title, card);
  titleLbl->setObjectName("toastTitle");
  titleLbl->setWordWrap(true);
  lay->addWidget(titleLbl);

  auto* bodyLbl = new QLabel(body, card);
  bodyLbl->setObjectName("toastBody");
  bodyLbl->setWordWrap(true);
  bodyLbl->setTextFormat(Qt::PlainText);
  bodyLbl->setMaximumHeight(60);
  lay->addWidget(bodyLbl);

  // Вставляем сверху стека (новые уведомления поверх старых).
  auto* vlay = qobject_cast<QVBoxLayout*>(container_->layout());
  vlay->insertWidget(0, card);
  card->adjustSize();
  card->show();
  card->raise();

  // Плавное появление.
  auto* effect = new QGraphicsOpacityEffect(card);
  card->setGraphicsEffect(effect);
  auto* fadeIn = new QPropertyAnimation(effect, "opacity", card);
  fadeIn->setDuration(180);
  fadeIn->setStartValue(0.0);
  fadeIn->setEndValue(1.0);
  fadeIn->start(QAbstractAnimation::DeleteWhenStopped);

  // Через 3 секунды — плавное исчезание и удаление.
  auto* hideTimer = new QTimer(card);
  hideTimer->setSingleShot(true);
  connect(hideTimer, &QTimer::timeout, card, [card, effect]() {
    auto* fadeOut = new QPropertyAnimation(effect, "opacity", card);
    fadeOut->setDuration(250);
    fadeOut->setStartValue(1.0);
    fadeOut->setEndValue(0.0);
    connect(fadeOut, &QPropertyAnimation::finished, card, &QWidget::deleteLater);
    fadeOut->start(QAbstractAnimation::DeleteWhenStopped);
  });
  hideTimer->start(kToastVisibleMs);
}

}  // namespace gl

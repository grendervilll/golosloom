#include "ui/message_widget.h"

#include <QDateTime>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QLabel>
#include <QTextDocument>
#include <QVBoxLayout>

#include "markdown/markdown.h"
#include "models.h"

namespace gl {

MessageWidget::MessageWidget(const Message& msg, bool mine, QWidget* parent)
    : QWidget(parent), mine_(mine) {
  setObjectName("msgBubble");
  setProperty("mine", mine);
  auto* outer = new QHBoxLayout(this);
  outer->setContentsMargins(10, 6, 10, 6);
  outer->setSpacing(8);
  if (mine) outer->addStretch();

  content_ = new QVBoxLayout();
  content_->setSpacing(2);
  meta_ = new QLabel(this);
  meta_->setObjectName("msgNick");
  content_->addWidget(meta_);

  text_ = new QLabel(this);
  text_->setTextFormat(Qt::RichText);
  text_->setTextInteractionFlags(Qt::TextSelectableByMouse | Qt::LinksAccessibleByMouse);
  text_->setOpenExternalLinks(true);
  text_->setWordWrap(true);
  content_->addWidget(text_);

  encrypted_ = new QLabel("🔒 Сообщение зашифровано (ключ канала недоступен)", this);
  encrypted_->setObjectName("encLabel");
  encrypted_->setVisible(false);
  content_->addWidget(encrypted_);

  outer->addLayout(content_);
  if (!mine) outer->addStretch();
  rebuild(msg);
}

void MessageWidget::updateMessage(const Message& msg) {
  rebuild(msg);
}

QSize MessageWidget::sizeHint() const {
  return QSize(420, 60);
}

void MessageWidget::rebuild(const Message& msg) {
  const QDateTime dt = QDateTime::fromString(msg.createdAt, Qt::ISODate);
  const QString time = dt.isValid() ? dt.toLocalTime().toString("HH:mm") : "";
  const QString mark = msg.edited ? " (изменено)" : "";
  meta_->setText((mine_ ? "" : msg.senderNick + " · ") + time + mark);
  if (msg.encrypted) {
    encrypted_->setVisible(true);
    text_->setText("");
  } else if (!msg.text.isEmpty()) {
    encrypted_->setVisible(false);
    text_->setText(markdownToHtml(msg.text));
  } else {
    encrypted_->setVisible(false);
    text_->setText("<i>Пустое сообщение</i>");
  }
}

}  // namespace gl

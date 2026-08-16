#include "ui/message_widget.h"

#include <QContextMenuEvent>
#include <QDateTime>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QLabel>
#include <QMenu>
#include <QPushButton>
#include <QStyle>
#include <QTextDocument>
#include <QVBoxLayout>

#include "markdown/markdown.h"
#include "models.h"

namespace gl {

namespace {
QString humanSize(qint64 bytes) {
  if (bytes >= 1024 * 1024) return QString::number(bytes / 1024.0 / 1024.0, 'f', 1) + " МБ";
  if (bytes >= 1024) return QString::number(bytes / 1024.0, 'f', 0) + " КБ";
  return QString::number(bytes) + " Б";
}
}  // namespace

MessageWidget::MessageWidget(const Message& msg, bool mine, const QString& replyNick,
                             const QString& replyText, QWidget* parent)
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

  // Цитата ответа (как reply-quote в вебе).
  replyQuote_ = new QLabel(this);
  replyQuote_->setObjectName("replyQuote");
  replyQuote_->setWordWrap(true);
  replyQuote_->setTextFormat(Qt::RichText);
  replyQuote_->setVisible(false);
  content_->addWidget(replyQuote_);
  if (!replyNick.isEmpty() || !replyText.isEmpty()) {
    QString q = replyNick.isEmpty() ? QString() : replyNick + ": ";
    QString t = replyText;
    if (t.size() > 80) t = t.left(80) + "…";
    replyQuote_->setText(QString("<b>%1</b>%2").arg(q.toHtmlEscaped(), t.toHtmlEscaped()));
    replyQuote_->setVisible(true);
  }

  text_ = new QLabel(this);
  text_->setTextFormat(Qt::RichText);
  text_->setTextInteractionFlags(Qt::TextSelectableByMouse | Qt::LinksAccessibleByMouse);
  text_->setOpenExternalLinks(true);
  text_->setWordWrap(true);
  content_->addWidget(text_);

  attsRow_ = new QWidget(this);
  attsRow_->setObjectName("msgAtts");
  auto* attsLay = new QVBoxLayout(attsRow_);
  attsLay->setContentsMargins(0, 2, 0, 0);
  attsLay->setSpacing(4);
  content_->addWidget(attsRow_);

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

void MessageWidget::setPending(bool on) {
  setProperty("pending", on);
  style()->unpolish(this);
  style()->polish(this);
}

void MessageWidget::rebuild(const Message& msg) {
  id_ = msg.id;
  const QDateTime dt = QDateTime::fromString(msg.createdAt, Qt::ISODate);
  const QString time = dt.isValid() ? dt.toLocalTime().toString("HH:mm") : "";
  const QString mark = msg.edited ? " (изменено)" : "";
  meta_->setText((mine_ ? "" : msg.senderNick + " · ") + time + mark);
  setPending(msg.pending);
  if (msg.encrypted) {
    encrypted_->setVisible(true);
    text_->setText("");
  } else if (!msg.text.isEmpty()) {
    encrypted_->setVisible(false);
    text_->setText(markdownToHtml(msg.text));
  } else if (!msg.attachments.isEmpty()) {
    encrypted_->setVisible(false);
    text_->setText("");
  } else {
    encrypted_->setVisible(false);
    text_->setText("<i>Пустое сообщение</i>");
  }

  // Вложения: ссылка-кнопка «имя (размер)» с сигналом скачивания.
  while (auto* item = attsRow_->layout()->takeAt(0)) {
    if (item->widget()) item->widget()->deleteLater();
    delete item;
  }
  for (const Message::Attachment& a : msg.attachments) {
    auto* btn = new QPushButton("📎 " + a.filename + " (" + humanSize(a.size) + ")", attsRow_);
    btn->setObjectName("rowBtn");
    btn->setStyleSheet("text-align:left;");
    attsRow_->layout()->addWidget(btn);
    const qint64 fid = a.id;
    const QString fname = a.filename;
    connect(btn, &QPushButton::clicked, this, [this, fid, fname]() { emit downloadRequested(fid, fname); });
  }
  attsRow_->setVisible(!msg.attachments.isEmpty());
}

void MessageWidget::contextMenuEvent(QContextMenuEvent* event) {
  QMenu menu(this);
  if (mine_) {
    auto* reply = menu.addAction("Ответить");
    auto* edit = menu.addAction("Редактировать");
    auto* del = menu.addAction("Удалить");
    auto* chosen = menu.exec(event->globalPos());
    if (chosen == reply) emit replyRequested(id_);
    else if (chosen == edit) emit editRequested(id_);
    else if (chosen == del) emit deleteRequested(id_);
  } else {
    auto* reply = menu.addAction("Ответить");
    if (menu.exec(event->globalPos()) == reply) emit replyRequested(id_);
  }
}

}  // namespace gl

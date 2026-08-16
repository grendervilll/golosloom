#pragma once
#include <QLabel>
#include <QVBoxLayout>
#include <QWidget>

namespace gl {

struct Message;

// Пузырь сообщения (как .msg в вебе): никель, время, markdown-текст,
// метка «зашифровано», вложения, цитата ответа, контекстное меню.
class MessageWidget : public QWidget {
  Q_OBJECT
 public:
  // replyNick/replyText — цитата отвечаемого сообщения (если есть).
  explicit MessageWidget(const Message& msg, bool mine, const QString& replyNick,
                         const QString& replyText, QWidget* parent = nullptr);
  void updateMessage(const Message& msg);
  QSize sizeHint() const override;

 signals:
  void replyRequested(qint64 messageId);
  void editRequested(qint64 messageId);
  void deleteRequested(qint64 messageId);
  void downloadRequested(qint64 fileId, const QString& filename);

 protected:
  void contextMenuEvent(QContextMenuEvent* event) override;

 private:
  void rebuild(const Message& msg);
  void setPending(bool on);

  qint64 id_ = 0;
  bool mine_;
  QVBoxLayout* content_;
  QLabel* text_;
  QLabel* meta_;
  QLabel* encrypted_;
  QWidget* attsRow_ = nullptr;
  QLabel* replyQuote_ = nullptr;
};

}  // namespace gl

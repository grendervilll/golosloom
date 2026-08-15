#pragma once
#include <QLabel>
#include <QVBoxLayout>
#include <QWidget>

namespace gl {

struct Message;

// Пузырь сообщения (как .msg в вебе): никель, время, markdown-текст,
// метка «зашифровано», вложения.
class MessageWidget : public QWidget {
  Q_OBJECT
 public:
  explicit MessageWidget(const Message& msg, bool mine, QWidget* parent = nullptr);
  void updateMessage(const Message& msg);
  QSize sizeHint() const override;

 private:
  void rebuild(const Message& msg);
  bool mine_;
  QVBoxLayout* content_;
  QLabel* text_;
  QLabel* meta_;
  QLabel* encrypted_;
};

}  // namespace gl

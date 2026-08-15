#pragma once
#include <QLabel>
#include <QScrollArea>
#include <QTextEdit>
#include <QVBoxLayout>
#include <QWidget>

namespace gl {

class AppState;
struct Message;

// Панель чата: заголовок, лента сообщений, поле ввода.
class ChatPanel : public QWidget {
  Q_OBJECT
 public:
  explicit ChatPanel(AppState* state, QWidget* parent = nullptr);

  void openChannel(qint64 channelId);

 private slots:
  void onMessagesChanged(qint64 channelId);
  void onMessageAdded(qint64 channelId, const Message& msg);
  void sendCurrent();

 private:
  void rebuildMessages();
  void scrollToBottom();

  AppState* state_;
  qint64 currentId_ = 0;
  QLabel* title_;
  QScrollArea* scroll_;
  QWidget* container_;
  QVBoxLayout* msgsLayout_;
  QTextEdit* input_;
};

}  // namespace gl

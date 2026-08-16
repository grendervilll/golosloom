#pragma once
#include <QLabel>
#include <QPushButton>
#include <QScrollArea>
#include <QTextEdit>
#include <QTimer>
#include <QVBoxLayout>
#include <QWidget>

namespace gl {

class AppState;
struct Message;

// Панель чата: шапка (название + звонок), лента сообщений с разделителями
// дат, кнопка «вниз» (спуск к последним), поле ввода с ответом/редактированием
// и кнопкой прикрепления.
class ChatPanel : public QWidget {
  Q_OBJECT
 public:
  explicit ChatPanel(AppState* state, QWidget* parent = nullptr);

  void openChannel(qint64 channelId);
  qint64 currentChannelId() const { return currentId_; }

  QPushButton* callBtn() { return callBtn_; }
  QPushButton* membersBtn() { return membersBtn_; }

 signals:
  void callRequested(qint64 channelId);
  void membersRequested(qint64 channelId);

 private:
  void onMessagesChanged(qint64 channelId);
  void onMessageAdded(qint64 channelId, const Message& msg);
  void rebuildMessages();
  void scrollToBottom();
  void updateDownBtn();
  void maybeLoadOlder();
  void sendCurrent();
  void startReply(qint64 messageId);
  void startEdit(qint64 messageId);
  void cancelMode();
  void attachFile();
  void downloadAttachment(qint64 fileId, const QString& filename);
  QWidget* modeRow() { return modeRow_; }

 protected:
  void resizeEvent(QResizeEvent* event) override;

  AppState* state_;
  qint64 currentId_ = 0;
  QLabel* title_;
  QScrollArea* scroll_;
  QWidget* container_;
  QVBoxLayout* msgsLayout_;
  QTextEdit* input_;
  QLabel* modeLabel_;
  QWidget* modeRow_ = nullptr;
  QPushButton* cancelBtn_;
  QPushButton* callBtn_ = nullptr;
  QPushButton* membersBtn_ = nullptr;
  QPushButton* attachBtn_ = nullptr;
  QPushButton* downBtn_ = nullptr;  // стрелка «вниз»
  QLabel* typingLabel_ = nullptr;
  QTimer typingHideTimer_;
  QString typingNick_;
  qint64 replyTo_ = 0;
  qint64 editId_ = 0;
  QString editText_;
  // Дата последнего отрисованного разделителя.
  QString lastDateLabel_;
  // Скролл при подгрузке истории: сохранили позицию — восстановили.
  bool preserveScroll_ = false;
  int savedValue_ = 0;
  bool loadingOlder_ = false;
};

}  // namespace gl

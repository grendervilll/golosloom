#pragma once
#include <QLabel>
#include <QListWidget>
#include <QVBoxLayout>
#include <QWidget>

namespace gl {

class AppState;

// Список чатов (каналы/DM/сообщества) в левой панели.
class ChannelList : public QWidget {
  Q_OBJECT
 public:
  explicit ChannelList(AppState* state, QWidget* parent = nullptr);

  void refresh();

 signals:
  void channelActivated(qint64 id);

 private:
  AppState* state_;
  QListWidget* list_;
};

}  // namespace gl

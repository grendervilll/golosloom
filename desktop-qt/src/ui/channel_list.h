#pragma once
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QWidget>

namespace gl {

class AppState;

// Список чатов в левой панели + кнопки «Создать канал», «Приглашения», «Выйти».
class ChannelList : public QWidget {
  Q_OBJECT
 public:
  explicit ChannelList(AppState* state, QWidget* parent = nullptr);

  void refresh();
  QPushButton* invitesBtn() { return invitesBtn_; }
  QPushButton* createBtn() { return createBtn_; }
  QPushButton* logoutBtn() { return logoutBtn_; }

 signals:
  void channelActivated(qint64 id);
  void createChannelRequested();
  void invitesRequested();
  void logoutRequested();

 private:
  void refreshBadge();

  AppState* state_;
  QListWidget* list_;
  QPushButton* createBtn_ = nullptr;
  QPushButton* invitesBtn_ = nullptr;
  QPushButton* logoutBtn_ = nullptr;
  QLabel* invitesBadge_ = nullptr;
};

}  // namespace gl

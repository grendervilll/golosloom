#pragma once
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QWidget>

namespace gl {

class AppState;

// Список чатов в левой панели (как в вебе): аватар с инициалами,
// название, время и превью последнего сообщения, бейдж непрочитанных.
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
  void themeToggleRequested();
  void deleteChannelRequested(qint64 id);

 protected:
  void contextMenuEvent(QContextMenuEvent* event) override;

 private:
  void refreshBadge();
  void applyFilter();

  AppState* state_;
  QListWidget* list_;
  QLineEdit* filterEdit_ = nullptr;
  QPushButton* createBtn_ = nullptr;
  QPushButton* invitesBtn_ = nullptr;
  QPushButton* logoutBtn_ = nullptr;
  QPushButton* themeBtn_ = nullptr;
  QLabel* invitesBadge_ = nullptr;
};

}  // namespace gl

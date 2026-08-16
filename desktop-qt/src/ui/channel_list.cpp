#include "ui/channel_list.h"

#include <QHBoxLayout>
#include <QListWidgetItem>
#include <QVBoxLayout>

#include "core/app_state.h"

namespace gl {

ChannelList::ChannelList(AppState* state, QWidget* parent) : QWidget(parent), state_(state) {
  setObjectName("sidebar");
  auto* lay = new QVBoxLayout(this);
  lay->setContentsMargins(8, 10, 8, 10);
  lay->setSpacing(8);

  auto* title = new QLabel("Golosloom", this);
  title->setObjectName("chatTitle");
  lay->addWidget(title);

  // Кнопка «Создать канал».
  createBtn_ = new QPushButton("＋ Канал", this);
  createBtn_->setObjectName("rowBtn");
  lay->addWidget(createBtn_);

  // Кнопка «Приглашения» со счётчиком.
  auto* invitesRow = new QWidget(this);
  auto* irow = new QHBoxLayout(invitesRow);
  irow->setContentsMargins(0, 0, 0, 0);
  irow->setSpacing(6);
  invitesBtn_ = new QPushButton("📨 Приглашения", invitesRow);
  invitesBtn_->setObjectName("rowBtn");
  invitesBtn_->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
  invitesBadge_ = new QLabel("", invitesRow);
  invitesBadge_->setObjectName("invitesBadge");
  invitesBadge_->setVisible(false);
  irow->addWidget(invitesBtn_);
  irow->addWidget(invitesBadge_);
  lay->addWidget(invitesRow);

  list_ = new QListWidget(this);
  list_->setObjectName("channelList");
  list_->setFrameShape(QFrame::NoFrame);
  list_->setSelectionMode(QAbstractItemView::SingleSelection);
  list_->setUniformItemSizes(true);
  lay->addWidget(list_, 1);

  logoutBtn_ = new QPushButton("Выйти", this);
  logoutBtn_->setObjectName("rowBtn");
  lay->addWidget(logoutBtn_);

  connect(list_, &QListWidget::itemClicked, this, [this](QListWidgetItem* item) {
    const qint64 id = item->data(Qt::UserRole).toLongLong();
    emit channelActivated(id);
  });
  connect(createBtn_, &QPushButton::clicked, this, &ChannelList::createChannelRequested);
  connect(invitesBtn_, &QPushButton::clicked, this, &ChannelList::invitesRequested);
  connect(logoutBtn_, &QPushButton::clicked, this, &ChannelList::logoutRequested);
  connect(state_, &AppState::invitesChanged, this, &ChannelList::refreshBadge);
}

void ChannelList::refresh() {
  list_->clear();
  for (const Channel& c : state_->channels()) {
    const QString label = (c.isPrivate ? "🔒 " : "\xF0\x9F\x93\xA2 ") + c.name;
    auto* item = new QListWidgetItem(label, list_);
    item->setData(Qt::UserRole, c.id);
    item->setToolTip(c.isPrivate ? "Приватный канал" : c.name);
    const int unread = state_->unreadCount(c.id);
    if (unread > 0) {
      item->setData(Qt::DisplayRole, QVariant(label + "   (" + QString::number(unread) + ")"));
    }
  }
  refreshBadge();
}

void ChannelList::refreshBadge() {
  const int n = state_->pendingInvites();
  invitesBadge_->setText(n > 0 ? QString::number(n) : QString());
  invitesBadge_->setVisible(n > 0);
}

}  // namespace gl

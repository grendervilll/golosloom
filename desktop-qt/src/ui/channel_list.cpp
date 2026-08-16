#include "ui/channel_list.h"

#include <QDateTime>
#include <QHBoxLayout>
#include <QListWidgetItem>
#include <QVBoxLayout>

#include "core/app_state.h"

namespace gl {

namespace {

// Цвет аватара по хэшу названия (как в вебе avatarColor).
QString avatarColor(const QString& nick) {
  static const char* kColors[] = {
      "#f26b6b", "#ffa04b", "#f6c95c", "#8ec97b", "#5ab8a0", "#5aa9e6",
      "#8a7de0", "#e08ad0", "#ff8db8",
  };
  quint32 h = qHash(nick);
  return QString::fromLatin1(kColors[h % (sizeof(kColors) / sizeof(kColors[0]))]);
}

// Инициалы: первая буква + (для каналов) «#».
QString initials(const QString& name) {
  if (name.isEmpty()) return "#";
  return name.left(1).toUpper();
}

// Время последнего сообщения: сегодня — ЧЧ:ММ, иначе дата (как в вебе).
QString lastTime(const QDateTime& dt) {
  if (!dt.isValid()) return QString();
  const QDateTime local = dt.toLocalTime();
  if (local.date() == QDate::currentDate()) return local.toString("HH:mm");
  return local.date().toString("dd.MM");
}

QString previewText(const Message* m, qint64 myId) {
  if (!m) return QString();
  if (m->encrypted) return "🔒 Сообщение";
  if (m->deleted) return "🗑 Сообщение удалено";
  if (m->text.isEmpty() && !m->attachments.isEmpty()) return "📎 Файл";
  const QString prefix = m->senderId == myId ? "Вы: " : QString();
  return prefix + m->text;
}

}  // namespace

ChannelList::ChannelList(AppState* state, QWidget* parent) : QWidget(parent), state_(state) {
  setObjectName("sidebar");
  auto* lay = new QVBoxLayout(this);
  lay->setContentsMargins(8, 10, 8, 10);
  lay->setSpacing(8);

  auto* title = new QLabel("Golosloom", this);
  title->setObjectName("chatTitle");
  lay->addWidget(title);

  // Поиск по каналам (локальный фильтр, как в вебе).
  filterEdit_ = new QLineEdit(this);
  filterEdit_->setObjectName("searchField");
  filterEdit_->setPlaceholderText("Поиск");
  filterEdit_->setClearButtonEnabled(true);
  lay->addWidget(filterEdit_);
  connect(filterEdit_, &QLineEdit::textChanged, this, &ChannelList::applyFilter);

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
  list_->setUniformItemSizes(false);
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
  const qint64 myId = state_->user().id;
  const qint64 currentId = state_->currentChannelId();
  for (const Channel& c : state_->channels()) {
    // Строка канала в стиле веба: аватар + имя/время + превью/бейдж.
    auto* row = new QWidget(list_);
    row->setObjectName("chatRow");
    if (c.id == currentId) row->setProperty("active", true);
    auto* rl = new QHBoxLayout(row);
    rl->setContentsMargins(8, 8, 8, 8);
    rl->setSpacing(10);

    // Аватар: круг с инициалами.
    auto* avatar = new QLabel(initials(c.name), row);
    avatar->setObjectName("channelAvatar");
    avatar->setFixedSize(44, 44);
    avatar->setAlignment(Qt::AlignCenter);
    avatar->setStyleSheet(
        QString("background: %1; color: white; border-radius: 22px; font-weight: 700; font-size: 16px;")
            .arg(avatarColor(c.name)));
    rl->addWidget(avatar);

    // Правая колонка: верх (имя + время), низ (превью + бейдж).
    auto* details = new QWidget(row);
    auto* dl = new QVBoxLayout(details);
    dl->setContentsMargins(0, 0, 0, 0);
    dl->setSpacing(2);

    auto* top = new QWidget(details);
    auto* tl = new QHBoxLayout(top);
    tl->setContentsMargins(0, 0, 0, 0);
    tl->setSpacing(6);
    auto* nameLbl = new QLabel((c.isPrivate ? "🔒 " : "") + c.name, top);
    nameLbl->setObjectName("chatName");
    nameLbl->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    const Message* last = state_->lastMessage(c.id);
    auto* timeLbl = new QLabel(lastTime(last ? QDateTime::fromString(last->createdAt, Qt::ISODate)
                                             : QDateTime()),
                               top);
    timeLbl->setObjectName("chatTime");
    tl->addWidget(nameLbl, 1);
    tl->addWidget(timeLbl);
    dl->addWidget(top);

    auto* bottom = new QWidget(details);
    auto* bl = new QHBoxLayout(bottom);
    bl->setContentsMargins(0, 0, 0, 0);
    bl->setSpacing(6);
    auto* prevLbl = new QLabel(previewText(last, myId), bottom);
    prevLbl->setObjectName("chatPreview");
    if (!previewText(last, myId).isEmpty()) prevLbl->setProperty("empty", false);
    prevLbl->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    bl->addWidget(prevLbl, 1);
    const int unread = state_->unreadCount(c.id);
    if (unread > 0) {
      auto* badge = new QLabel(QString::number(unread), bottom);
      badge->setObjectName("unreadBadge");
      bl->addWidget(badge);
    }
    dl->addWidget(bottom);

    rl->addWidget(details, 1);

    auto* item = new QListWidgetItem(list_);
    item->setData(Qt::UserRole, c.id);
    item->setSizeHint(row->sizeHint());
    list_->addItem(item);
    list_->setItemWidget(item, row);
  }
  refreshBadge();
}

void ChannelList::refreshBadge() {
  const int n = state_->pendingInvites();
  invitesBadge_->setText(n > 0 ? QString::number(n) : QString());
  invitesBadge_->setVisible(n > 0);
}

void ChannelList::applyFilter() {
  const QString q = filterEdit_->text().trimmed().toLower();
  for (int i = 0; i < list_->count(); i++) {
    QListWidgetItem* item = list_->item(i);
    const qint64 id = item->data(Qt::UserRole).toLongLong();
    const Channel* ch = state_->findChannel(id);
    const bool match = q.isEmpty() || (ch && ch->name.toLower().contains(q));
    item->setHidden(!match);
  }
}

}  // namespace gl

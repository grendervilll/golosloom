#include "ui/main_window.h"

#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QListWidget>
#include <QMessageBox>
#include <QPushButton>
#include <QVBoxLayout>

#include "call/call_manager.h"
#include "core/app_state.h"
#include "ui/call_overlay.h"
#include "ui/channel_list.h"
#include "ui/chat_panel.h"
#include "ui/login_dialog.h"
#include "ui/theme.h"
#include "ui/toast.h"

namespace gl {

namespace {

// Диалог «Создать канал».
class CreateChannelDialog : public QDialog {
 public:
  explicit CreateChannelDialog(AppState* state, QWidget* parent = nullptr) : QDialog(parent) {
    setWindowTitle("Новый канал");
    setFixedWidth(360);
    auto* lay = new QVBoxLayout(this);
    lay->setContentsMargins(20, 18, 20, 18);
    lay->setSpacing(10);

    nameEdit_ = new QLineEdit(this);
    nameEdit_->setPlaceholderText("Название канала");
    lay->addWidget(nameEdit_);

    privateCheck_ = new QCheckBox("Приватный канал (вход только по приглашению)", this);
    lay->addWidget(privateCheck_);

    auto* row = new QHBoxLayout();
    auto* cancel = new QPushButton("Отмена", this);
    cancel->setObjectName("ghost");
    auto* okBtn = new QPushButton("Создать", this);
    row->addWidget(cancel);
    row->addWidget(okBtn);
    lay->addLayout(row);

    connect(cancel, &QPushButton::clicked, this, &QDialog::reject);
    connect(okBtn, &QPushButton::clicked, this, [this, state]() {
      const QString name = nameEdit_->text().trimmed();
      if (name.isEmpty()) {
        nameEdit_->setFocus();
        return;
      }
      setEnabled(false);
      state->createChannel(name, privateCheck_->isChecked(), [this](const QString& err) {
        if (!err.isEmpty()) {
          QMessageBox::warning(this, "Не удалось создать канал", err);
          setEnabled(true);
          return;
        }
        accept();
      });
    });
  }

 private:
  QLineEdit* nameEdit_;
  QCheckBox* privateCheck_;
};

// Диалог приглашений: входящие приглашения и создание новых.
class InvitesDialog : public QDialog {
 public:
  explicit InvitesDialog(AppState* state, QWidget* parent = nullptr) : QDialog(parent) {
    setWindowTitle("Приглашения");
    resize(460, 420);
    auto* lay = new QVBoxLayout(this);
    lay->setContentsMargins(16, 14, 16, 14);
    lay->setSpacing(10);

    auto* hint = new QLabel("Входящие приглашения в каналы:", this);
    hint->setObjectName("hintLabel");
    lay->addWidget(hint);

    incoming_ = new QListWidget(this);
    lay->addWidget(incoming_, 1);

    auto* hint2 = new QLabel("Пригласить пользователя в канал:", this);
    hint2->setObjectName("hintLabel");
    lay->addWidget(hint2);

    auto* row = new QHBoxLayout();
    userList_ = new QComboBox(this);
    channelList_ = new QComboBox(this);
    auto* inviteBtn = new QPushButton("Пригласить", this);
    row->addWidget(userList_, 2);
    row->addWidget(channelList_, 2);
    row->addWidget(inviteBtn);
    lay->addLayout(row);

    // Заполняем список каналов (в которых мы участники).
    for (const Channel& c : state->channels()) {
      if (c.isMember) channelList_->addItem(c.name, c.id);
    }
    // Список пользователей сервера.
    state->loadUsers([this](const QVector<User>& users) {
      users_ = users;
      for (const User& u : users) {
        userList_->addItem(u.nick, u.id);
      }
    });

    connect(inviteBtn, &QPushButton::clicked, this, [this, state, inviteBtn]() {
      const qint64 userId = userList_->currentData().toLongLong();
      const qint64 channelId = channelList_->currentData().toLongLong();
      if (!userId || !channelId) return;
      inviteBtn->setEnabled(false);
      state->createInvite(channelId, userId, [this, inviteBtn](const QString& err) {
        inviteBtn->setEnabled(true);
        if (!err.isEmpty()) QMessageBox::warning(this, "Не удалось пригласить", err);
      });
    });

    reload(state);
  }

  void reload(AppState* state) {
    incoming_->clear();
    state->loadInvites([this, state](const QVector<Invite>& invites) {
      for (const Invite& i : invites) {
        auto* item = new QListWidgetItem(QString("Канал «%1» — пригласил %2")
                                             .arg(i.channelName, i.invitedByNick),
                                         incoming_);
        auto* w = new QWidget(incoming_);
        auto* wl = new QHBoxLayout(w);
        wl->setContentsMargins(0, 0, 0, 0);
        auto* accept = new QPushButton("Принять", w);
        auto* decline = new QPushButton("Отклонить", w);
        decline->setObjectName("ghost");
        wl->addWidget(accept);
        wl->addWidget(decline);
        w->setLayout(wl);
        incoming_->setItemWidget(item, w);
        const qint64 invId = i.id;
        connect(accept, &QPushButton::clicked, this, [this, state, invId]() {
          state->respondInvite(invId, true, [](const QString&) {});
          reload(state);
        });
        connect(decline, &QPushButton::clicked, this, [this, state, invId]() {
          state->respondInvite(invId, false, [](const QString&) {});
          reload(state);
        });
      }
    });
  }

 private:
  QListWidget* incoming_;
  QComboBox* userList_;
  QComboBox* channelList_;
  QVector<User> users_;
};

// Диалог участников канала.
class MembersDialog : public QDialog {
 public:
  MembersDialog(AppState* state, qint64 channelId, QWidget* parent = nullptr) : QDialog(parent) {
    setWindowTitle("Участники канала");
    resize(340, 420);
    auto* lay = new QVBoxLayout(this);
    lay->setContentsMargins(16, 14, 16, 14);
    lay->setSpacing(8);
    list_ = new QListWidget(this);
    lay->addWidget(list_);
    state->loadMembers(channelId, [this](const QVector<ChannelMember>& members) {
      for (const ChannelMember& m : members) {
        QString role;
        if (m.isServerAdmin) role = " · админ сервера";
        else if (m.role == "channel_admin") role = " · админ канала";
        else if (m.role == "moderator") role = " · модератор";
        list_->addItem((m.online ? "🟢 " : "⚪ ") + m.nick + role);
      }
    });
  }

 private:
  QListWidget* list_;
};

}  // namespace

MainWindow::MainWindow(AppState* state, QWidget* parent) : QMainWindow(parent), state_(state) {
  setWindowTitle("Golosloom");
  resize(1100, 760);
  setMinimumSize(800, 560);

  splitter_ = new QSplitter(this);
  channelList_ = new ChannelList(state_, splitter_);
  chatPanel_ = new ChatPanel(state_, splitter_);
  splitter_->addWidget(channelList_);
  splitter_->addWidget(chatPanel_);
  splitter_->setStretchFactor(0, 0);
  splitter_->setStretchFactor(1, 1);
  splitter_->setSizes({280, 820});
  setCentralWidget(splitter_);

  toasts_ = new ToastOverlay(this);
  toasts_->raise();

  // Звонки: обработка событий WS (call.invite/started/ended) и UI-слой.
  calls_ = new CallManager(state_, this);
  connect(state_->ws(), &WsClient::eventReceived, calls_, &CallManager::handleWsEvent);
  connect(state_->ws(), &WsClient::eventReceived, this, &MainWindow::onWsEvent);
  initCallControls();

  connect(state_, &AppState::channelsChanged, this, [this]() { channelList_->refresh(); });
  connect(state_, &AppState::loginChanged, this, [this]() {
    if (state_->loggedIn()) channelList_->refresh();
  });
  connect(channelList_, &ChannelList::channelActivated, this,
          [this](qint64 id) { chatPanel_->openChannel(id); state_->openChannel(id); });
  connect(channelList_, &ChannelList::createChannelRequested, this, [this]() {
    CreateChannelDialog dlg(state_, this);
    if (dlg.exec() == QDialog::Accepted) channelList_->refresh();
  });
  connect(channelList_, &ChannelList::invitesRequested, this, [this]() {
    InvitesDialog dlg(state_, this);
    dlg.exec();
  });
  connect(channelList_, &ChannelList::themeToggleRequested, this, [this]() {
    const bool dark = !gl::savedThemeDark();
    gl::saveThemeDark(dark);
    qApp->setStyleSheet(gl::themeQss(dark));
    channelList_->refresh();
  });
  connect(channelList_, &ChannelList::logoutRequested, this, [this]() {
    if (QMessageBox::question(this, "Выйти", "Выйти из аккаунта?") == QMessageBox::Yes) {
      state_->logout();
      showLogin();
    }
  });
  connect(chatPanel_, &ChatPanel::membersRequested, this, [this](qint64 channelId) {
    MembersDialog dlg(state_, channelId, this);
    dlg.exec();
  });
  connect(chatPanel_, &ChatPanel::callRequested, this, [this](qint64 channelId) {
    // Выбор цели звонка из участников канала (кроме себя).
    state_->loadMembers(channelId, [this, channelId](const QVector<ChannelMember>& members) {
      QVector<qint64> targets;
      QStringList labels;
      for (const ChannelMember& m : members) {
        if (m.userId == state_->user().id) continue;
        targets.append(m.userId);
        labels << m.nick;
      }
      if (targets.isEmpty()) {
        QMessageBox::information(this, "Звонок", "В канале нет других участников.");
        return;
      }
      bool ok = false;
      if (targets.size() == 1) {
        ok = true;  // звоним единственному участнику
      } else {
        const QString chosen = QInputDialog::getItem(this, "Звонок", "Кому позвонить?", labels, 0, false, &ok);
        if (!ok) return;
        const int idx = labels.indexOf(chosen);
        if (idx < 0) return;
        targets = {targets[idx]};
      }
      if (ok) calls_->startCall(channelId, targets);
    });
  });

  login_ = nullptr;
  if (!state_->loggedIn()) {
    // Авто-вход по сохранённому токену; иначе — окно логина.
    QTimer::singleShot(0, this, [this]() {
      state_->restoreSession([this](bool ok, const QString&) {
        if (ok) {
          channelList_->refresh();
          const QVector<Channel>& chs = state_->channels();
          if (!chs.isEmpty()) {
            chatPanel_->openChannel(chs.first().id);
            state_->openChannel(chs.first().id);
          }
        } else {
          showLogin();
        }
      });
    });
  }
}

void MainWindow::showLogin() {
  if (!login_) {
    login_ = new LoginDialog(state_, this);
    connect(login_, &QDialog::accepted, this, [this]() {
      channelList_->refresh();
      const QVector<Channel>& chs = state_->channels();
      if (!chs.isEmpty()) {
        chatPanel_->openChannel(chs.first().id);
        state_->openChannel(chs.first().id);
      }
    });
  }
  login_->show();
  login_->raise();
  login_->activateWindow();
}

void MainWindow::initCallControls() {
  callOverlay_ = new CallOverlay(calls_, this);
  callOverlay_->raise();
  // Входящий звонок — карточка принять/отклонить поверх окна.
  connect(calls_, &CallManager::incomingCall, this, [this](qint64 callId, qint64, const QString& nick) {
    callOverlay_->showIncoming(callId, nick);
    toasts_->showToast(nick, "начал(а) звонок");
  });
  connect(calls_, &CallManager::callEnded, this, [this](qint64) { callOverlay_->hideIncoming(); });
}

void MainWindow::onWsEvent(const QString& type, const QJsonObject& data) {
  if (type == "message.new") {
    // Уведомление только для каналов, не открытых сейчас (как в вебе).
    const qint64 chId = data.value("channel_id").toVariant().toLongLong();
    if (chId == state_->currentChannelId()) return;
    const Message m = Message::fromJson(data);
    if (m.senderId == state_->user().id) return;
    // Показываем расшифрованный текст, если он уже получен (ключ есть),
    // иначе — «прислал(а) сообщение».
    const Message dec = state_->decryptMessagePublic(m);
    QString body = dec.encrypted ? "прислал(а) сообщение" : dec.text;
    if (body.size() > 120) body = body.left(120) + "…";
    const Channel* ch = state_->findChannel(chId);
    toasts_->showToast(m.senderNick + " · " + (ch ? ch->name : ""), body);
  } else if (type == "call.invite") {
    // Обрабатывается в initCallControls через CallManager::incomingCall.
    Q_UNUSED(data);
  } else if (type == "invite.new" || type == "invite.pending") {
    const QString nick = data.value("invited_by_nick").toString();
    const QString ch = data.value("channel_name").toString();
    toasts_->showToast("Новое приглашение", "В канал «" + ch + "» от " + nick);
  }
}

}  // namespace gl

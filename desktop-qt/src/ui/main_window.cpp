#include "ui/main_window.h"

#include <QApplication>
#include <QInputDialog>
#include <QMessageBox>
#include <QVBoxLayout>

#include "core/app_state.h"
#include "ui/channel_list.h"
#include "ui/chat_panel.h"
#include "ui/login_dialog.h"

namespace gl {

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

  connect(state_, &AppState::channelsChanged, this, [this]() { channelList_->refresh(); });
  connect(state_, &AppState::loginChanged, this, [this]() {
    if (state_->loggedIn()) channelList_->refresh();
  });
  connect(channelList_, &ChannelList::channelActivated, this,
          [this](qint64 id) { chatPanel_->openChannel(id); state_->openChannel(id); });
  connect(state_, &AppState::kekPrompt, this, &MainWindow::onKekPrompt);

  login_ = nullptr;
  if (!state_->loggedIn()) {
    QTimer::singleShot(0, this, &MainWindow::showLogin);
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

void MainWindow::onKekPrompt() {
  bool ok = false;
  const QString pass =
      QInputDialog::getText(this, "Разблокировать личные сообщения",
                            "Введите пароль аккаунта, чтобы расшифровать личные сообщения "
                            "и приватные каналы (нужен один раз):",
                            QLineEdit::Password, QString(), &ok);
  if (!ok) {
    state_->dismissKekPrompt();
    return;
  }
  state_->submitKek(pass, [this](bool success, const QString& err) {
    if (!success && !err.isEmpty()) {
      QMessageBox::warning(this, "Не удалось расшифровать", err);
    }
  });
}

}  // namespace gl

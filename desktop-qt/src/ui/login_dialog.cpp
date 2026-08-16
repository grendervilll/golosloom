#include "ui/login_dialog.h"

#include <QFormLayout>
#include <QJsonObject>
#include <QLabel>
#include <QPixmap>
#include <QPushButton>
#include <QSettings>
#include <QVBoxLayout>

#include "core/app_state.h"

namespace gl {

LoginDialog::LoginDialog(AppState* state, QWidget* parent) : QDialog(parent), state_(state) {
  setWindowTitle("Golosloom — вход");
  setFixedWidth(380);
  setObjectName("authDialog");

  auto* card = new QWidget(this);
  card->setObjectName("loginCard");
  auto* lay = new QVBoxLayout(card);
  lay->setContentsMargins(24, 28, 24, 28);
  lay->setSpacing(10);

  // Логотип (как в вебе — 96px сверху карточки).
  auto* logo = new QLabel(card);
  logo->setPixmap(QPixmap(":/app-icon.png").scaled(96, 96, Qt::KeepAspectRatio, Qt::SmoothTransformation));
  logo->setAlignment(Qt::AlignCenter);
  logo->setStyleSheet("border-radius: 24px;");
  lay->addWidget(logo);

  auto* title = new QLabel("Golosloom", card);
  title->setObjectName("loginTitle");
  title->setAlignment(Qt::AlignCenter);
  lay->addWidget(title);

  serverEdit_ = new QLineEdit(card);
  serverEdit_->setPlaceholderText("Адрес сервера");
  serverEdit_->setText(state_->serverUrl());
  lay->addWidget(serverEdit_);

  nickEdit_ = new QLineEdit(card);
  nickEdit_->setPlaceholderText("Ваш ник");
  lay->addWidget(nickEdit_);

  passEdit_ = new QLineEdit(card);
  passEdit_->setPlaceholderText("Пароль");
  passEdit_->setEchoMode(QLineEdit::Password);
  lay->addWidget(passEdit_);

  confirmEdit_ = new QLineEdit(card);
  confirmEdit_->setPlaceholderText("Ещё раз (для регистрации)");
  confirmEdit_->setEchoMode(QLineEdit::Password);
  lay->addWidget(confirmEdit_);

  error_ = new QLabel(card);
  error_->setObjectName("errorLabel");
  error_->setWordWrap(true);
  error_->setVisible(false);
  lay->addWidget(error_);

  auto* loginBtn = new QPushButton("Войти", card);
  auto* regBtn = new QPushButton("Зарегистрироваться", card);
  regBtn->setObjectName("ghost");
  lay->addWidget(loginBtn);
  lay->addWidget(regBtn);

  auto* hint = new QLabel("Сообщения шифруются сквозным шифрованием (E2E).", card);
  hint->setObjectName("hintLabel");
  hint->setWordWrap(true);
  lay->addWidget(hint);

  auto* outer = new QVBoxLayout(this);
  outer->addStretch();
  outer->addWidget(card);
  outer->addStretch();

  connect(loginBtn, &QPushButton::clicked, this, &LoginDialog::doLogin);
  connect(regBtn, &QPushButton::clicked, this, &LoginDialog::doRegister);
  connect(passEdit_, &QLineEdit::returnPressed, this, &LoginDialog::doLogin);
}

void LoginDialog::doLogin() {
  const QString server = serverEdit_->text().trimmed();
  const QString nick = nickEdit_->text().trimmed();
  const QString pass = passEdit_->text();
  if (server.isEmpty() || nick.isEmpty() || pass.isEmpty()) {
    error_->setText("Заполните адрес сервера, ник и пароль");
    error_->setVisible(true);
    return;
  }
  state_->setServerUrl(server);
  QSettings settings;
  settings.setValue("serverUrl", server);
  error_->setVisible(false);
  setEnabled(false);
  state_->login(nick, pass, [this, nick](const QString& err) {
    setEnabled(true);
    if (!err.isEmpty()) {
      error_->setText("Не удалось войти: " + err);
      error_->setVisible(true);
      return;
    }
    accept();
  });
}

void LoginDialog::doRegister() {
  const QString server = serverEdit_->text().trimmed();
  const QString nick = nickEdit_->text().trimmed();
  const QString pass = passEdit_->text();
  if (server.isEmpty() || nick.isEmpty() || pass.isEmpty() || pass != confirmEdit_->text()) {
    error_->setText("Заполните все поля; пароли должны совпадать");
    error_->setVisible(true);
    return;
  }
  state_->setServerUrl(server);
  QSettings settings;
  settings.setValue("serverUrl", server);
  error_->setVisible(false);
  setEnabled(false);
  state_->api()->registerUser(nick, pass, [this, nick, pass](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      setEnabled(true);
      error_->setText("Регистрация не удалась: " + err);
      error_->setVisible(true);
      return;
    }
    // Зарегистрировались — входим.
    state_->login(nick, pass, [this](const QString& err2) {
      setEnabled(true);
      if (!err2.isEmpty()) {
        error_->setText("Не удалось войти: " + err2);
        error_->setVisible(true);
        return;
      }
      accept();
    });
  });
}

}  // namespace gl

#pragma once
#include <QDialog>
#include <QLabel>
#include <QLineEdit>

namespace gl {

class AppState;

// Окно входа: адрес сервера, ник, пароль.
class LoginDialog : public QDialog {
  Q_OBJECT
 public:
  explicit LoginDialog(AppState* state, QWidget* parent = nullptr);

 private slots:
  void doLogin();
  void doRegister();

 private:
  AppState* state_;
  QLineEdit* serverEdit_;
  QLineEdit* nickEdit_;
  QLineEdit* passEdit_;
  QLineEdit* confirmEdit_;
  QLabel* error_;
};

}  // namespace gl

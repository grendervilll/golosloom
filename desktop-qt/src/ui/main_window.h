#pragma once
#include <QMainWindow>
#include <QSplitter>

namespace gl {

class AppState;
class ChannelList;
class ChatPanel;
class LoginDialog;

class MainWindow : public QMainWindow {
  Q_OBJECT
 public:
  explicit MainWindow(AppState* state, QWidget* parent = nullptr);

 private:
  void showLogin();
  void onKekPrompt();

  AppState* state_;
  QSplitter* splitter_;
  ChannelList* channelList_;
  ChatPanel* chatPanel_;
  LoginDialog* login_;
};

}  // namespace gl

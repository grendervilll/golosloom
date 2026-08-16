#pragma once
#include <QMainWindow>
#include <QSplitter>

namespace gl {

class AppState;
class CallManager;
class CallOverlay;
class ChannelList;
class ChatPanel;
class LoginDialog;
class ToastOverlay;

class MainWindow : public QMainWindow {
  Q_OBJECT
 public:
  explicit MainWindow(AppState* state, QWidget* parent = nullptr);

 private:
  void showLogin();
  void onWsEvent(const QString& type, const QJsonObject& data);
  void initCallControls();

  AppState* state_;
  CallManager* calls_ = nullptr;
  ToastOverlay* toasts_ = nullptr;
  CallOverlay* callOverlay_ = nullptr;
  QSplitter* splitter_;
  ChannelList* channelList_;
  ChatPanel* chatPanel_;
  LoginDialog* login_;
};

}  // namespace gl

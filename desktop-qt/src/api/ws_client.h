#pragma once
#include <QJsonObject>
#include <QObject>
#include <QTimer>
#include <QUrl>
#include <QWebSocket>
#include <functional>

namespace gl {

// WebSocket-клиент (как web/src/api/ws.ts). События — через сигналы.
// При обрыве соединения автоматически переподключается.
class WsClient : public QObject {
  Q_OBJECT
 public:
  explicit WsClient(QObject* parent = nullptr);

  void connectTo(const QString& serverUrl, const QString& token);
  void disconnectNow();
  void setAutoReconnect(bool on);
  bool isConnected() const { return connected_; }
  // Подписка/отписка на события канала (как channel.join/leave в вебе).
  void joinChannel(qint64 channelId);
  void leaveChannel(qint64 channelId);
  void send(const QString& type, const QJsonObject& data);
  void sendTyping(qint64 channelId);

 signals:
  void connectedChanged(bool connected);
  void eventReceived(const QString& type, const QJsonObject& data);

 private slots:
  void onTextMessage(const QString& message);

 private:
  void tryReconnect();
  void resubscribe();

  QWebSocket* ws_ = nullptr;
  QUrl url_;
  bool autoReconnect_ = true;
  bool connected_ = false;
  QTimer reconnect_;
  QStringList subscribedChannels_;  // "join" | "leave" — подписки на каналы
};

}  // namespace gl

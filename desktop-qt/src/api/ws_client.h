#pragma once
#include <QJsonObject>
#include <QObject>
#include <QWebSocket>
#include <functional>

namespace gl {

// WebSocket-клиент (как web/src/api/ws.ts). События — через сигналы.
class WsClient : public QObject {
  Q_OBJECT
 public:
  explicit WsClient(QObject* parent = nullptr);

  void connectTo(const QString& serverUrl, const QString& token);
  void disconnectNow();
  void send(const QString& type, const QJsonObject& data);

 signals:
  void connectedChanged(bool connected);
  void eventReceived(const QString& type, const QJsonObject& data);

 private slots:
  void onTextMessage(const QString& message);

 private:
  QWebSocket* ws_ = nullptr;
};

}  // namespace gl

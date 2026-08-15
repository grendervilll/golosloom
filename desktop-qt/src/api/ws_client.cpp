#include "api/ws_client.h"

#include <QJsonDocument>
#include <QUrl>

namespace gl {

WsClient::WsClient(QObject* parent) : QObject(parent), ws_(new QWebSocket()) {
  connect(ws_, &QWebSocket::connected, this, [this]() { emit connectedChanged(true); });
  connect(ws_, &QWebSocket::disconnected, this, [this]() { emit connectedChanged(false); });
  connect(ws_, &QWebSocket::textMessageReceived, this, &WsClient::onTextMessage);
}

void WsClient::connectTo(const QString& serverUrl, const QString& token) {
  QUrl url(serverUrl);
  url.setScheme(url.scheme() == "https" ? "wss" : "ws");
  url.setPath("/ws");
  url.setQuery("token=" + token);
  ws_->open(url);
}

void WsClient::disconnectNow() {
  ws_->close();
}

void WsClient::send(const QString& type, const QJsonObject& data) {
  QJsonObject msg = data;
  msg.insert("type", type);
  ws_->sendTextMessage(QString::fromUtf8(QJsonDocument(msg).toJson(QJsonDocument::Compact)));
}

void WsClient::onTextMessage(const QString& message) {
  const QJsonObject obj = QJsonDocument::fromJson(message.toUtf8()).object();
  const QString type = obj.value("type").toString();
  if (!type.isEmpty()) emit eventReceived(type, obj);
}

}  // namespace gl

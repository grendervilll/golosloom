#include "api/ws_client.h"

#include <QJsonDocument>
#include <QTimer>

namespace gl {

WsClient::WsClient(QObject* parent) : QObject(parent), ws_(new QWebSocket()) {
  connect(ws_, &QWebSocket::connected, this, [this]() {
    connected_ = true;
    resubscribe();
    emit connectedChanged(true);
  });
  connect(ws_, &QWebSocket::disconnected, this, [this]() {
    connected_ = false;
    emit connectedChanged(false);
    if (autoReconnect_) tryReconnect();
  });
  connect(ws_, &QWebSocket::textMessageReceived, this, &WsClient::onTextMessage);
  reconnect_.setSingleShot(true);
  reconnect_.setInterval(3000);
  connect(&reconnect_, &QTimer::timeout, this, &WsClient::tryReconnect);
}

void WsClient::connectTo(const QString& serverUrl, const QString& token) {
  QUrl url(serverUrl);
  url.setScheme(url.scheme() == "https" ? "wss" : "ws");
  url.setPath("/ws");
  url.setQuery("token=" + token);
  url_ = url;
  ws_->open(url);
}

void WsClient::disconnectNow() {
  autoReconnect_ = false;
  reconnect_.stop();
  ws_->close();
}

void WsClient::setAutoReconnect(bool on) {
  autoReconnect_ = on;
  if (!on) reconnect_.stop();
}

void WsClient::tryReconnect() {
  if (connected_ || url_.isEmpty()) return;
  subscribedChannels_.clear();
  ws_->open(url_);
}

void WsClient::joinChannel(qint64 channelId) {
  resubscribe();
  send("channel.join", {{"channel_id", QJsonValue::fromVariant(channelId)}});
}

void WsClient::leaveChannel(qint64 channelId) {
  send("channel.leave", {{"channel_id", QJsonValue::fromVariant(channelId)}});
}

void WsClient::sendTyping(qint64 channelId) {
  send("typing", {{"channel_id", QJsonValue::fromVariant(channelId)}});
}

void WsClient::resubscribe() {
  // После переподключения сервер сам присылает события каналов, в которых
  // состоит пользователь; дополнительных подписок не требуется, кроме
  // переподписки на текущий канал (если что — AppState перечитает каналы).
  subscribedChannels_.clear();
}

void WsClient::send(const QString& type, const QJsonObject& data) {
  const QJsonObject msg{{"type", type}, {"data", data}};
  ws_->sendTextMessage(QString::fromUtf8(QJsonDocument(msg).toJson(QJsonDocument::Compact)));
}

void WsClient::onTextMessage(const QString& message) {
  const QJsonObject obj = QJsonDocument::fromJson(message.toUtf8()).object();
  const QString type = obj.value("type").toString();
  if (type.isEmpty()) return;
  // Сервер шлёт {"type": "...", "data": {...}} — данные в поле data.
  const QJsonObject data = obj.value("data").toObject();
  emit eventReceived(type, data);
}

}  // namespace gl
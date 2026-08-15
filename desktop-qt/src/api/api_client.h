#pragma once
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QObject>
#include <functional>

#include "models.h"

namespace gl {

// REST-клиент к серверу Golosloom (повторяет web/src/api/http.ts).
class ApiClient : public QObject {
  Q_OBJECT
 public:
  explicit ApiClient(QObject* parent = nullptr);
  ~ApiClient() override;

  void setBaseUrl(const QString& url);
  void setToken(const QString& token);
  QString baseUrl() const { return baseUrl_; }

  using Callback = std::function<void(const QJsonObject&, const QString&)>;

  void get(const QString& path, Callback cb);
  void post(const QString& path, const QJsonObject& body, Callback cb);
  void patch(const QString& path, const QJsonObject& body, Callback cb);
  void put(const QString& path, const QJsonObject& body, Callback cb);
  void del(const QString& path, Callback cb);

  // Удобные методы
  void login(const QString& nick, const QString& password, Callback cb);
  void registerUser(const QString& nick, const QString& password, Callback cb);
  void me(Callback cb);
  void listChannels(Callback cb);
  void listMessages(qint64 channelId, qint64 beforeId, Callback cb);
  void sendMessage(qint64 channelId, const QByteArray& ciphertext, const QByteArray& iv, bool plain,
                   const QVector<qint64>& attIds, qint64 replyTo, Callback cb);
  void search(const QString& q, Callback cb);
  void createDm(qint64 userId, Callback cb);
  void createCommunity(const QString& name, Callback cb);
  void joinChannel(qint64 channelId, Callback cb);
  void leaveChannel(qint64 channelId, Callback cb);
  void listMembers(qint64 channelId, Callback cb);
  void uploadDeviceKey(const QString& deviceId, const QByteArray& publicKey, Callback cb);
  void getMyWrappedKey(qint64 channelId, const QString& deviceId, Callback cb);
  void uploadWrappedKey(qint64 channelId, qint64 userId, const QString& deviceId, const QByteArray& wrapped,
                        Callback cb);
  void pendingKeyTargets(qint64 channelId, Callback cb);
  void resetChannelKey(qint64 channelId, const QString& deviceId, const QByteArray& wrapped, Callback cb);
  void getKeyBackup(qint64 channelId, Callback cb);
  void uploadKeyBackup(qint64 channelId, const QByteArray& wrapped, Callback cb);
  void uploadFile(qint64 channelId, const QString& filePath, Callback cb);

 private:
  QNetworkReply* request(const QString& method, const QString& path, const QJsonObject& body, Callback cb);
  QNetworkAccessManager* net_ = nullptr;
  QString baseUrl_;
  QString token_;
};

}  // namespace gl

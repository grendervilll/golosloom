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
  void getChannel(qint64 channelId, Callback cb);
  void listMessages(qint64 channelId, qint64 beforeId, Callback cb);
  void sendMessage(qint64 channelId, const QByteArray& ciphertext, const QByteArray& iv,
                   const QVector<qint64>& attIds, qint64 replyTo, Callback cb);
  void editMessage(qint64 channelId, qint64 messageId, const QByteArray& ciphertext, const QByteArray& iv,
                   Callback cb);
  void deleteMessage(qint64 channelId, qint64 messageId, Callback cb);
  void createChannel(const QString& name, bool isPrivate, Callback cb);
  void deleteChannel(qint64 channelId, Callback cb);
  void joinChannel(qint64 channelId, Callback cb);
  void listMembers(qint64 channelId, Callback cb);
  void listUsers(Callback cb);
  void createInvite(qint64 channelId, qint64 userId, Callback cb);
  void listInvites(Callback cb);
  void respondInvite(qint64 inviteId, bool accept, Callback cb);
  void uploadDeviceKey(const QString& deviceId, const QByteArray& publicKey, Callback cb);
  void getMyWrappedKey(qint64 channelId, const QString& deviceId, Callback cb);
  void uploadWrappedKey(qint64 channelId, qint64 userId, const QString& deviceId, const QByteArray& wrapped,
                        Callback cb);
  void pendingKeyTargets(qint64 channelId, Callback cb);
  void getKeyBackup(qint64 channelId, Callback cb);
  void uploadKeyBackup(qint64 channelId, const QByteArray& wrapped, Callback cb);
  void uploadFile(qint64 channelId, const QString& filePath, Callback cb);
  // Скачивание файла (короткоживущий файловый токен). При download=true —
  // принудительное скачивание, иначе открытие в браузере.
  void downloadFile(qint64 fileId, bool download, const QString& destPath, Callback cb);
  void getFileToken(Callback cb);

 private:
  QNetworkReply* request(const QString& method, const QString& path, const QJsonObject& body, Callback cb);
  QNetworkAccessManager* net_ = nullptr;
  QString baseUrl_;
  QString token_;
};

}  // namespace gl

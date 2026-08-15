#pragma once
#include <QDateTime>
#include <QJsonArray>
#include <QObject>
#include <QSet>
#include <QTimer>

#include "api/api_client.h"
#include "api/ws_client.h"
#include "crypto/crypto.h"
#include "crypto/storage.h"
#include "models.h"

namespace gl {

// Центральное состояние приложения (как useChannelsStore + useChatStore
// в вебе): вход, каналы, ключи (обёртки/бэкапы/раздача), сообщения.
class AppState : public QObject {
  Q_OBJECT
 public:
  explicit AppState(QObject* parent = nullptr);
  // Хранилище можно заменить (для тестов с несколькими пользователями).
  void setStorage(KeyStorage* storage) { storage_ = storage; }
  KeyStorage* storage() { return storage_; }

  ApiClient* api() { return &api_; }
  WsClient* ws() { return &ws_; }

  QString serverUrl() const { return serverUrl_; }
  void setServerUrl(const QString& url);

  bool loggedIn() const { return user_.id != 0; }
  const User& user() const { return user_; }
  const DeviceKeys& device() const { return device_; }
  QString kek() const { return kek_; }

  const QVector<Channel>& channels() const { return channels_; }
  Channel* findChannel(qint64 id);
  const QVector<Message>& messages(qint64 channelId) const;
  qint64 currentChannelId() const { return currentId_; }
  void openChannel(qint64 channelId);

  void login(const QString& nick, const QString& password, std::function<void(const QString&)> done);
  void logout();
  // Создание личного чата/сообщества + ключ канала (как в вебе).
  void createDm(qint64 userId, std::function<void(const QString&)> done);
  void createCommunity(const QString& name, std::function<void(const QString&)> done);
  void initChannelKey(qint64 channelId);

  // Отправка сообщения (расшифровка/шифрование, как chat.send в вебе).
  void sendMessage(qint64 channelId, const QString& text, std::function<void(const QString&)> done);

  // Ключи
  void syncKeys(qint64 channelId);
  void syncAllKeys();
  void submitKek(const QString& password, std::function<void(bool ok, const QString& err)> done);
  bool kekPromptNeeded() const { return kekPromptNeeded_; }
  void dismissKekPrompt() { kekPromptNeeded_ = false; }
  void setPassword(const QString& password) { password_ = password; }

 signals:
  void loginChanged();
  void channelsChanged();
  void messagesChanged(qint64 channelId);
  void messageAdded(qint64 channelId, const Message& msg);
  void connectionChanged(bool connected);
  void kekPrompt();

 private:
  void ensureDevice();
  void wireWs();
  void startKeyPoll();
  void refreshChannels();
  QByteArray getKek();
  void uploadBackup(qint64 channelId, const QByteArray& key);
  void handleWsEvent(const QString& type, const QJsonObject& data);
  void processMessage(qint64 channelId, const Message& raw, bool fromHistory);
  Message decryptMessage(const Message& raw);
  void loadHistory(qint64 channelId);

  ApiClient api_;
  WsClient ws_;
  KeyStorage* storage_ = nullptr;
  QString serverUrl_;
  QString token_;
  QString password_;
  User user_;
  DeviceKeys device_;
  QByteArray kek_;  // закэшированный ключ из пароля
  bool deviceReady_ = false;
  bool kekPromptNeeded_ = false;
  bool kekPromptShown_ = false;
  QSet<qint64> keyResetTried_;
  QHash<qint64, QVector<Message>> messages_;
  QVector<Channel> channels_;
  qint64 currentId_ = 0;
  QTimer keyPoll_;
  QTimer channelsRefresh_;
  bool pollStarted_ = false;
};

}  // namespace gl

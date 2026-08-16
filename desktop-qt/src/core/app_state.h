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

  const QVector<Channel>& channels() const { return channels_; }
  Channel* findChannel(qint64 id);
  const QVector<Message>& messages(qint64 channelId) const;
  qint64 currentChannelId() const { return currentId_; }
  void openChannel(qint64 channelId);
  // Счётчик непрочитанных сообщений канала (сбрасывается при открытии).
  int unreadCount(qint64 channelId) const { return unread_.value(channelId, 0); }
  // Пагинация истории: есть ли более старые сообщения / загрузить их.
  bool hasOlderMessages(qint64 channelId) const { return hasMore_.value(channelId, false); }
  void loadOlderMessages(qint64 channelId, std::function<void()> done = {});

  void login(const QString& nick, const QString& password, std::function<void(const QString&)> done);
  // Авто-вход по сохранённому токену (как localStorage в вебе).
  void restoreSession(std::function<void(bool ok, const QString& err)> done);
  void logout();
  // Создание канала + ключ канала (как в вебе).
  void createChannel(const QString& name, bool isPrivate, std::function<void(const QString&)> done);
  // Вступление в канал: REST join + подписка на события по WS.
  void joinChannel(qint64 channelId, std::function<void(const QString&)> done);
  void initChannelKey(qint64 channelId);

  // Отправка сообщения (расшифровка/шифрование, как chat.send в вебе).
  void sendMessage(qint64 channelId, const QString& text, const QVector<qint64>& attachmentIds = {},
                   qint64 replyToId = 0, std::function<void(const QString&)> done = {});
  // Редактирование/удаление своих сообщений.
  void editMessage(qint64 channelId, qint64 messageId, const QString& text,
                   std::function<void(const QString&)> done);
  void deleteMessage(qint64 channelId, qint64 messageId, std::function<void(const QString&)> done);
  // Загрузка файла в канал и отправка сообщения с вложением.
  void uploadFile(qint64 channelId, const QString& filePath, std::function<void(const QString&)> done);

  // Участники канала, пользователи сервера, приглашения.
  void loadMembers(qint64 channelId, std::function<void(const QVector<ChannelMember>&)> done);
  void loadUsers(std::function<void(const QVector<User>&)> done);
  void loadInvites(std::function<void(const QVector<Invite>&)> done);
  void createInvite(qint64 channelId, qint64 userId, std::function<void(const QString&)> done);
  void respondInvite(qint64 inviteId, bool accept, std::function<void(const QString&)> done);
  int pendingInvites() const { return invites_.size(); }

  // Ключи
  void syncKeys(qint64 channelId);
  void syncAllKeys();

 signals:
  void loginChanged();
  void channelsChanged();
  void messagesChanged(qint64 channelId);
  void messageAdded(qint64 channelId, const Message& msg);
  void connectionChanged(bool connected);
  void invitesChanged();
  void typingChanged(qint64 channelId, const QString& nick);

 public:
  void refreshChannelsPublic() { refreshChannels(); }
  Message decryptMessagePublic(const Message& raw) { return decryptMessage(raw); }
  void sendTyping(qint64 channelId);

 private:
  void ensureDevice();
  void wireWs();
  void startKeyPoll();
  void refreshChannels();  // (публичный: используется смок-тестами)
  void handleWsEvent(const QString& type, const QJsonObject& data);
  void processMessage(qint64 channelId, const Message& raw, bool fromHistory);
  Message decryptMessage(const Message& raw);
  void loadHistory(qint64 channelId);

  ApiClient api_;
  WsClient ws_;
  KeyStorage* storage_ = nullptr;
  QString serverUrl_;
  QString token_;
  User user_;
  DeviceKeys device_;
  bool deviceReady_ = false;
  QHash<qint64, QVector<Message>> messages_;
  QHash<qint64, int> unread_;
  QHash<qint64, bool> hasMore_;
  QVector<Channel> channels_;
  QVector<Invite> invites_;
  qint64 currentId_ = 0;
  QTimer keyPoll_;
  QTimer channelsRefresh_;
  bool pollStarted_ = false;
};

}  // namespace gl

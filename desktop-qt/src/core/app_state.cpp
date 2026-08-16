#include "core/app_state.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QUrlQuery>

#include <algorithm>

#include "crypto/storage.h"
#include "util/base64.h"

namespace gl {

namespace {

QJsonArray arrOf(const QJsonObject& o, const char* key) {
  const QJsonValue v = o.value(key);
  if (v.isArray()) return v.toArray();
  if (v.isObject()) return v.toObject().value("_array").toArray();
  return {};
}

QByteArray b64OrNull(const QJsonObject& o, const char* key) {
  const QJsonValue v = o.value(key);
  if (v.isNull() || v.isUndefined()) return {};
  return b64Decode(v.toString());
}

QString utf8OrNull(const QJsonObject& o, const char* key) {
  const QJsonValue v = o.value(key);
  if (v.isNull() || v.isUndefined()) return QString();
  return v.toString();
}

}  // namespace

// ---------- Модели ----------

User User::fromJson(const QJsonObject& o) {
  User u;
  u.id = o.value("id").toVariant().toLongLong();
  u.nick = o.value("nick").toString();
  u.avatar = o.value("avatar").toString();
  u.isServerAdmin = o.value("is_server_admin").toBool();
  u.serverBanned = o.value("server_banned").toBool();
  return u;
}

Channel Channel::fromJson(const QJsonObject& o) {
  Channel c;
  c.id = o.value("id").toVariant().toLongLong();
  c.name = o.value("name").toString();
  c.isPrivate = o.value("private").toBool();
  c.creatorId = o.value("creator_id").toVariant().toLongLong();
  c.role = o.value("role").toString();
  c.isMember = o.value("is_member").toBool();
  c.createdAt = o.value("created_at").toString();
  return c;
}

Message Message::fromJson(const QJsonObject& o) {
  Message m;
  m.id = o.value("id").toVariant().toLongLong();
  m.channelId = o.value("channel_id").toVariant().toLongLong();
  m.senderId = o.value("sender_id").toVariant().toLongLong();
  m.senderNick = o.value("sender_nick").toString();
  m.ciphertext = b64OrNull(o, "ciphertext");
  m.iv = b64OrNull(o, "iv");
  m.deleted = o.value("deleted").toBool();
  m.edited = !o.value("edited_at").isNull() && o.value("edited_at").isUndefined() == false;
  m.createdAt = o.value("created_at").toString();
  m.replyTo = o.value("reply_to").toVariant().toLongLong();
  const QJsonArray atts = o.value("attachments").toArray();
  for (const QJsonValue& a : atts) {
    const QJsonObject ao = a.toObject();
    Message::Attachment att;
    att.id = ao.value("id").toVariant().toLongLong();
    att.filename = ao.value("filename").toString();
    att.mime = ao.value("mime").toString();
    att.size = ao.value("size").toVariant().toLongLong();
    m.attachments.append(att);
  }
  return m;
}

ChannelMember ChannelMember::fromJson(const QJsonObject& o) {
  ChannelMember m;
  m.userId = o.value("user_id").toVariant().toLongLong();
  m.nick = o.value("nick").toString();
  m.role = o.value("role").toString();
  m.isServerAdmin = o.value("is_server_admin").toBool();
  m.online = o.value("online").toBool();
  return m;
}

Invite Invite::fromJson(const QJsonObject& o) {
  Invite i;
  i.id = o.value("id").toVariant().toLongLong();
  i.channelId = o.value("channel_id").toVariant().toLongLong();
  i.channelName = o.value("channel_name").toString();
  i.invitedBy = o.value("invited_by").toVariant().toLongLong();
  i.invitedByNick = o.value("invited_by_nick").toString();
  i.createdAt = o.value("created_at").toString();
  return i;
}

// ---------- AppState ----------

AppState::AppState(QObject* parent) : QObject(parent), storage_(new KeyStorage()) {
  connect(&ws_, &WsClient::eventReceived, this, &AppState::handleWsEvent);
  connect(&keyPoll_, &QTimer::timeout, this, [this]() { syncAllKeys(); });
  keyPoll_.setInterval(7000);
  keyPoll_.setSingleShot(false);
  // Периодический рефреш списка каналов: новые DM/сообщества появляются
  // у собеседников без перезагрузки (как presence-обновления в вебе).
  connect(&channelsRefresh_, &QTimer::timeout, this, [this]() { refreshChannels(); });
  channelsRefresh_.setInterval(10000);
  channelsRefresh_.setSingleShot(false);
}

void AppState::setServerUrl(const QString& url) {
  serverUrl_ = url;
  while (serverUrl_.endsWith('/')) serverUrl_.chop(1);
  api_.setBaseUrl(serverUrl_);
}

Channel* AppState::findChannel(qint64 id) {
  for (Channel& c : channels_) {
    if (c.id == id) return &c;
  }
  return nullptr;
}

const QVector<Message>& AppState::messages(qint64 channelId) const {
  static const QVector<Message> kEmpty;
  const auto it = messages_.constFind(channelId);
  return it == messages_.constEnd() ? kEmpty : it.value();
}

void AppState::openChannel(qint64 channelId) {
  currentId_ = channelId;
  unread_.insert(channelId, 0);
  loadHistory(channelId);
  syncKeys(channelId);
  if (!pollStarted_) startKeyPoll();
  emit channelsChanged();  // сброс бейджа непрочитанных
}

void AppState::ensureDevice() {
  if (deviceReady_) return;
  KeyStorage* st = storage_;
  const QString saved = storage_->loadDevice();
  if (!saved.isEmpty()) {
    const QJsonObject d = QJsonDocument::fromJson(saved.toUtf8()).object();
    const QString id = d.value("deviceId").toString();
    const QString priv = d.value("privateKey").toString();
    const QString pub = d.value("publicKey").toString();
    if (!id.isEmpty() && !priv.isEmpty() && !pub.isEmpty()) {
      device_.deviceId = id;
      device_.privateKey = b64Decode(priv);
      device_.publicKey = b64Decode(pub);
      deviceReady_ = true;
      return;
    }
  }
  device_ = generateDeviceKeys();
  const QJsonObject d{{"deviceId", device_.deviceId},
                      {"privateKey", QString::fromLatin1(b64Encode(device_.privateKey))},
                      {"publicKey", QString::fromLatin1(b64Encode(device_.publicKey))}};
  storage_->saveDevice(QString::fromUtf8(QJsonDocument(d).toJson(QJsonDocument::Compact)));
  deviceReady_ = true;
  // Регистрируем устройство на сервере.
  api_.uploadDeviceKey(device_.deviceId, device_.publicKey, [](const QJsonObject&, const QString&) {});
}

void AppState::login(const QString& nick, const QString& password, std::function<void(const QString&)> done) {
  password_ = password;
  api_.login(nick, password, [this, password, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    token_ = res.value("token").toString();
    api_.setToken(token_);
    storage_->saveToken(token_);
    api_.me([this, password, done](const QJsonObject& me, const QString& err2) {
      if (!err2.isEmpty()) {
        done(err2);
        return;
      }
      user_ = User::fromJson(me);
      // KEK из пароля сохраняем сразу (как в вебе) — для парольных бэкапов.
      if (!password.isEmpty() && user_.id) {
        kek_ = deriveKek(password, user_.id);
        storage_->saveKek(kek_);
      }
      ensureDevice();
      api_.listChannels([this, done](const QJsonObject& chs, const QString& err3) {
        channels_.clear();
        for (const QJsonValue& v : arrOf(chs, "_array")) {
          channels_.append(Channel::fromJson(v.toObject()));
        }
        ws_.connectTo(serverUrl_, token_);
        wireWs();
        startKeyPoll();
        syncAllKeys();
        loadInvites([](const QVector<Invite>&) {});
        emit loginChanged();
        emit channelsChanged();
        done(QString());
      });
    });
  });
}

void AppState::createChannel(const QString& name, bool isPrivate, std::function<void(const QString&)> done) {
  api_.createChannel(name, isPrivate, [this, isPrivate, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    const Channel ch = Channel::fromJson(res);
    channels_.append(ch);
    emit channelsChanged();
    initChannelKey(ch.id);
    done(QString());
  });
}

void AppState::restoreSession(std::function<void(bool, const QString&)> done) {
  const QString savedToken = storage_->loadToken();
  if (savedToken.isEmpty()) {
    done(false, "нет сохранённой сессии");
    return;
  }
  token_ = savedToken;
  api_.setToken(token_);
  api_.me([this, done](const QJsonObject& me, const QString& err) {
    if (!err.isEmpty()) {
      // Токен протух (TTL 1 день) или инвалидирован — чистим сессию.
      storage_->clearToken();
      token_.clear();
      api_.setToken(QString());
      done(false, err);
      return;
    }
    user_ = User::fromJson(me);
    // KEK из хранилища (сохранён при первом входе по паролю).
    kek_ = storage_->loadKek();
    ensureDevice();
    api_.listChannels([this, done](const QJsonObject& chs, const QString& err3) {
      if (!err3.isEmpty()) {
        done(false, err3);
        return;
      }
      channels_.clear();
      for (const QJsonValue& v : arrOf(chs, "_array")) {
        channels_.append(Channel::fromJson(v.toObject()));
      }
      ws_.connectTo(serverUrl_, token_);
      wireWs();
      startKeyPoll();
      syncAllKeys();
      loadInvites([](const QVector<Invite>&) {});
      emit loginChanged();
      emit channelsChanged();
      // На новом устройстве KEK нет — нужен пароль для расшифровки бэкапов.
      if (kekMissing() && !channels_.isEmpty()) {
        emit kekPromptNeeded();
      }
      done(true, QString());
    });
  });
}

// Ввод пароля на новом устройстве: выводим KEK и пересинхронизируем ключи.
void AppState::submitKek(const QString& password, std::function<void(bool, const QString&)> done) {
  if (!user_.id) {
    done(false, "нет пользователя");
    return;
  }
  const QByteArray k = deriveKek(password, user_.id);
  if (k.isEmpty()) {
    done(false, "не удалось вывести ключ из пароля");
    return;
  }
  // Проверка пароля: расшифровываем первый доступный бэкап. Если ни одного
  // бэкапа нет — пароль считаем верным (ключей просто нет).
  auto checked = std::make_shared<bool>(false);
  int pending = 0;
  for (const Channel& ch : channels_) {
    if (!ch.isMember) continue;
    pending++;
    api_.getKeyBackup(ch.id, [this, password, k, done, checked](const QJsonObject& res, const QString&) {
      if (*checked) return;
      const QByteArray wrapped = b64Decode(res.value("wrapped_key").toString());
      if (wrapped.isEmpty()) return;  // бэкапа нет — пробуем следующий канал
      *checked = true;
      if (unwrapWithKek(k, wrapped).isEmpty()) {
        done(false, "Неверный пароль — сообщения не расшифрованы");
      } else {
        finishKek(password, k, done);
      }
    });
  }
  if (pending == 0) {
    finishKek(password, k, done);
  } else {
    // Если все запросы вернулись без бэкапов — ждём последний колбэк.
    // Время на ответы: поллинг сам подхватит; здесь просто финализируем.
    QTimer::singleShot(1500, this, [this, password, k, done, checked]() {
      if (!*checked) finishKek(password, k, done);
    });
  }
}

void AppState::finishKek(const QString& password, const QByteArray& k,
                         std::function<void(bool, const QString&)> done) {
  password_ = password;
  kek_ = k;
  storage_->saveKek(k);
  syncAllKeys();
  if (currentId_) loadHistory(currentId_);
  done(true, QString());
}

// Создание ключа канала (создатель) — только для E2E-каналов.
void AppState::joinChannel(qint64 channelId, std::function<void(const QString&)> done) {
  api_.joinChannel(channelId, [this, channelId, done](const QJsonObject&, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    // Подписка на события канала (как в вебе после REST-join).
    ws_.joinChannel(channelId);
    refreshChannels();
    done(QString());
  });
}

void AppState::initChannelKey(qint64 channelId) {
  ensureDevice();
  if (!storage_->loadChannelKey(channelId).isEmpty()) return;
  const QByteArray key = generateChannelKey();
  const QByteArray wrapped = wrapChannelKey(key, device_.publicKey);
  api_.uploadWrappedKey(channelId, user_.id, device_.deviceId, wrapped, [this, channelId, key](const QJsonObject&, const QString& err) {
    if (!err.isEmpty()) return;
    storage_->saveChannelKey(channelId, key);
    uploadBackup(channelId, key);
  });
}

void AppState::logout() {
  ws_.disconnectNow();
  keyPoll_.stop();
  pollStarted_ = false;
  token_.clear();
  storage_->clearToken();
  api_.setToken(QString());
  user_ = User();
  password_.clear();
  kek_.clear();
  channels_.clear();
  messages_.clear();
  currentId_ = 0;
  emit loginChanged();
}

void AppState::startKeyPoll() {
  if (pollStarted_) return;
  pollStarted_ = true;
  keyPoll_.start();
  channelsRefresh_.start();
}

// Обновление списка каналов: добавляем новые, не трогаем существующие.
void AppState::refreshChannels() {
  api_.listChannels([this](const QJsonObject& chs, const QString& err) {
    if (!err.isEmpty()) return;
    QVector<Channel> fresh;
    for (const QJsonValue& v : arrOf(chs, "_array")) {
      fresh.append(Channel::fromJson(v.toObject()));
    }
    bool changed = fresh.size() != channels_.size();
    if (!changed) {
      for (int i = 0; i < fresh.size(); i++) {
        if (fresh[i].id != channels_[i].id) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    const QSet<qint64> oldIds;
    for (const Channel& c : channels_) {
      if (!std::any_of(fresh.begin(), fresh.end(), [&](const Channel& f) { return f.id == c.id; })) {
        messages_.remove(c.id);
      }
    }
    channels_ = fresh;
    emit channelsChanged();
    syncAllKeys();
  });
}

void AppState::wireWs() {
  // событийная обработка уже подключена в конструкторе через eventReceived
}

void AppState::handleWsEvent(const QString& type, const QJsonObject& data) {
  if (type == "presence") {
    refreshChannels();
  } else if (type == "message.new") {
    const Message m = Message::fromJson(data);
    processMessage(m.channelId, m, false);
  } else if (type == "message.edited") {
    const Message m = Message::fromJson(data);
    const auto it = messages_.find(m.channelId);
    if (it != messages_.end()) {
      const Message dec = decryptMessage(m);
      for (Message& x : it.value()) {
        if (x.id == m.id) {
          x = dec;
          emit messagesChanged(m.channelId);
          break;
        }
      }
    }
  } else if (type == "message.deleted") {
    const qint64 chId = data.value("channel_id").toVariant().toLongLong();
    const qint64 mid = data.value("message_id").toVariant().toLongLong();
    const auto it = messages_.find(chId);
    if (it != messages_.end()) {
      for (Message& x : it.value()) {
        if (x.id == mid) x.deleted = true;
      }
      emit messagesChanged(chId);
    }
  } else if (type == "invite.new" || type == "invite.pending") {
    loadInvites([](const QVector<Invite>&) {});
  } else if (type == "typing") {
    emit typingChanged(data.value("channel_id").toVariant().toLongLong(),
                       data.value("nick").toString());
  } else if (type == "key.needed") {
    const qint64 chId = data.value("channel_id").toVariant().toLongLong();
    const qint64 userId = data.value("user_id").toVariant().toLongLong();
    const QString devId = data.value("device_id").toString();
    const QByteArray pub = b64Decode(data.value("public_key").toString());
    const QByteArray myKey = storage_->loadChannelKey(chId);
    if (!myKey.isEmpty() && !pub.isEmpty()) {
      api_.uploadWrappedKey(chId, userId, devId, wrapChannelKey(myKey, pub), [](const QJsonObject&, const QString&) {});
    }
  } else if (type == "key.granted") {
    syncKeys(data.value("channel_id").toVariant().toLongLong());
  } else if (type == "device.registered") {
    syncAllKeys();
  } else if (type == "channel.deleted") {
    const qint64 chId = data.value("channel_id").toVariant().toLongLong();
    if (currentId_ == chId) currentId_ = 0;
    for (int i = 0; i < channels_.size(); i++) {
      if (channels_[i].id == chId) {
        channels_.removeAt(i);
        break;
      }
    }
    emit channelsChanged();
  }
}

void AppState::loadHistory(qint64 channelId) {
  api_.listMessages(channelId, 0, [this, channelId](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      hasMore_.insert(channelId, false);
      return;
    }
    QVector<Message> out;
    for (const QJsonValue& v : arrOf(res, "_array")) {
      out.append(decryptMessage(Message::fromJson(v.toObject())));
    }
    // Повторная загрузка (синхронизация ключей) может вернуть пустоту,
    // пока сообщения ещё не написаны — не перезаписываем уже накопленное.
    const auto it = messages_.constFind(channelId);
    if (out.isEmpty() && it != messages_.constEnd() && !it.value().isEmpty()) {
      return;
    }
    // Если получили полную страницу (50) — старее сообщения возможны.
    hasMore_.insert(channelId, out.size() >= 50);
    messages_.insert(channelId, out);
    emit messagesChanged(channelId);
  });
}

void AppState::loadOlderMessages(qint64 channelId, std::function<void()> done) {
  if (!done) done = []() {};
  const auto it = messages_.constFind(channelId);
  if (it == messages_.constEnd() || it.value().isEmpty()) {
    done();
    return;
  }
  const qint64 firstId = it.value().first().id;
  api_.listMessages(channelId, firstId, [this, channelId, firstId, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      hasMore_.insert(channelId, false);
      done();
      return;
    }
    QVector<Message> older;
    for (const QJsonValue& v : arrOf(res, "_array")) {
      older.append(decryptMessage(Message::fromJson(v.toObject())));
    }
    hasMore_.insert(channelId, older.size() >= 50);
    if (older.isEmpty()) {
      done();
      return;
    }
    // Вставляем старые сообщения перед уже загруженными.
    auto cur = messages_.find(channelId);
    if (cur == messages_.end()) {
      cur.value() = older;
    } else {
      QVector<Message> merged;
      merged.reserve(older.size() + cur.value().size());
      for (const Message& m : older) merged.append(m);
      for (const Message& m : cur.value()) merged.append(m);
      cur.value() = merged;
    }
    emit messagesChanged(channelId);
    done();
  });
}

Message AppState::decryptMessage(const Message& raw) {
  Message m = raw;
  if (m.deleted) return m;
  const QByteArray key = storage_->loadChannelKey(m.channelId);
  if (key.isEmpty()) {
    m.encrypted = true;
    return m;
  }
  const QString text = gl::decryptMessage(key, m.ciphertext, m.iv);
  if (text.isEmpty()) {
    m.encrypted = true;
  } else {
    m.text = text;
  }
  return m;
}

void AppState::processMessage(qint64 channelId, const Message& raw, bool fromHistory) {
  Q_UNUSED(fromHistory);
  Message m = decryptMessage(raw);
  // Непрочитанное: чужие сообщения в каналах, не открытых сейчас.
  if (!fromHistory && m.senderId != user_.id && channelId != currentId_) {
    unread_.insert(channelId, unread_.value(channelId, 0) + 1);
    emit channelsChanged();
  }
  auto it = messages_.find(channelId);
  if (it == messages_.end()) {
    messages_.insert(channelId, {m});
    emit messageAdded(channelId, m);
    emit messagesChanged(channelId);
    return;
  }
  // Дубликат (своё оптимистичное сообщение) — заменяем.
  for (int i = 0; i < it.value().size(); i++) {
    if (it.value()[i].id == m.id) {
      it.value()[i] = m;
      emit messagesChanged(channelId);
      return;
    }
  }
  it.value().append(m);
  emit messageAdded(channelId, m);
  emit messagesChanged(channelId);
}

void AppState::sendMessage(qint64 channelId, const QString& text, const QVector<qint64>& attachmentIds,
                           qint64 replyToId, std::function<void(const QString&)> done) {
  if (!done) done = [](const QString&) {};
  const QByteArray key = storage_->loadChannelKey(channelId);
  if (key.isEmpty()) {
    // Ключа нет: сначала пробуем синхронизацию (бэкап/раздача), повторяем
    // несколько раз, и только потом сообщаем пользователю.
    syncKeys(channelId);
    QTimer::singleShot(800, this, [this, channelId, text, attachmentIds, replyToId, done]() {
      const QByteArray k2 = storage_->loadChannelKey(channelId);
      if (k2.isEmpty()) {
        syncKeys(channelId);
        QTimer::singleShot(800, this, [this, channelId, text, attachmentIds, replyToId, done]() {
          const QByteArray k3 = storage_->loadChannelKey(channelId);
          if (k3.isEmpty()) {
            if (kekMissing()) {
              emit kekPromptNeeded();
              done("Для отправки нужен пароль аккаунта (расшифровка ключей)");
            } else {
              done("Ключ канала ещё не получен, повторите позже");
            }
            return;
          }
          sendMessage(channelId, text, attachmentIds, replyToId, done);
        });
        return;
      }
      sendMessage(channelId, text, attachmentIds, replyToId, done);
    });
    return;
  }
  const Encrypted enc = gl::encryptMessage(key, text);
  const QByteArray ciphertext = enc.ciphertext;
  const QByteArray iv = enc.iv;
  Message pending;
  pending.id = -QDateTime::currentMSecsSinceEpoch();
  pending.channelId = channelId;
  pending.senderId = user_.id;
  pending.senderNick = user_.nick;
  pending.text = text;
  pending.pending = true;
  pending.createdAt = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
  auto it = messages_.find(channelId);
  if (it == messages_.end()) {
    messages_.insert(channelId, {pending});
  } else {
    it.value().append(pending);
  }
  emit messagesChanged(channelId);

  api_.sendMessage(channelId, ciphertext, iv, attachmentIds, replyToId,
                   [this, channelId, pending, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      auto it2 = messages_.find(channelId);
      if (it2 != messages_.end()) {
        for (int i = 0; i < it2.value().size(); i++) {
          if (it2.value()[i].id == pending.id) {
            it2.value().removeAt(i);
            break;
          }
        }
        emit messagesChanged(channelId);
      }
      done(err);
      return;
    }
    processMessage(channelId, Message::fromJson(res), false);
    done(QString());
  });
}

void AppState::editMessage(qint64 channelId, qint64 messageId, const QString& text,
                           std::function<void(const QString&)> done) {
  const QByteArray key = storage_->loadChannelKey(channelId);
  if (key.isEmpty()) {
    done("Ключ канала недоступен");
    return;
  }
  const Encrypted enc = gl::encryptMessage(key, text);
  api_.editMessage(channelId, messageId, enc.ciphertext, enc.iv,
                   [this, channelId, messageId, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    const Message m = decryptMessage(Message::fromJson(res));
    auto it = messages_.find(channelId);
    if (it != messages_.end()) {
      for (Message& x : it.value()) {
        if (x.id == m.id) {
          x = m;
          emit messagesChanged(channelId);
          break;
        }
      }
    }
    done(QString());
  });
}

void AppState::deleteMessage(qint64 channelId, qint64 messageId, std::function<void(const QString&)> done) {
  api_.deleteMessage(channelId, messageId,
                     [this, channelId, messageId, done](const QJsonObject&, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    auto it = messages_.find(channelId);
    if (it != messages_.end()) {
      for (Message& x : it.value()) {
        if (x.id == messageId) x.deleted = true;
      }
      emit messagesChanged(channelId);
    }
    done(QString());
  });
}

void AppState::uploadFile(qint64 channelId, const QString& filePath, std::function<void(const QString&)> done) {
  api_.uploadFile(channelId, filePath, [this, channelId, filePath, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    const qint64 fileId = res.value("id").toVariant().toLongLong();
    if (!fileId) {
      done("файл не загружен");
      return;
    }
    sendMessage(channelId, "", {fileId}, 0, done);
  });
}

void AppState::sendTyping(qint64 channelId) {
  ws_.sendTyping(channelId);
}

void AppState::loadMembers(qint64 channelId, std::function<void(const QVector<ChannelMember>&)> done) {
  api_.listMembers(channelId, [done](const QJsonObject& res, const QString&) {
    QVector<ChannelMember> out;
    for (const QJsonValue& v : res.value("_array").toArray()) {
      out.append(ChannelMember::fromJson(v.toObject()));
    }
    done(out);
  });
}

void AppState::loadUsers(std::function<void(const QVector<User>&)> done) {
  api_.listUsers([done](const QJsonObject& res, const QString&) {
    QVector<User> out;
    for (const QJsonValue& v : res.value("_array").toArray()) {
      const QJsonObject o = v.toObject();
      User u;
      u.id = o.value("id").toVariant().toLongLong();
      u.nick = o.value("nick").toString();
      u.isServerAdmin = o.value("is_server_admin").toBool();
      out.append(u);
    }
    done(out);
  });
}

void AppState::loadInvites(std::function<void(const QVector<Invite>&)> done) {
  api_.listInvites([this, done](const QJsonObject& res, const QString&) {
    QVector<Invite> out;
    for (const QJsonValue& v : res.value("_array").toArray()) {
      out.append(Invite::fromJson(v.toObject()));
    }
    invites_ = out;
    emit invitesChanged();
    done(out);
  });
}

void AppState::createInvite(qint64 channelId, qint64 userId, std::function<void(const QString&)> done) {
  api_.createInvite(channelId, userId, [done](const QJsonObject&, const QString& err) {
    done(err);
  });
}

void AppState::respondInvite(qint64 inviteId, bool accept, std::function<void(const QString&)> done) {
  api_.respondInvite(inviteId, accept, [this, done](const QJsonObject&, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    loadInvites([](const QVector<Invite>&) {});
    refreshChannels();
    done(QString());
  });
}

// ---------- Ключи ----------

void AppState::syncKeys(qint64 channelId) {
  ensureDevice();
  Channel* ch = findChannel(channelId);

  const bool isMember = ch ? ch->isMember : false;
  if (!isMember) return;

  // Последовательно (как в вебе): парольный бэкап → обёртка с сервера →
  // stale-проверка → раздача новым устройствам.
  std::function<void(std::function<void()>)> stepBackup = [this, channelId](std::function<void()> next) {
    // Если ключ уже есть локально — бэкап не нужен (повторный поллинг).
    if (!storage_->loadChannelKey(channelId).isEmpty()) {
      next();
      return;
    }
    const QByteArray kek = getKek();
    if (kek.isEmpty()) {
      next();
      return;
    }
    api_.getKeyBackup(channelId, [this, channelId, kek, next](const QJsonObject& res, const QString&) {
      const QByteArray wrapped = b64Decode(res.value("wrapped_key").toString());
      if (!wrapped.isEmpty()) {
        const QByteArray bkey = unwrapWithKek(kek, wrapped);
        if (!bkey.isEmpty()) {
          storage_->saveChannelKey(channelId, bkey);
          // Своя обёртка — чтобы сервер знал, что устройство держит ключ.
          api_.uploadWrappedKey(channelId, user_.id, device_.deviceId,
                                wrapChannelKey(bkey, device_.publicKey),
                                [this, channelId, next](const QJsonObject&, const QString&) {
            next();
          });
          return;
        }
      }
      next();
    });
  };
  std::function<void(std::function<void()>)> stepServerWrap = [this, channelId](std::function<void()> next) {
    api_.getMyWrappedKey(channelId, device_.deviceId, [this, channelId, next](const QJsonObject& res, const QString&) {
      const QByteArray wrapped = b64Decode(res.value("wrapped_key").toString());
      if (!wrapped.isEmpty()) {
        const QByteArray key = unwrapChannelKey(wrapped, device_.privateKey);
        if (!key.isEmpty()) {
          const bool had = !storage_->loadChannelKey(channelId).isEmpty();
          storage_->saveChannelKey(channelId, key);
          if (!had) uploadBackup(channelId, key);
          // История загружается при открытии канала (openChannel).
          if (currentId_ == channelId && messages_.value(channelId).isEmpty()) {
            loadHistory(channelId);
          }
        }
      }
      next();
    });
  };
  std::function<void(std::function<void()>)> stepStale = [this, channelId](std::function<void()> next) {
    const QByteArray myKey = storage_->loadChannelKey(channelId);
    if (myKey.isEmpty()) {
      next();
      return;
    }
    // Проверяем, знает ли сервер наше устройство: если нет — ключ
    // пересоздан другим держателем, локальная копия устарела.
    api_.getMyWrappedKey(channelId, device_.deviceId, [this, channelId, myKey, next](const QJsonObject& res, const QString&) {
      const QByteArray wrapped = b64Decode(res.value("wrapped_key").toString());
      if (wrapped.isEmpty()) {
        storage_->deleteChannelKey(channelId);
        next();
        return;
      }
      // Раздача ключа новым устройствам участников.
      api_.pendingKeyTargets(channelId, [this, channelId, myKey, next](const QJsonObject& t, const QString&) {
        const QJsonArray targets = arrOf(t, "_array");
        for (const QJsonValue& v : targets) {
          const QJsonObject target = v.toObject();
          const qint64 uid = target.value("user_id").toVariant().toLongLong();
          const QString dev = target.value("device_id").toString();
          const QByteArray pub = b64Decode(target.value("public_key").toString());
          if (uid == user_.id && dev == device_.deviceId) continue;
          if (pub.isEmpty()) continue;
          api_.uploadWrappedKey(channelId, uid, dev, wrapChannelKey(myKey, pub),
                                [](const QJsonObject&, const QString&) {});
        }
        next();
      });
    });
  };

  stepBackup([stepServerWrap, stepStale]() {
    stepServerWrap([stepStale]() {
      stepStale([]() {});
    });
  });
}

QByteArray AppState::getKek() {
  if (!kek_.isEmpty()) return kek_;
  kek_ = storage_->loadKek();
  if (!kek_.isEmpty()) return kek_;
  if (!password_.isEmpty() && user_.id) {
    kek_ = deriveKek(password_, user_.id);
    storage_->saveKek(kek_);
    return kek_;
  }
  return {};
}

void AppState::uploadBackup(qint64 channelId, const QByteArray& key) {
  const QByteArray kek = getKek();
  if (kek.isEmpty()) return;
  api_.uploadKeyBackup(channelId, wrapWithKek(kek, key), [](const QJsonObject&, const QString&) {});
}

void AppState::syncAllKeys() {
  for (const Channel& c : channels_) {
    syncKeys(c.id);
  }
}

}  // namespace gl

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
  c.kind = o.value("kind").toString();
  c.isPrivate = o.value("private").toBool();
  c.readonly = o.value("readonly").toBool();
  c.creatorId = o.value("creator_id").toVariant().toLongLong();
  c.role = o.value("role").toString();
  c.isMember = o.value("is_member").toBool();
  c.memberCount = o.value("member_count").toVariant().toLongLong();
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
  m.plain = o.value("plain").toBool();
  m.deleted = o.value("deleted").toBool();
  m.edited = !o.value("edited_at").isNull() && o.value("edited_at").isUndefined() == false;
  m.createdAt = o.value("created_at").toString();
  m.replyTo = o.value("reply_to").toVariant().toLongLong();
  const QJsonArray atts = o.value("attachments").toArray();
  for (const QJsonValue& a : atts) {
    const QJsonObject ao = a.toObject();
    Attachment att;
    att.id = ao.value("id").toVariant().toLongLong();
    att.name = ao.value("name").toString();
    att.kind = ao.value("kind").toString();
    att.url = ao.value("url").toString();
    m.attachments.append(att);
  }
  return m;
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
  loadHistory(channelId);
  syncKeys(channelId);
  if (!pollStarted_) startKeyPoll();
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
  api_.login(nick, password, [this, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    token_ = res.value("token").toString();
    api_.setToken(token_);
    api_.me([this, done](const QJsonObject& me, const QString& err2) {
      if (!err2.isEmpty()) {
        done(err2);
        return;
      }
      user_ = User::fromJson(me);
      ensureDevice();
      kek_ = QByteArray();
      kekPromptShown_ = false;
      // KEK из пароля сохраняем сразу (как в вебе).
      if (!password_.isEmpty() && user_.id) {
        kek_ = deriveKek(password_, user_.id);
        storage_->saveKek(kek_);
      }
      api_.listChannels([this, done](const QJsonObject& chs, const QString& err3) {
        channels_.clear();
        for (const QJsonValue& v : arrOf(chs, "_array")) {
          channels_.append(Channel::fromJson(v.toObject()));
        }
        ws_.connectTo(serverUrl_, token_);
        wireWs();
        startKeyPoll();
        syncAllKeys();
        emit loginChanged();
        emit channelsChanged();
        done(QString());
      });
    });
  });
}

void AppState::createDm(qint64 userId, std::function<void(const QString&)> done) {
  api_.createDm(userId, [this, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    // Перечитываем список каналов: в ответе createDm нет is_member.
    api_.listChannels([this, done](const QJsonObject& chs, const QString& err2) {
      if (!err2.isEmpty()) {
        done(err2);
        return;
      }
      channels_.clear();
      for (const QJsonValue& v : arrOf(chs, "_array")) {
        channels_.append(Channel::fromJson(v.toObject()));
      }
      emit channelsChanged();
      qint64 dmId = 0;
      for (const Channel& c : channels_) {
        if (c.kind == "dm") {
          dmId = c.id;
          break;
        }
      }
      if (dmId) initChannelKey(dmId);
      done(QString());
    });
  });
}

void AppState::createCommunity(const QString& name, std::function<void(const QString&)> done) {
  api_.createCommunity(name, [this, done](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      done(err);
      return;
    }
    const Channel ch = Channel::fromJson(res.value("channel").toObject());
    channels_.append(ch);
    emit channelsChanged();
    // Открытое сообщество: ключ не создаём.
    if (ch.isE2E()) initChannelKey(ch.id);
    done(QString());
  });
}

// Создание ключа канала (создатель) — только для E2E-каналов.
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
  api_.setToken(QString());
  user_ = User();
  password_.clear();
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
  } else if (type == "key.needed") {
    const qint64 chId = data.value("channel_id").toVariant().toLongLong();
    const qint64 userId = data.value("user_id").toVariant().toLongLong();
    const QString devId = data.value("device_id").toString();
    const QByteArray pub = b64Decode(data.value("public_key").toString());
    const QByteArray myKey = storage_->loadChannelKey(chId);
    if (!myKey.isEmpty() && !pub.isEmpty()) {
      api_.uploadWrappedKey(chId, userId, devId, wrapChannelKey(myKey, pub), [](const QJsonObject&, const QString&) {});
    }
  } else if (type == "key.granted" || type == "key.reset") {
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
    if (!err.isEmpty()) return;
    QVector<Message> out;
    for (const QJsonValue& v : arrOf(res, "_array")) {
      out.append(decryptMessage(Message::fromJson(v.toObject())));
    }
    messages_.insert(channelId, out);
    emit messagesChanged(channelId);
  });
}

Message AppState::decryptMessage(const Message& raw) {
  Message m = raw;
  if (m.deleted) return m;
  if (m.plain) {
    m.text = m.ciphertext.isEmpty() ? QString() : QString::fromUtf8(m.ciphertext);
    return m;
  }
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

void AppState::sendMessage(qint64 channelId, const QString& text, std::function<void(const QString&)> done) {
  Channel* ch = findChannel(channelId);
  QByteArray ciphertext;
  QByteArray iv;
  bool plain = false;
  if (ch && !ch->isE2E()) {
    plain = true;
    ciphertext = text.toUtf8();
    iv = QByteArray();
  } else {
    const QByteArray key = storage_->loadChannelKey(channelId);
    if (key.isEmpty()) {
      done("Ключ канала ещё не получен, повторите позже");
      return;
    }
    const Encrypted enc = gl::encryptMessage(key, text);
    ciphertext = enc.ciphertext;
    iv = enc.iv;
  }
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

  api_.sendMessage(channelId, ciphertext, iv, plain, {}, 0,
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

// ---------- Ключи ----------

QByteArray AppState::getKek() {
  if (!kek_.isEmpty()) return kek_;
  KeyStorage* st = storage_;
  kek_ = storage_->loadKek();
  if (!kek_.isEmpty()) return kek_;
  if (!password_.isEmpty() && user_.id) {
    kek_ = deriveKek(password_, user_.id);
    storage_->saveKek(kek_);
    return kek_;
  }
  if (user_.id && !kekPromptShown_) {
    kekPromptShown_ = true;
    kekPromptNeeded_ = true;
    emit kekPrompt();
  }
  return {};
}

void AppState::submitKek(const QString& password, std::function<void(bool, const QString&)> done) {
  if (!user_.id) {
    done(false, "нет пользователя");
    return;
  }
  const QByteArray k = deriveKek(password, user_.id);
  storage_->saveKek(k);
  password_ = password;
  kek_ = k;
  kekPromptNeeded_ = false;
  kekPromptShown_ = true;
  // Проверка: расшифровываем первый доступный бэкап.
  for (const Channel& ch : channels_) {
    if (!ch.isE2E() || !ch.isMember) continue;
    api_.getKeyBackup(ch.id, [this, k, done](const QJsonObject& res, const QString& err) {
      if (!err.isEmpty()) return;
      const QByteArray wrapped = b64Decode(res.value("wrapped_key").toString());
      if (wrapped.isEmpty()) return;
      if (unwrapWithKek(k, wrapped).isEmpty()) {
        kekPromptNeeded_ = true;
        done(false, "Неверный пароль — личные сообщения не расшифрованы");
        return;
      }
    });
  }
  syncAllKeys();
  done(true, QString());
}

void AppState::uploadBackup(qint64 channelId, const QByteArray& key) {
  const QByteArray kek = getKek();
  if (kek.isEmpty()) return;
  api_.uploadKeyBackup(channelId, wrapWithKek(kek, key), [](const QJsonObject&, const QString&) {});
}

void AppState::syncKeys(qint64 channelId) {
  ensureDevice();
  Channel* ch = findChannel(channelId);
  KeyStorage* st = storage_;

  // Открытый канал: E2E отключён; старые ключи — только если есть обёртка.
  if (ch && !ch->isE2E()) {
    api_.getMyWrappedKey(channelId, device_.deviceId,
                         [this, channelId](const QJsonObject& res, const QString&) {
      const QByteArray wrapped = b64Decode(res.value("wrapped_key").toString());
      if (!wrapped.isEmpty()) {
        const QByteArray oldKey = unwrapChannelKey(wrapped, device_.privateKey);
        const bool had = !storage_->loadChannelKey(channelId).isEmpty();
        storage_->saveChannelKey(channelId, oldKey);
        if (!had) loadHistory(channelId);
      }
    });
    return;
  }

  const bool isMember = ch ? ch->isMember : false;
  if (!isMember) return;

  // Последовательно (как в вебе): бэкап → само-обёртка → обёртка с сервера
  // → stale-проверка → восстановление создателем → раздача.
  const QByteArray kek = getKek();
  std::function<void(std::function<void()>)> stepWrap = [this, channelId, kek](std::function<void()> next) {
    if (kek.isEmpty()) {
      next();
      return;
    }
    api_.getKeyBackup(channelId, [this, channelId, kek, next](const QJsonObject& res, const QString& err) {
      const QByteArray wrapped = b64Decode(res.value("wrapped_key").toString());

      if (!wrapped.isEmpty()) {
        const QByteArray bkey = unwrapWithKek(kek, wrapped);

        if (!bkey.isEmpty()) {
          const bool had = !storage_->loadChannelKey(channelId).isEmpty();
          storage_->saveChannelKey(channelId, bkey);
          // Своя обёртка — чтобы сервер знал, что устройство держит ключ.
          api_.uploadWrappedKey(channelId, user_.id, device_.deviceId,
                                wrapChannelKey(bkey, device_.publicKey),
                                [this, channelId, bkey, had, next](const QJsonObject&, const QString&) {
            if (!had) loadHistory(channelId);
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
          uploadBackup(channelId, key);
          if (!had) loadHistory(channelId);
        }
      }
      next();
    });
  };
  std::function<void(std::function<void()>)> stepStale = [this, channelId](std::function<void()> next) {
    Channel* c2 = findChannel(channelId);
    if (c2 && c2->isE2E()) {
      const QByteArray myKey = storage_->loadChannelKey(channelId);
      if (myKey.isEmpty()) {
        // Ключа нет нигде: создатель может восстановить (сервер отклонит,
        // если ключ жив у другого участника).
        if (c2->creatorId == user_.id && !keyResetTried_.contains(channelId)) {
          keyResetTried_.insert(channelId);
          const QByteArray fresh = generateChannelKey();
          api_.resetChannelKey(channelId, device_.deviceId, wrapChannelKey(fresh, device_.publicKey),
                               [this, channelId, fresh, next](const QJsonObject&, const QString& err) {
            if (!err.isEmpty()) {
              next();  // ключ жив у другого участника — придёт через обмен
              return;
            }
            storage_->saveChannelKey(channelId, fresh);
            uploadBackup(channelId, fresh);
            loadHistory(channelId);
            next();
          });
          return;
        }
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
    } else {
      next();
    }
  };

  stepWrap([stepServerWrap, stepStale]() {
    stepServerWrap([stepStale]() {
      stepStale([]() {});
    });
  });
}

void AppState::syncAllKeys() {
  for (const Channel& c : channels_) {
    syncKeys(c.id);
  }
}

}  // namespace gl

#include "call/call_manager.h"

#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>

#include "core/app_state.h"

namespace gl {

namespace {

void forEachField(const QJsonObject& o, const char* key, std::function<void(const QJsonValue&)> fn) {
  const QJsonValue v = o.value(key);
  if (v.isArray()) {
    for (const QJsonValue& x : v.toArray()) fn(x);
  } else if (v.isObject()) {
    for (const QJsonValue& x : v.toObject().value("_array").toArray()) fn(x);
  }
}

}  // namespace

CallManager::CallManager(AppState* state, QObject* parent) : QObject(parent), state_(state) {
  connect(&poll_, &QTimer::timeout, this, &CallManager::pollActiveCall);
  poll_.setInterval(15000);
}

void CallManager::handleWsEvent(const QString& type, const QJsonObject& data) {
  if (type == "call.invite") {
    const qint64 id = data.value("call_id").toVariant().toLongLong();
    const qint64 ch = data.value("channel_id").toVariant().toLongLong();
    const qint64 init = data.value("initiator_id").toVariant().toLongLong();
    const QString nick = data.value("initiator_nick").toString();
    ActiveCall c;
    c.id = id;
    c.channelId = ch;
    c.initiatorId = init;
    c.initiatorNick = nick;
    c.incoming = true;
    c.status = "ringing";
    calls_.append(c);
    emit callsChanged();
    emit incomingCall(id, ch, nick);
  } else if (type == "call.started") {
    const qint64 id = data.value("call_id").toVariant().toLongLong();
    for (ActiveCall& c : calls_) {
      if (c.id == id) c.status = "active";
    }
    emit callsChanged();
  } else if (type == "call.ended") {
    const qint64 id = data.value("call_id").toVariant().toLongLong();
    for (int i = 0; i < calls_.size(); i++) {
      if (calls_[i].id == id) {
        calls_.removeAt(i);
        break;
      }
    }
    if (activeCallId_ == id) leaveRoom();
    emit callsChanged();
    emit callEnded(id);
  } else if (type == "call.participants") {
    // обновление участников — пока не используем в UI
  } else if (type == "call.invite.timeout") {
    const qint64 id = data.value("call_id").toVariant().toLongLong();
    for (int i = 0; i < calls_.size(); i++) {
      if (calls_[i].id == id && calls_[i].incoming) {
        calls_.removeAt(i);
        emit callsChanged();
        emit callEnded(id);
        break;
      }
    }
  }
}

void CallManager::startCall(qint64 channelId, const QVector<qint64>& targetIds) {
  QJsonArray targets;
  for (qint64 t : targetIds) targets.append(t);
  QJsonObject body{{"channel_id", channelId}, {"target_ids", targets},
                   {"device_id", state_->device().deviceId}};
  state_->api()->post("/api/calls", body,
                      [this](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) {
      qWarning() << "createCall error:" << err;
      emit callError(err);
      return;
    }
    ActiveCall c;
    c.id = res.value("call").toObject().value("id").toVariant().toLongLong();
    c.channelId = res.value("call").toObject().value("channel_id").toVariant().toLongLong();
    c.initiatorId = res.value("call").toObject().value("initiator_id").toVariant().toLongLong();
    c.status = "ringing";
    calls_.append(c);
    emit callsChanged();
    const QString token = res.value("token").toString();
    QTimer::singleShot(0, this, [this, c, token]() {
      activeCallId_ = c.id;
      joinRoom(c.id, token);
      emit callStateChanged();
    });
  });
}

void CallManager::acceptCall(qint64 callId) {
  state_->api()->post("/api/calls/" + QString::number(callId) + "/accept",
                      {{"device_id", state_->device().deviceId}},
                      [this, callId](const QJsonObject& res, const QString& err) {
    if (!err.isEmpty()) return;
    for (ActiveCall& c : calls_) {
      if (c.id == callId) {
        c.incoming = false;
        c.status = "active";
      }
    }
    activeCallId_ = callId;
    joinRoom(callId, res.value("token").toString());
    poll_.start();
    emit callsChanged();
    emit callStateChanged();
  });
}

void CallManager::declineCall(qint64 callId) {
  state_->api()->post("/api/calls/" + QString::number(callId) + "/decline", {},
                      [](const QJsonObject&, const QString&) {});
  for (int i = 0; i < calls_.size(); i++) {
    if (calls_[i].id == callId) {
      calls_.removeAt(i);
      break;
    }
  }
  emit callsChanged();
}

void CallManager::leaveCall() {
  if (activeCallId_) {
    state_->api()->post("/api/calls/" + QString::number(activeCallId_) + "/leave", {},
                        [](const QJsonObject&, const QString&) {});
  }
  leaveRoom();
}

void CallManager::joinRoom(qint64 callId, const QString& token) {
  if (livekitUrl_.isEmpty()) {
    state_->api()->get("/api/config", [this, callId, token](const QJsonObject& res, const QString& err) {
      if (!err.isEmpty()) return;
      livekitUrl_ = res.value("livekit_url").toString();
      if (!livekitUrl_.isEmpty()) {
        livekit_.connectRoom(livekitUrl_, token, true, false);
      }
    });
    return;
  }
  livekit_.connectRoom(livekitUrl_, token, true, false);
}

void CallManager::leaveRoom() {
  livekit_.disconnectRoom();
  activeCallId_ = 0;
  poll_.stop();
  emit callStateChanged();
}

void CallManager::setMic(bool on) {
  livekit_.setMicEnabled(on);
}

void CallManager::setCam(bool on) {
  livekit_.setCamEnabled(on);
}

void CallManager::pollActiveCall() {
  // Периодически перезапрашиваем состояние активного звонка.
  if (!activeCallId_) return;
  state_->api()->get("/api/calls/" + QString::number(activeCallId_),
                     [this](const QJsonObject& res, const QString&) {
    const QString status = res.value("call").toObject().value("status").toString();
    if (status == "ended") {
      leaveRoom();
      for (int i = 0; i < calls_.size(); i++) {
        if (calls_[i].id == activeCallId_) {
          calls_.removeAt(i);
          break;
        }
      }
      emit callsChanged();
      emit callEnded(activeCallId_);
    }
  });
}

}  // namespace gl

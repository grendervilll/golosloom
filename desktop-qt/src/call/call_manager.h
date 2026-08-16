#pragma once
#include <QObject>
#include <QTimer>

#include "call/livekit_client.h"

namespace gl {

class AppState;

struct ActiveCall {
  qint64 id = 0;
  qint64 channelId = 0;
  qint64 initiatorId = 0;
  QString initiatorNick;
  bool incoming = false;  // входящий (ещё не принят)
  bool active = false;    // принят, идёт звонок
  QString status;         // ringing | active | ended
};

// Звонки: инициация/приём через API + события WS + LiveKit-комната.
class CallManager : public QObject {
  Q_OBJECT
 public:
  explicit CallManager(AppState* state, QObject* parent = nullptr);

  const QVector<ActiveCall>& calls() const { return calls_; }
  qint64 activeCallId() const { return activeCallId_; }
  LiveKitClient* livekit() { return &livekit_; }

  void handleWsEvent(const QString& type, const QJsonObject& data);
  void startCall(qint64 channelId, const QVector<qint64>& targetIds);
  void acceptCall(qint64 callId);
  void declineCall(qint64 callId);
  void leaveCall();
  void setMic(bool on);
  void setCam(bool on);

 signals:
  void callsChanged();
  void callStateChanged();  // активный звонок начался/закончился
  void incomingCall(qint64 callId, qint64 channelId, const QString& initiatorNick);
  void callEnded(qint64 callId);

 private:
  void joinRoom(qint64 callId, const QString& token);
  void leaveRoom();
  void pollActiveCall();

  AppState* state_;
  QVector<ActiveCall> calls_;
  qint64 activeCallId_ = 0;
  LiveKitClient livekit_;
  QTimer poll_;
  QString livekitUrl_;
};

}  // namespace gl

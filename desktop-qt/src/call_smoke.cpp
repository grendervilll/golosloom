// Смок-тест звонков: A создаёт канал, B вступает, A звонит B в канале,
// оба подключаются к LiveKit (синтетический аудио), проверяем обмен SDP
// (offer→answer, subscriber offer) — это доказывает работу сигналинга и WebRTC.
#include <QCoreApplication>
#include <QDir>
#include <QTimer>

#include <deque>
#include <functional>

#include "call/call_manager.h"
#include "core/app_state.h"

using namespace gl;

namespace {

int gFails = 0;

void failStep2(const QString& msg) {
  qWarning().noquote() << "STEP FAIL:" << msg;
  QCoreApplication::exit(2);
}

void ok(const QString& name, bool cond, const QString& extra = QString()) {
  qInfo().noquote() << (cond ? "PASS" : "FAIL") << "|" << name << (extra.isEmpty() ? "" : "| " + extra);
  if (!cond) gFails++;
}

std::deque<std::function<void(std::function<void()>)>> gSteps;
bool gTimeout = false;

void runNext() {
  if (gSteps.empty()) {
    qInfo().noquote() << (gFails == 0 ? "CALL SMOKE ALL PASSED" : QString("CALL SMOKE FAILURES: %1").arg(gFails));
    QCoreApplication::exit(gFails == 0 ? 0 : 1);
    return;
  }
  auto step = gSteps.front();
  gSteps.pop_front();
  auto* loop = new QEventLoop();
  QTimer::singleShot(90000, loop, []() {
    qWarning() << "TIMEOUT шага";
    QCoreApplication::exit(2);
  });
  step([loop]() {
    loop->quit();
    runNext();
  });
  loop->exec();
}

void addStep(std::function<void(std::function<void()>)> step) {
  gSteps.push_back(std::move(step));
}

void runCallSmoke(const QString& server) {
  const QString suffix = QString::number(QDateTime::currentSecsSinceEpoch() % 1000000);
  const QString nickA = "cqA" + suffix;
  const QString nickB = "cqB" + suffix;
  const QString pass = "Passw0rd!x123";

  AppState* a = new AppState();
  a->setStorage(new KeyStorage(false, "/tmp/golosmoke/" + suffix + "/CA"));
  a->setServerUrl(server);
  AppState* b = new AppState();
  b->setStorage(new KeyStorage(false, "/tmp/golosmoke/" + suffix + "/CB"));
  b->setServerUrl(server);

  CallManager* cmA = new CallManager(a, a);
  CallManager* cmB = new CallManager(b, b);
  cmA->livekit()->setFakeAudio(true);
  cmB->livekit()->setFakeAudio(true);

  addStep([a, nickA, pass](auto next) {
    a->api()->registerUser(nickA, pass, [next](const QJsonObject&, const QString& err) {
      if (!err.isEmpty()) return failStep2("регистрация A: " + err);
      next();
    });
  });
  addStep([a, nickA, pass](auto next) {
    a->login(nickA, pass, [next](const QString& err) {
      if (!err.isEmpty()) return failStep2("вход A: " + err);
      next();
    });
  });
  addStep([b, nickB, pass](auto next) {
    b->api()->registerUser(nickB, pass, [next](const QJsonObject&, const QString& err) {
      if (!err.isEmpty()) return failStep2("регистрация B: " + err);
      next();
    });
  });
  addStep([b, nickB, pass](auto next) {
    b->login(nickB, pass, [next](const QString& err) {
      if (!err.isEmpty()) return failStep2("вход B: " + err);
      next();
    });
  });
  qint64 chId = 0;
  qint64 bUserId = 0;
  addStep([a, b, &chId, &bUserId](auto next) {
    a->createChannel("cq" + QString::number(QDateTime::currentSecsSinceEpoch() % 1000000), false,
                     [a, b, &chId, &bUserId, next](const QString& err) {
      if (!err.isEmpty()) return failStep2("создание канала: " + err);
      for (const Channel& c : a->channels()) chId = c.id;
      bUserId = b->user().id;
      next();
    });
  });
  addStep([b, &chId](auto next) {
    if (!chId) return failStep2("нет канала для join");
    b->joinChannel(chId, [b, chId, next](const QString& err) {
      if (!err.isEmpty()) return failStep2("join B: " + err);
      QTimer::singleShot(1000, [b, chId, next]() {
        next();
      });
    });
  });
  addStep([cmA, cmB, &chId, &bUserId](auto next) {
    ok("Канал создан (id=" + QString::number(chId) + ")", chId > 0);
    // A звонит B (в целях — B).
    cmA->startCall(chId, {bUserId});
    QTimer::singleShot(3000, [cmA, cmB, next]() {
      qint64 callId = 0;
      for (const ActiveCall& c : cmA->calls()) callId = c.id;
      ok("A создал звонок (id=" + QString::number(callId) + ")", callId > 0);
      next();
    });
  });
  addStep([cmA, cmB](auto next) {
    // Принимаем звонок вручную: принимающая сторона получает WS call.invite,
    // здесь симулируем accept через API.
    qint64 callId = 0;
    for (const ActiveCall& c : cmA->calls()) callId = c.id;
    if (!callId) return failStep2("нет звонка для accept");
    cmB->acceptCall(callId);
    QTimer::singleShot(6000, [cmA, cmB, callId, next]() {
      ok("A подключён к LiveKit (join)", cmA->livekit()->connected());
      ok("B подключён к LiveKit (join)", cmB->livekit()->connected());
      ok("A получил SDP-answer (publisher)", cmA->livekit()->publisherAnswered());
      ok("B получил SDP-answer (publisher)", cmB->livekit()->publisherAnswered());
      qInfo() << "  A publisher SDP:" << cmA->livekit()->publisherSdp().left(120);
      next();
    });
  });
  addStep([cmA, cmB](auto next) {
    // Ждём subscriber offer от сервера (второй участник публикует аудио).
    QTimer::singleShot(8000, [cmA, cmB, next]() {
      ok("A получил subscriber offer", cmA->livekit()->subscriberOfferReceived());
      ok("B получил subscriber offer", cmB->livekit()->subscriberOfferReceived());
      cmA->leaveCall();
      cmB->leaveCall();
      next();
    });
  });

  runNext();
}

}  // namespace

int runCallSmokeMain(const QString& server) {
  fprintf(stderr, "CALL SMOKE против %s\n", server.toUtf8().constData());
  fflush(stderr);
  runCallSmoke(server);
  return QCoreApplication::exec();
}

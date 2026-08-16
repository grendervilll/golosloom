// Смок-тест ядра Qt-клиента против реального сервера:
//  1. регистрация A и B (свежие пользователи);
//  2. A создаёт канал, инициализирует ключ канала (E2E);
//  3. B вступает в канал (join), получает ключ по обёртке;
//  4. A отправляет сообщение, оба его читают.
// Запуск: golosloom_qt --smoke [--server URL]
#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QTimer>

#include <cstdlib>
#include <deque>
#include <functional>

#include "core/app_state.h"

using namespace gl;

namespace {

int gFails = 0;

void ok(const QString& name, bool cond, const QString& extra = QString()) {
  qInfo().noquote() << (cond ? "PASS" : "FAIL") << "|" << name << (extra.isEmpty() ? "" : "| " + extra);
  if (!cond) gFails++;
}

void failStep(const QString& msg) {
  qWarning().noquote() << "STEP FAIL:" << msg;
  QCoreApplication::exit(2);
}

// Очередь шагов: выполняются последовательно.
std::deque<std::function<void(std::function<void()>)>> gSteps;
std::function<void()> gDone;

void runNext() {
  qInfo() << "SMOKE: runNext, steps:" << gSteps.size();
  if (gSteps.empty()) {
    if (gDone) gDone();
    return;
  }
  auto step = gSteps.front();
  gSteps.pop_front();
  auto* loop = new QEventLoop();
  // Таймер таймаута шага; отменяется при штатном завершении шага.
  QTimer* timeoutTimer = new QTimer(loop);
  timeoutTimer->setSingleShot(true);
  timeoutTimer->setInterval(60000);
  QObject::connect(timeoutTimer, &QTimer::timeout, loop, []() {
    qWarning() << "TIMEOUT шага";
    QCoreApplication::exit(2);
  });
  timeoutTimer->start();
  step([loop, timeoutTimer]() {
    qInfo() << "SMOKE: шаг завершён";
    timeoutTimer->stop();
    loop->quit();
    runNext();
  });
  loop->exec();
}

void addStep(std::function<void(std::function<void()>)> step) {
  gSteps.push_back(std::move(step));
}

void runSmoke(const QString& server) {
  const QString suffix = QString::number(QDateTime::currentSecsSinceEpoch() % 1000000);
  const QString nickA = "qtA" + suffix;
  const QString nickB = "qtB" + suffix;
  const QString pass = "Passw0rd!x123";

  const QString dirA = "/tmp/golosmoke/" + suffix + "/A";
  const QString dirB = "/tmp/golosmoke/" + suffix + "/B";
  QDir().mkpath(dirA);
  QDir().mkpath(dirB);

  AppState* a = new AppState();
  a->setStorage(new KeyStorage(false, dirA));
  a->setServerUrl(server);
  AppState* b = new AppState();
  b->setStorage(new KeyStorage(false, dirB));
  b->setServerUrl(server);

  qint64 chId = 0;

  addStep([a, nickA, pass](auto next) {
    a->api()->registerUser(nickA, pass, [next](const QJsonObject&, const QString& err) {
      if (!err.isEmpty()) return failStep("регистрация A: " + err);
      next();
    });
  });
  addStep([a, nickA, pass](auto next) {
    a->login(nickA, pass, [a, next](const QString& err) {
      if (!err.isEmpty()) return failStep("вход A: " + err);
      ok("A вошёл, устройство создано", a->loggedIn() && !a->device().deviceId.isEmpty());
      next();
    });
  });
  addStep([b, nickB, pass](auto next) {
    b->api()->registerUser(nickB, pass, [next](const QJsonObject&, const QString& err) {
      if (!err.isEmpty()) return failStep("регистрация B: " + err);
      next();
    });
  });
  addStep([b, nickB, pass](auto next) {
    b->login(nickB, pass, [b, next](const QString& err) {
      if (!err.isEmpty()) return failStep("вход B: " + err);
      qInfo() << "SMOKE: B id =" << b->user().id << "nick =" << b->user().nick;
      ok("B вошёл", b->loggedIn());
      next();
    });
  });
  // Авто-вход по сохранённому токену: новый AppState с тем же хранилищем.
  addStep([b, server, suffix](auto next) {
    const QString savedToken = b->storage()->loadToken();
    ok("токен сессии сохранён", !savedToken.isEmpty());
    auto* b2 = new AppState();
    b2->setStorage(new KeyStorage(false, "/tmp/golosmoke/" + suffix + "/B"));
    b2->setServerUrl(server);
    b2->restoreSession([b2, next](bool restored, const QString& err) {
      qInfo() << "SMOKE: restoreSession ok =" << restored << "err =" << err;
      ok("авто-вход по токену", restored && b2->loggedIn());
      next();
    });
  });
  addStep([a, &chId](auto next) {
    a->createChannel("smoke" + QString::number(QDateTime::currentSecsSinceEpoch() % 1000000), false,
                     [a, &chId, next](const QString& err) {
      if (!err.isEmpty()) return failStep("создание канала: " + err);
      chId = a->channels().isEmpty() ? 0 : a->channels().last().id;
      ok("A создал канал (id=" + QString::number(chId) + ")", chId > 0);
      next();
    });
  });
  addStep([b, &chId](auto next) {
    if (!chId) return failStep("нет канала для join");
    b->joinChannel(chId, [b, chId, next](const QString& err) {
      if (!err.isEmpty()) return failStep("join B: " + err);
      QTimer::singleShot(1000, [b, chId, next]() {
        ok("B вступил в канал", b->findChannel(chId) && b->findChannel(chId)->isMember);
        next();
      });
    });
  });
  addStep([a, &chId](auto next) {
    if (!chId) return failStep("нет канала");
    // Ждём, пока поллинг A раздаст обёртки.
    qInfo() << "SMOKE: ждём раздачу 12с...";
    QTimer::singleShot(12000, [a, &chId, next]() {
      a->api()->pendingKeyTargets(chId, [next](const QJsonObject& t, const QString&) {
        qInfo() << "SMOKE: pending targets после раздачи:" << t.value("_array").toArray().size();
        next();
      });
    });
  });
  addStep([b, &chId](auto next) {
    if (!chId) return failStep("нет канала");
    b->openChannel(chId);
    QTimer::singleShot(3000, [b, chId, next]() {
      bool hasKey = !b->storage()->loadChannelKey(chId).isEmpty();
      ok("B получил ключ канала", hasKey);
      next();
    });
  });
  addStep([a, b, &chId](auto next) {
    if (!chId) return failStep("нет канала");
    a->sendMessage(chId, "привет из Qt", {}, 0, [a, b, chId, next](const QString& err) {
      if (!err.isEmpty()) return failStep("отправка: " + err);
      QTimer::singleShot(3000, [a, b, chId, next]() {
        bool readA = false;
        for (const Message& m : a->messages(chId)) {
          if (m.text == "привет из Qt" && !m.encrypted) readA = true;
        }
        ok("A читает своё сообщение", readA);
        bool readB = false;
        for (const Message& m : b->messages(chId)) {
          if (m.text == "привет из Qt" && !m.encrypted) readB = true;
        }
        ok("B читает сообщение A", readB);
        next();
      });
    });
  });
  // Пагинация: A пишет 55 сообщений, B открывает канал (50), затем
  // подгружает старые (остаток).
  addStep([a, &chId](auto next) {
    if (!chId) return failStep("нет канала");
    auto sendNext = std::make_shared<std::function<void(int)>>();
    // Сторож: если колбэк не пришёл за 15 секунд — диагностика.
    auto watchdog = std::make_shared<QTimer>();
    watchdog->setSingleShot(true);
    QObject::connect(watchdog.get(), &QTimer::timeout, []() {
      qWarning() << "WATCHDOG: колбэк пагинации не пришёл за 15с";
      QCoreApplication::exit(2);
    });
    *sendNext = [a, chId, next, sendNext, watchdog](int left) {
      if (left <= 0) {
        watchdog->stop();
        qInfo() << "SMOKE: пагинация завершена";
        next();
        return;
      }
      watchdog->start(15000);
      const qint64 t0 = QDateTime::currentMSecsSinceEpoch();
      qInfo() << "SMOKE: пагинация left =" << left;
      a->sendMessage(chId, "паг" + QString::number(left), {}, 0,
                     [sendNext, left, watchdog, t0](const QString& err) {
        watchdog->stop();
        const qint64 dt = QDateTime::currentMSecsSinceEpoch() - t0;
        if (dt > 2000) qWarning() << "пагинация: медленный ответ" << dt << "мс, left =" << left;
        if (!err.isEmpty()) {
          qWarning() << "пагинация-отправка:" << err << "left =" << left;
          QTimer::singleShot(1200, [sendNext, left]() { (*sendNext)(left); });
          return;
        }
        QTimer::singleShot(300, [sendNext, left]() { (*sendNext)(left - 1); });
      });
    };
    (*sendNext)(55);
  });
  addStep([b, &chId](auto next) {
    if (!chId) return failStep("нет канала");
    b->openChannel(chId);
    // Ждём завершения loadHistory и накопления WS-сообщений.
    QTimer::singleShot(4000, [b, chId, next]() {
      const int n = b->messages(chId).size();
      ok("история: 50 сообщений при открытии", n >= 50);
      // loadOlder ДОЛЖЕН вернуть старые (после загрузки истории).
      b->loadOlderMessages(chId, [b, chId, next]() {
        // Запоздавший loadHistory мог перезаписать список — даём ему время.
        QTimer::singleShot(3000, [b, chId, next]() {
          const int n2 = b->messages(chId).size();
          ok("подгружены старые сообщения (" + QString::number(n2) + ")", n2 > 50);
          next();
        });
      });
    });
  });
  // Приватный канал + приглашение + принятие.
  addStep([a, b](auto next) {
    a->createChannel("priv" + QString::number(QDateTime::currentSecsSinceEpoch() % 1000000), true,
                     [a, b, next](const QString& err) {
      if (!err.isEmpty()) return failStep("создание приватного канала: " + err);
      const qint64 privId = a->channels().last().id;
      ok("A создал приватный канал (id=" + QString::number(privId) + ")", privId > 0);
      a->createInvite(privId, b->user().id, [b, next](const QString& err2) {
        if (!err2.isEmpty()) return failStep("приглашение: " + err2);
        QTimer::singleShot(1500, [b, next]() {
          b->loadInvites([b, next](const QVector<Invite>& invites) {
            ok("B получил приглашение", !invites.isEmpty());
            if (invites.isEmpty()) {
              next();
              return;
            }
            b->respondInvite(invites.first().id, true, [b, next](const QString& err3) {
              if (!err3.isEmpty()) return failStep("принятие приглашения: " + err3);
              QTimer::singleShot(1500, [b, next]() {
                bool member = false;
                for (const Channel& c : b->channels()) {
                  if (c.isPrivate && c.isMember) member = true;
                }
                ok("B вступил в приватный канал", member);
                next();
              });
            });
          });
        });
      });
    });
  });
  // Офлайн-восстановление ключа через парольный бэкап:
  // новое устройство B (тот же пароль), держатель A не онлайн.
  addStep([b, &chId, server, nickB, pass, suffix](auto next) {
    if (!chId) return failStep("нет канала");
    auto* b2 = new AppState();
    b2->setStorage(new KeyStorage(false, "/tmp/golosmoke/" + suffix + "/B2"));
    b2->setServerUrl(server);
    b2->login(nickB, pass, [b2, chId, next](const QString& err) {
      if (!err.isEmpty()) return failStep("вход B2: " + err);
      qInfo() << "SMOKE: B2 (новое устройство) вошёл";
      QTimer::singleShot(5000, [b2, chId, next]() {
        const bool hasKey = !b2->storage()->loadChannelKey(chId).isEmpty();
        ok("B2 получил ключ из парольного бэкапа (без онлайн-держателя)", hasKey);
        next();
      });
    });
  });
  addStep([](auto next) {
    qInfo().noquote() << (gFails == 0 ? "SMOKE ALL PASSED" : QString("SMOKE FAILURES: %1").arg(gFails));
    // next() завершает шаг и останавливает таймер таймаута; выход — после
    // того как все вложенные циклы событий завершились.
    const int rc = gFails == 0 ? 0 : 1;
    next();
    QTimer::singleShot(100, [rc]() {
      qInfo() << "SMOKE: выход с кодом" << rc;
      std::exit(rc);
    });
  });

  gDone = []() {};
  runNext();
}

}  // namespace

int runSmokeMain(const QString& server) {
  qInfo() << "SMOKE против" << server;
  QEventLoop loop;
  runSmoke(server);
  // Ожидание завершения шагов; приложение выходит через QCoreApplication::exit.
  const int rc = QCoreApplication::exec();
  qInfo() << "SMOKE: exec вернулся" << rc;
  return rc;
}

// Смок-тест ядра Qt-клиента против реального сервера:
//  1. регистрация A и B (свежие пользователи);
//  2. A создаёт DM, отправляет сообщение (E2E: ключ + обёртка + бэкап);
//  3. B2 (новое устройство, все сессии A закрыты) входит только с паролем,
//     получает ключ из парольного бэкапа и читает сообщение.
// Запуск: golosloom_qt --smoke [--server URL]
#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QTimer>

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
  QTimer::singleShot(60000, loop, []() {
    qWarning() << "TIMEOUT шага";
    QCoreApplication::exit(2);
  });
  step([loop]() {
    qInfo() << "SMOKE: шаг завершён";
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

  qint64 dmId = 0;

  addStep([a, nickA, pass](auto next) {
    a->api()->registerUser(nickA, pass, [next](const QJsonObject&, const QString& err) {
      if (!err.isEmpty()) return failStep("регистрация A: " + err);
      next();
    });
  });
  addStep([a, nickA, pass](auto next) {
    a->login(nickA, pass, [a, next](const QString& err) {
      if (!err.isEmpty()) return failStep("вход A: " + err);
      ok("A вошёл, устройство и KEK созданы",
         a->loggedIn() && !a->device().deviceId.isEmpty() && !a->storage()->loadKek().isEmpty());
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
  addStep([a, b, nickB](auto next) {
    a->api()->search(nickB, [a, nickB, next](const QJsonObject& res, const QString& err) {
      if (!err.isEmpty()) return failStep("поиск: " + err);
      const QJsonArray users = res.value("users").toArray();
      if (users.isEmpty()) return failStep("пользователь не найден: " + nickB);
      const qint64 uid = users.first().toObject().value("id").toVariant().toLongLong();
      ok("A нашёл B (id=" + QString::number(uid) + ")", uid > 0);
      a->createDm(uid, [a, next](const QString& err2) {
        if (!err2.isEmpty()) return failStep("DM: " + err2);
        next();
      });
    });
  });
  addStep([a, &dmId](auto next) {
    dmId = a->channels().isEmpty() ? 0 : a->channels().last().id;
    ok("DM создан (id=" + QString::number(dmId) + ")", dmId > 0);
    a->openChannel(dmId);
    QTimer::singleShot(1500, [a, dmId, next]() {
      a->sendMessage(dmId, "привет из Qt", [a, dmId, next](const QString& err) {
        if (!err.isEmpty()) return failStep("отправка: " + err);
        const auto& msgs = a->messages(dmId);
        ok("A видит своё сообщение", !msgs.isEmpty() && msgs.last().text == "привет из Qt");
        next();
      });
    });
  });
  addStep([a, &dmId](auto next) {
    // Ждём, пока поллинг A раздаст обёртки, и проверяем.
    qInfo() << "SMOKE: ждём раздачу 12с...";
    QTimer::singleShot(12000, [a, &dmId, next]() {
      a->api()->pendingKeyTargets(dmId, [next](const QJsonObject& t, const QString&) {
        qInfo() << "SMOKE: pending targets после раздачи:" << t.value("_array").toArray().size();
        next();
      });
    });
  });
  // Закрываем A полностью: держателей ключа онлайн не осталось.
  addStep([a, &dmId, b, server, nickB, pass, suffix](auto next) {
    delete a;
    AppState* b2 = new AppState();
    b2->setStorage(new KeyStorage(false, "/tmp/golosmoke/" + suffix + "/B2"));
    b2->setServerUrl(server);
    b2->login(nickB, pass, [b2, next](const QString& err) {
      qInfo() << "SMOKE: B2 id =" << b2->user().id << "nick =" << b2->user().nick << "err =" << err;
      if (!err.isEmpty()) return failStep("вход B2: " + err);
      qint64 dm2 = 0;
      for (const Channel& c : b2->channels()) {
        if (c.kind == "dm") {
          dm2 = c.id;
          break;
        }
      }
      ok("B2 видит DM", dm2 > 0);
      if (dm2 > 0) {
        b2->openChannel(dm2);
        QTimer::singleShot(5000, [b2, dm2, next]() {
          bool read = false;
          for (const Message& m : b2->messages(dm2)) {
            if (m.text == "привет из Qt" && !m.encrypted) read = true;
          }
          ok("B2 читает сообщение A без онлайн-держателя (парольный бэкап)", read);
          if (!read) {
            qInfo() << "  B2 messages:" << b2->messages(dm2).size()
                    << "encrypted:" << (b2->messages(dm2).isEmpty() ? 0 : b2->messages(dm2).last().encrypted);
          }
          next();
        });
      } else {
        next();
      }
    });
  });
  addStep([](auto next) {
    qInfo() << (gFails == 0 ? "\nSMOKE ALL PASSED" : QString("\nSMOKE FAILURES: %1").arg(gFails));
    QCoreApplication::exit(gFails == 0 ? 0 : 1);
  });

  gDone = []() {};
  runNext();
}

}  // namespace

int runSmokeMain(const QString& server) {
  qInfo() << "SMOKE против" << server;
  runSmoke(server);
  const int rc = QCoreApplication::exec();
  qInfo() << "SMOKE: exec вернулся" << rc;
  return rc;
}

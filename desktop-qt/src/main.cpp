#include <QApplication>
#include <QIcon>
#include <QSettings>

#include <gst/gst.h>

int runSmokeMain(const QString& server);
int runCallSmokeMain(const QString& server);

#include "core/app_state.h"
#include "ui/main_window.h"
#include "ui/theme.h"

int main(int argc, char* argv[]) {
  gst_init(nullptr, nullptr);
  QApplication app(argc, argv);
  QApplication::setApplicationName("Golosloom");
  QApplication::setOrganizationName("golosloom");
  app.setWindowIcon(QIcon(":/app-icon.png"));
  app.setStyleSheet(gl::themeQss(gl::systemPrefersDark()));

  gl::AppState state;

  // Адрес сервера по умолчанию (из настроек или аргумента --server=).
  QSettings settings;
  QString server = settings.value("serverUrl").toString();
  for (int i = 1; i < argc - 1; i++) {
    const QString arg = QString::fromLocal8Bit(argv[i]);
    if (arg == "--server" || arg == "-s") server = QString::fromLocal8Bit(argv[i + 1]);
  }
  if (!server.isEmpty()) state.setServerUrl(server);

  const QStringList args = QApplication::arguments();
  if (args.contains("--smoke")) {
    return runSmokeMain(server);
  }
  if (args.contains("--call-smoke")) {
    return runCallSmokeMain(server);
  }

  gl::MainWindow window(&state);
  window.show();

  return app.exec();
}

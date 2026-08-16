#pragma once
#include <QByteArray>
#include <QString>

namespace gl {

// Хранение ключей (как web/src/crypto/storage.ts):
//  - macOS Keychain (Security framework);
//  - при недоступности — локальный файл.
class KeyStorage {
 public:
  // useKeychain=false — только файл (для тестов с несколькими
  // пользователями в одном процессе); dataDir — каталог файла (пустой —
  // стандартный AppDataLocation).
  explicit KeyStorage(bool useKeychain = true, const QString& dataDir = QString());

  // Канал: "ch:<id>"
  void saveChannelKey(qint64 channelId, const QByteArray& key);
  QByteArray loadChannelKey(qint64 channelId);
  void deleteChannelKey(qint64 channelId);

  // Устройство (identity JSON)
  void saveDevice(const QString& json);
  QString loadDevice();

  // Сессия: токен для авто-входа (как localStorage в вебе).
  void saveToken(const QString& token);
  QString loadToken();
  void clearToken();

 private:
  bool keychainSet(const QString& key, const QByteArray& value);
  QByteArray keychainGet(const QString& key);
  void keychainDelete(const QString& key);
  QByteArray fileGet(const QString& key);
  void fileSet(const QString& key, const QByteArray& value);

  QString filePath_() const;
  bool useKeychain_;
  QString dataDir_;
};

}  // namespace gl

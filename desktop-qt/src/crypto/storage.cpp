#include "crypto/storage.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStandardPaths>
#include <QtEndian>

#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>

namespace gl {

namespace {
const QString kService = QStringLiteral("com.golosloom.desktop");

CFStringRef cfString(const QString& s) {
  return CFStringCreateWithCString(kCFAllocatorDefault, s.toUtf8().constData(), kCFStringEncodingUTF8);
}

QByteArray packValue(const QByteArray& v) {
  // длина(4, BE) + данные
  QByteArray out;
  out.reserve(4 + v.size());
  const quint32 len = static_cast<quint32>(v.size());
  out.append(reinterpret_cast<const char*>(&len), 4);
  out.append(v);
  return out;
}

QByteArray unpackValue(const QByteArray& data) {
  if (data.size() < 4) return {};
  quint32 len = 0;
  memcpy(&len, data.constData(), 4);
  len = qFromBigEndian(len);
  if (static_cast<int>(len) > data.size() - 4) return {};
  return data.mid(4, static_cast<int>(len));
}

QString filePath() {
  return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/keys.dat";
}

CFMutableDictionaryRef baseQuery(const QString& key) {
  CFMutableDictionaryRef q = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
                                                       &kCFTypeDictionaryValueCallBacks);
  CFDictionaryAddValue(q, kSecClass, kSecClassGenericPassword);
  CFDictionaryAddValue(q, kSecAttrService, cfString(kService));
  CFDictionaryAddValue(q, kSecAttrAccount, cfString(key));
  return q;
}
}  // namespace

KeyStorage::KeyStorage(bool useKeychain, const QString& dataDir)
    : useKeychain_(useKeychain), dataDir_(dataDir) {}

bool KeyStorage::keychainSet(const QString& key, const QByteArray& value) {
  if (!useKeychain_) return false;
  const QByteArray packed = packValue(value);
  CFDataRef data = CFDataCreate(kCFAllocatorDefault, reinterpret_cast<const UInt8*>(packed.constData()),
                                static_cast<CFIndex>(packed.size()));
  if (!data) return false;
  CFMutableDictionaryRef q = baseQuery(key);
  CFMutableDictionaryRef attrs =
      CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
                                &kCFTypeDictionaryValueCallBacks);
  CFDictionaryAddValue(attrs, kSecValueData, data);
  OSStatus st = SecItemUpdate(q, attrs);
  if (st == errSecItemNotFound) {
    CFDictionaryAddValue(q, kSecValueData, data);
    st = SecItemAdd(q, nullptr);
  }
  CFRelease(attrs);
  CFRelease(q);
  CFRelease(data);
  return st == errSecSuccess;
}

QByteArray KeyStorage::keychainGet(const QString& key) {
  if (!useKeychain_) return {};
  CFMutableDictionaryRef q = baseQuery(key);
  CFDictionaryAddValue(q, kSecReturnData, kCFBooleanTrue);
  CFTypeRef result = nullptr;
  OSStatus st = SecItemCopyMatching(q, &result);
  CFRelease(q);
  if (st != errSecSuccess || !result) return {};
  QByteArray out = QByteArray::fromCFData(static_cast<CFDataRef>(result));
  CFRelease(result);
  return unpackValue(out);
}

void KeyStorage::keychainDelete(const QString& key) {
  if (!useKeychain_) return;
  CFMutableDictionaryRef q = baseQuery(key);
  SecItemDelete(q);
  CFRelease(q);
}

QString KeyStorage::filePath_() const {
  if (!dataDir_.isEmpty()) return dataDir_ + "/keys.dat";
  return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/keys.dat";
}

void KeyStorage::fileSet(const QString& key, const QByteArray& value) {
  QDir().mkpath(QFileInfo(filePath_()).absolutePath());
  QFile f(filePath_());
  QJsonObject all;
  if (f.open(QIODevice::ReadOnly)) {
    all = QJsonDocument::fromJson(f.readAll()).object();
    f.close();
  }
  all.insert(key, QString::fromLatin1(value.toBase64()));
  if (f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
    f.write(QJsonDocument(all).toJson(QJsonDocument::Compact));
  }
}

QByteArray KeyStorage::fileGet(const QString& key) {
  QFile f(filePath_());
  if (!f.open(QIODevice::ReadOnly)) return {};
  const QJsonObject all = QJsonDocument::fromJson(f.readAll()).object();
  return QByteArray::fromBase64(all.value(key).toString().toLatin1());
}

void KeyStorage::saveChannelKey(qint64 channelId, const QByteArray& key) {
  const QString k = "ch:" + QString::number(channelId);
  if (!keychainSet(k, key)) fileSet(k, key);
}

QByteArray KeyStorage::loadChannelKey(qint64 channelId) {
  const QString k = "ch:" + QString::number(channelId);
  QByteArray v = keychainGet(k);
  if (v.isEmpty()) v = fileGet(k);
  return v;
}

void KeyStorage::deleteChannelKey(qint64 channelId) {
  const QString k = "ch:" + QString::number(channelId);
  keychainDelete(k);
}

void KeyStorage::saveDevice(const QString& json) {
  if (!keychainSet("device", json.toUtf8())) fileSet("device", json.toUtf8());
}

QString KeyStorage::loadDevice() {
  QByteArray v = keychainGet("device");
  if (v.isEmpty()) v = fileGet("device");
  return QString::fromUtf8(v);
}

void KeyStorage::saveKek(const QByteArray& kek) {
  if (!keychainSet("kek", kek)) fileSet("kek", kek);
}

QByteArray KeyStorage::loadKek() {
  QByteArray v = keychainGet("kek");
  if (v.isEmpty()) v = fileGet("kek");
  return v;
}

void KeyStorage::saveToken(const QString& token) {
  if (!keychainSet("token", token.toUtf8())) fileSet("token", token.toUtf8());
}

QString KeyStorage::loadToken() {
  QByteArray v = keychainGet("token");
  if (v.isEmpty()) v = fileGet("token");
  return QString::fromUtf8(v);
}

void KeyStorage::clearToken() {
  keychainDelete("token");
  // Файловое хранилище хранит все ключи в одном keys.dat — удаляем оттуда.
  QFile fd(filePath_());
  if (fd.open(QIODevice::ReadOnly)) {
    QJsonObject all = QJsonDocument::fromJson(fd.readAll()).object();
    fd.close();
    if (all.contains("token")) {
      all.remove("token");
      if (fd.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        fd.write(QJsonDocument(all).toJson(QJsonDocument::Compact));
      }
    }
  }
}

}  // namespace gl

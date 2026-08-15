#pragma once
#include <QByteArray>
#include <QString>

namespace gl {

// Пары ключей устройства (identity) и ключи каналов — повторяет
// web/src/crypto/crypto.ts: x25519 + AES-256-GCM + PBKDF2.
struct DeviceKeys {
  QString deviceId;
  QByteArray privateKey;  // 32 байта x25519
  QByteArray publicKey;   // 32 байта x25519
};

QString generateDeviceId();
DeviceKeys generateDeviceKeys();
QByteArray generateChannelKey();  // 32 случайных байта

// x25519 + AES-GCM: обёртывание ключа канала для устройства собеседника.
QByteArray wrapChannelKey(const QByteArray& channelKey, const QByteArray& peerPublicKey);
QByteArray unwrapChannelKey(const QByteArray& wrapped, const QByteArray& myPrivateKey);

// Шифрование сообщений (AES-256-GCM, iv 12 байт, iv в начале).
struct Encrypted {
  QByteArray ciphertext;
  QByteArray iv;
};
Encrypted encryptMessage(const QByteArray& channelKey, const QString& plaintext);
QString decryptMessage(const QByteArray& channelKey, const QByteArray& ciphertext, const QByteArray& iv);

// Ключ из пароля (KEK) + шифрование ключа канала ключом из пароля.
QByteArray deriveKek(const QString& password, qint64 userId);
QByteArray wrapWithKek(const QByteArray& kek, const QByteArray& channelKey);
QByteArray unwrapWithKek(const QByteArray& kek, const QByteArray& wrapped);

// SHA-256 (для отладки/печати).
QByteArray sha256Hex(const QByteArray& data);

}  // namespace gl

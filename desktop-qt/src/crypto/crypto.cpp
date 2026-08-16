#include "crypto/crypto.h"

#include <QCryptographicHash>
#include <QDateTime>
#include <QRandomGenerator>
#include <openssl/evp.h>
#include <openssl/rand.h>

namespace gl {

namespace {

constexpr int kKeyLen = 32;
constexpr int kIvLen = 12;

QByteArray randomBytes(int n) {
  QByteArray out(n, Qt::Uninitialized);
  if (RAND_bytes(reinterpret_cast<unsigned char*>(out.data()), n) != 1) {
    for (int i = 0; i < n; i++) out[i] = char(QRandomGenerator::global()->bounded(256));
  }
  return out;
}

// EVP digest wrapper
QByteArray digest(const EVP_MD* md, const QByteArray& data) {
  QByteArray out(static_cast<int>(EVP_MAX_MD_SIZE), Qt::Uninitialized);
  unsigned int len = 0;
  EVP_MD_CTX* ctx = EVP_MD_CTX_new();
  EVP_DigestInit_ex(ctx, md, nullptr);
  EVP_DigestUpdate(ctx, data.constData(), static_cast<size_t>(data.size()));
  EVP_DigestFinal_ex(ctx, reinterpret_cast<unsigned char*>(out.data()), &len);
  EVP_MD_CTX_free(ctx);
  out.truncate(static_cast<int>(len));
  return out;
}

// x25519: общий секрет между (privA, pubB)
QByteArray x25519Shared(const QByteArray& privateKey, const QByteArray& publicKey) {
  if (privateKey.size() != kKeyLen || publicKey.size() != kKeyLen) return {};
  QByteArray secret(kKeyLen, Qt::Uninitialized);
  EVP_PKEY* pkey =
      EVP_PKEY_new_raw_private_key(EVP_PKEY_X25519, nullptr,
                                   reinterpret_cast<const unsigned char*>(privateKey.constData()), kKeyLen);
  if (!pkey) return {};
  EVP_PKEY* peer =
      EVP_PKEY_new_raw_public_key(EVP_PKEY_X25519, nullptr,
                                  reinterpret_cast<const unsigned char*>(publicKey.constData()), kKeyLen);
  if (!peer) {
    EVP_PKEY_free(pkey);
    return {};
  }
  EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new(pkey, nullptr);
  size_t len = kKeyLen;
  QByteArray out;
  if (EVP_PKEY_derive_init(ctx) == 1 && EVP_PKEY_derive_set_peer(ctx, peer) == 1 &&
      EVP_PKEY_derive(ctx, reinterpret_cast<unsigned char*>(secret.data()), &len) == 1) {
    secret.truncate(static_cast<int>(len));
    out = secret;
  }
  EVP_PKEY_CTX_free(ctx);
  EVP_PKEY_free(peer);
  EVP_PKEY_free(pkey);
  return out;
}

// AES-256-GCM шифрование/дешифрование.
QByteArray aesGcm(const QByteArray& key, const QByteArray& iv, const QByteArray& data, bool encrypt) {
  QByteArray out(data.size() + (encrypt ? 16 : 0), Qt::Uninitialized);
  EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
  int len = 0;
  int total = 0;
  if (encrypt) {
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr);
    EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, kIvLen, nullptr);
    EVP_EncryptInit_ex(ctx, nullptr, nullptr, reinterpret_cast<const unsigned char*>(key.constData()),
                       reinterpret_cast<const unsigned char*>(iv.constData()));
    EVP_EncryptUpdate(ctx, reinterpret_cast<unsigned char*>(out.data()), &len,
                      reinterpret_cast<const unsigned char*>(data.constData()), data.size());
    total = len;
    EVP_EncryptFinal_ex(ctx, reinterpret_cast<unsigned char*>(out.data()) + len, &len);
    total += len;
    EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, 16, out.data() + total);
    total += 16;
  } else {
    EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr);
    EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, kIvLen, nullptr);
    EVP_DecryptInit_ex(ctx, nullptr, nullptr, reinterpret_cast<const unsigned char*>(key.constData()),
                       reinterpret_cast<const unsigned char*>(iv.constData()));
    EVP_DecryptUpdate(ctx, reinterpret_cast<unsigned char*>(out.data()), &len,
                      reinterpret_cast<const unsigned char*>(data.constData()), data.size() - 16);
    total = len;
    EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16,
                        reinterpret_cast<unsigned char*>(const_cast<char*>(data.constData())) + data.size() - 16);
    if (EVP_DecryptFinal_ex(ctx, reinterpret_cast<unsigned char*>(out.data()) + len, &len) != 1) {
      EVP_CIPHER_CTX_free(ctx);
      return {};
    }
    total += len;
  }
  EVP_CIPHER_CTX_free(ctx);
  out.truncate(total);
  return out;
}

QByteArray x25519PublicFromPrivate(const QByteArray& privateKey) {
  EVP_PKEY* pkey = EVP_PKEY_new_raw_private_key(EVP_PKEY_X25519, nullptr,
                                                reinterpret_cast<const unsigned char*>(privateKey.constData()),
                                                privateKey.size());
  if (!pkey) return {};
  QByteArray pub(kKeyLen, Qt::Uninitialized);
  size_t len = kKeyLen;
  EVP_PKEY_get_raw_public_key(pkey, reinterpret_cast<unsigned char*>(pub.data()), &len);
  EVP_PKEY_free(pkey);
  pub.truncate(static_cast<int>(len));
  return pub;
}

}  // namespace

QString generateDeviceId() {
  QByteArray bytes = randomBytes(16);
  bytes[6] = char((bytes[6] & 0x0f) | 0x40);
  bytes[8] = char((bytes[8] & 0x3f) | 0x80);
  const QByteArray h = bytes.toHex();
  return QString::fromLatin1(h.mid(0, 8) + "-" + h.mid(8, 4) + "-" + h.mid(12, 4) + "-" + h.mid(16, 4) + "-" +
                             h.mid(20, 12));
}

DeviceKeys generateDeviceKeys() {
  DeviceKeys keys;
  keys.deviceId = generateDeviceId();
  keys.privateKey = randomBytes(kKeyLen);
  keys.publicKey = x25519PublicFromPrivate(keys.privateKey);
  return keys;
}

QByteArray generateChannelKey() {
  return randomBytes(kKeyLen);
}

// Обёртка ключа канала для устройства с публичным ключом peerPublicKey.
// Формат (совместим с вебом): ephemeralPublic(32) || iv(12) || ciphertext+tag.
QByteArray wrapChannelKey(const QByteArray& channelKey, const QByteArray& peerPublicKey) {
  const QByteArray ephemeralPrivate = randomBytes(kKeyLen);
  const QByteArray ephemeralPublic = x25519PublicFromPrivate(ephemeralPrivate);
  const QByteArray shared = x25519Shared(ephemeralPrivate, peerPublicKey);
  const QByteArray aesKey = digest(EVP_sha256(), shared);
  const QByteArray iv = randomBytes(kIvLen);
  const QByteArray ct = aesGcm(aesKey, iv, channelKey, true);
  return ephemeralPublic + iv + ct;
}

// Распаковка ключа канала своим приватным ключом.
QByteArray unwrapChannelKey(const QByteArray& wrapped, const QByteArray& myPrivateKey) {
  if (wrapped.size() < kKeyLen + kIvLen + 16) return {};
  const QByteArray ephemeralPublic = wrapped.left(kKeyLen);
  const QByteArray iv = wrapped.mid(kKeyLen, kIvLen);
  const QByteArray ct = wrapped.mid(kKeyLen + kIvLen);
  const QByteArray shared = x25519Shared(myPrivateKey, ephemeralPublic);
  const QByteArray aesKey = digest(EVP_sha256(), shared);
  return aesGcm(aesKey, iv, ct, false);
}

Encrypted encryptMessage(const QByteArray& channelKey, const QString& plaintext) {
  QByteArray iv = randomBytes(kIvLen);
  QByteArray ct = aesGcm(channelKey, iv, plaintext.toUtf8(), true);
  return {ct, iv};
}

QString decryptMessage(const QByteArray& channelKey, const QByteArray& ciphertext, const QByteArray& iv) {
  if (iv.isEmpty() || ciphertext.isEmpty()) return QString();
  QByteArray plain = aesGcm(channelKey, iv, ciphertext, false);
  return QString::fromUtf8(plain);
}

QByteArray sha256Hex(const QByteArray& data) {
  return QCryptographicHash::hash(data, QCryptographicHash::Sha256).toHex();
}

}  // namespace gl

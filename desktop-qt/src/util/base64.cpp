#include "util/base64.h"

#include <QByteArray>

namespace gl {

QByteArray b64Encode(const QByteArray& data) {
  return data.toBase64(QByteArray::Base64Encoding | QByteArray::OmitTrailingEquals);
}

QByteArray b64Decode(const QString& b64) {
  return QByteArray::fromBase64(b64.toUtf8(), QByteArray::Base64Encoding | QByteArray::OmitTrailingEquals);
}

QString b64ToUtf8(const QString& b64) {
  return QString::fromUtf8(b64Decode(b64));
}

QByteArray hexEncode(const QByteArray& data) {
  return data.toHex();
}

}  // namespace gl

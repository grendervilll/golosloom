#pragma once
#include <QByteArray>
#include <QString>

namespace gl {

QByteArray b64Encode(const QByteArray& data);
QByteArray b64Decode(const QString& b64);
QString b64ToUtf8(const QString& b64);
QByteArray hexEncode(const QByteArray& data);

}  // namespace gl

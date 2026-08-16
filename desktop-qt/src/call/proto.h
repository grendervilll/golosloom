#pragma once
#include <QByteArray>
#include <QString>

namespace gl {

// Минимальная protobuf-обёртка (wire format) для LiveKit-сигналинга.
class Pb {
 public:
  static QByteArray varint(quint64 v);
  static QByteArray bytes(int field, const QByteArray& data);
  static QByteArray str(int field, const QString& s);
  static QByteArray msg(int field, const QByteArray& m);
  static QByteArray var(int field, quint64 v);
  static QByteArray boolean(int field, bool b);

  // Декодер: последовательный обход полей.
  class Reader {
   public:
    explicit Reader(const QByteArray& data);
    bool next();               // перейти к следующему полю; false — конец
    int field() const { return field_; }
    int wire() const { return wire_; }
    quint64 asVarint() const;
    QByteArray asBytes() const;
    QString asString() const;

   private:
    const QByteArray& data_;
    int pos_ = 0;
    int field_ = 0;
    int wire_ = 0;
    quint64 value_ = 0;
    int len_ = 0;
  };

 private:
  static QByteArray key(int field, int wire);
};

}  // namespace gl

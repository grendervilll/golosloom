#include "call/proto.h"

namespace gl {

QByteArray Pb::key(int field, int wire) {
  return varint((static_cast<quint64>(field) << 3) | static_cast<quint64>(wire));
}

QByteArray Pb::varint(quint64 v) {
  QByteArray out;
  do {
    unsigned char b = static_cast<unsigned char>(v) & 0x7f;
    v >>= 7;
    if (v) b |= 0x80;
    out.append(static_cast<char>(b));
  } while (v);
  return out;
}

QByteArray Pb::bytes(int field, const QByteArray& data) {
  return key(field, 2) + varint(static_cast<quint64>(data.size())) + data;
}

QByteArray Pb::str(int field, const QString& s) {
  return bytes(field, s.toUtf8());
}

QByteArray Pb::msg(int field, const QByteArray& m) {
  return bytes(field, m);
}

QByteArray Pb::var(int field, quint64 v) {
  return key(field, 0) + varint(v);
}

QByteArray Pb::boolean(int field, bool b) {
  return key(field, 0) + varint(b ? 1 : 0);
}

Pb::Reader::Reader(const QByteArray& data) : data_(data) {}

bool Pb::Reader::next() {
  // Если предыдущее поле было length-delimited (wire 2), его данные ещё
  // не прочитаны (asBytes/asString возвращают копию, не двигая позицию) —
  // перешагиваем их, иначе ключ следующего поля прочитается из данных.
  if (wire_ == 2 && pos_ < data_.size()) {
    pos_ += len_;
    if (pos_ > data_.size()) pos_ = data_.size();
  }
  if (pos_ >= data_.size()) return false;
  quint64 k = 0;
  int shift = 0;
  while (pos_ < data_.size() && shift < 64) {
    const unsigned char b = static_cast<unsigned char>(data_.at(pos_++));
    k |= static_cast<quint64>(b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  field_ = static_cast<int>(k >> 3);
  wire_ = static_cast<int>(k & 0x7);
  value_ = 0;
  len_ = 0;
  if (wire_ == 0) {
    // varint
    shift = 0;
    while (pos_ < data_.size() && shift < 64) {
      const unsigned char b = static_cast<unsigned char>(data_.at(pos_++));
      value_ |= static_cast<quint64>(b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
  } else if (wire_ == 1) {
    if (pos_ + 8 <= data_.size()) {
      value_ = 0;
      for (int i = 0; i < 8; i++) value_ |= static_cast<quint64>(static_cast<unsigned char>(data_.at(pos_ + i))) << (8 * i);
      pos_ += 8;
    }
  } else if (wire_ == 2) {
    quint64 len = 0;
    shift = 0;
    while (pos_ < data_.size() && shift < 64) {
      const unsigned char b = static_cast<unsigned char>(data_.at(pos_++));
      len |= static_cast<quint64>(b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    len_ = static_cast<int>(len);
    if (pos_ + len_ > data_.size()) len_ = data_.size() - pos_;
  } else if (wire_ == 5) {
    if (pos_ + 4 <= data_.size()) {
      value_ = 0;
      for (int i = 0; i < 4; i++) value_ |= static_cast<quint64>(static_cast<unsigned char>(data_.at(pos_ + i))) << (8 * i);
      pos_ += 4;
    }
  }
  return true;
}

quint64 Pb::Reader::asVarint() const {
  return value_;
}

QByteArray Pb::Reader::asBytes() const {
  return data_.mid(pos_, len_);
}

QString Pb::Reader::asString() const {
  return QString::fromUtf8(data_.mid(pos_, len_));
}

}  // namespace gl
